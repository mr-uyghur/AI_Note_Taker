use crate::uploader::{
    complete_multipart, make_s3_client, start_multipart, upload_part, RecordingUpload,
    UploadPart, UploaderState,
};
use bytes::Bytes;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use tauri_plugin_shell::ShellExt;

const MIN_PART_SIZE: usize = 5 * 1024 * 1024; // 5 MiB — S3 multipart minimum

// ---------------------------------------------------------------------------
// Supervisor state
// ---------------------------------------------------------------------------

pub struct MacosRecorderHandle {
    pub child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
    pub out_dir: std::path::PathBuf,
    pub video_key: String,
    pub audio_key: String,
    pub start_time: std::time::Instant,
    /// Accumulates the total bytes of all video chunks successfully uploaded.
    pub video_bytes: Arc<AtomicU64>,
    /// PID of the sidecar process, populated when the "started" NDJSON event arrives.
    /// Stored as -1 until the event is received.
    pub sidecar_pid: Arc<AtomicI32>,
    /// Oneshot receiver that fires when the sidecar process terminates.
    pub terminated_rx: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>,
}

pub type MacosRecorderState = Arc<Mutex<HashMap<String, MacosRecorderHandle>>>;

// ---------------------------------------------------------------------------
// Internal helper: buffer data and upload a part when buffer >= MIN_PART_SIZE
// ---------------------------------------------------------------------------

async fn upload_fragment(
    uploader_state: &UploaderState,
    bucket: &str,
    recording_id: &str,
    suffix: &str, // "video" or "audio"
    data: Bytes,
) -> Result<(), String> {
    let state_key = format!("{}_{}", recording_id, suffix);

    // Extend the buffer; if it exceeds the minimum part size, drain and upload.
    let to_upload: Option<(String, String, i32, Bytes)> = {
        let mut uploads = uploader_state.lock().map_err(|e| e.to_string())?;
        let u = uploads
            .get_mut(&state_key)
            .ok_or_else(|| format!("Upload not found: {}", state_key))?;
        u.buffer.extend_from_slice(&data);

        if u.buffer.len() >= MIN_PART_SIZE {
            let pn = u.next_part_number;
            u.next_part_number += 1;
            let chunk = Bytes::from(u.buffer.drain(..).collect::<Vec<u8>>());
            Some((u.upload_id.clone(), u.key.clone(), pn, chunk))
        } else {
            None
        }
    };

    if let Some((upload_id, key, part_number, chunk)) = to_upload {
        let client = make_s3_client()?;
        let etag = upload_part(&client, bucket, &key, &upload_id, part_number, chunk).await?;

        let mut uploads = uploader_state.lock().map_err(|e| e.to_string())?;
        if let Some(u) = uploads.get_mut(&state_key) {
            u.parts.push(UploadPart { part_number, etag });
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Helper: flush the remaining buffer as the final part and complete the upload
// ---------------------------------------------------------------------------

async fn finalize_upload(
    uploader_state: &UploaderState,
    bucket: &str,
    state_key: &str,
) -> Result<u64, String> {
    let (upload_id, key, buffer, mut parts, final_part_number) = {
        let uploads = uploader_state.lock().map_err(|e| e.to_string())?;
        let u = uploads
            .get(state_key)
            .ok_or_else(|| format!("Upload not found: {}", state_key))?;
        (
            u.upload_id.clone(),
            u.key.clone(),
            u.buffer.clone(),
            u.parts.clone(),
            u.next_part_number,
        )
    };

    let size_bytes = buffer.len() as u64;
    let client = make_s3_client()?;

    // Flush remaining buffer as final part (last part may be any size).
    if !buffer.is_empty() {
        let data = Bytes::from(buffer);
        let etag =
            upload_part(&client, bucket, &key, &upload_id, final_part_number, data).await?;
        parts.push(UploadPart {
            part_number: final_part_number,
            etag,
        });
    }

    // S3 requires at least one completed part — guard for empty uploads.
    if parts.is_empty() {
        return Err(format!("No parts to complete for {}", state_key));
    }

    complete_multipart(&client, bucket, &key, &upload_id, &parts).await?;

    // Remove from state.
    let mut uploads = uploader_state.lock().map_err(|e| e.to_string())?;
    uploads.remove(state_key);

    Ok(size_bytes)
}

// ---------------------------------------------------------------------------
// Command: init_recording_macos
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn init_recording_macos(
    recording_id: String,
    app: tauri::AppHandle,
    uploader_state: State<'_, UploaderState>,
    recorder_state: State<'_, MacosRecorderState>,
) -> Result<(), String> {
    let bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());

    let video_key = format!("recordings/{}/video.mp4", recording_id);
    let audio_key = format!("recordings/{}/audio.m4a", recording_id);

    // Create temp output directory with a video/ sub-directory.
    let out_dir = std::env::temp_dir().join(format!("utter_{}", recording_id));
    std::fs::create_dir_all(out_dir.join("video")).map_err(|e| e.to_string())?;

    // Start multipart uploads.
    let client = make_s3_client()?;
    let video_upload_id =
        start_multipart(&client, &bucket, &video_key, "video/mp4").await?;
    let audio_upload_id =
        start_multipart(&client, &bucket, &audio_key, "audio/mp4").await?;

    // Register both uploads in shared uploader state.
    {
        let mut uploads = uploader_state.lock().map_err(|e| e.to_string())?;
        uploads.insert(
            format!("{}_video", recording_id),
            RecordingUpload {
                recording_id: recording_id.clone(),
                upload_id: video_upload_id,
                key: video_key.clone(),
                parts: Vec::new(),
                buffer: Vec::new(),
                next_part_number: 1,
            },
        );
        uploads.insert(
            format!("{}_audio", recording_id),
            RecordingUpload {
                recording_id: recording_id.clone(),
                upload_id: audio_upload_id,
                key: audio_key.clone(),
                parts: Vec::new(),
                buffer: Vec::new(),
                next_part_number: 1,
            },
        );
    }

    // Spawn the UtterRecorder sidecar.
    let out_dir_str = out_dir
        .to_str()
        .ok_or_else(|| "Invalid out_dir path".to_string())?
        .to_string();
    let (mut rx, child) = app
        .shell()
        .sidecar("UtterRecorder")
        .map_err(|e| e.to_string())?
        .args([
            "--out-dir",
            &out_dir_str,
            "--display-id",
            "0",
            "--mic-device",
            "default",
        ])
        .spawn()
        .map_err(|e| e.to_string())?;

    // Oneshot channel: the event loop sends () when the sidecar terminates.
    let (term_tx, term_rx) = tokio::sync::oneshot::channel::<()>();

    // Shared atomic counter for total video bytes uploaded.
    let video_bytes = Arc::new(AtomicU64::new(0));
    let video_bytes_clone = video_bytes.clone();

    // Shared atomic for the sidecar PID (set when "started" event arrives).
    let sidecar_pid = Arc::new(AtomicI32::new(-1));
    let sidecar_pid_clone = sidecar_pid.clone();

    // Store the handle.
    {
        let mut state = recorder_state.lock().map_err(|e| e.to_string())?;
        state.insert(
            recording_id.clone(),
            MacosRecorderHandle {
                child: Arc::new(Mutex::new(Some(child))),
                out_dir,
                video_key,
                audio_key,
                start_time: std::time::Instant::now(),
                video_bytes,
                sidecar_pid,
                terminated_rx: Arc::new(tokio::sync::Mutex::new(Some(term_rx))),
            },
        );
    }

    // Clone what we need to move into the tokio task.
    let uploader_state_clone = uploader_state.inner().clone();
    let recording_id_clone = recording_id.clone();
    let bucket_clone = bucket.clone();

    // Spawn a background task to read NDJSON events from the sidecar stdout.
    tokio::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        // `term_tx` is moved here; send on Terminated so stop_recording_macos can await it.
        let mut term_tx_opt = Some(term_tx);

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    let parsed: serde_json::Value = match serde_json::from_str(trimmed) {
                        Ok(v) => v,
                        Err(e) => {
                            eprintln!("[UtterRecorder] JSON parse error: {} — line: {}", e, trimmed);
                            continue;
                        }
                    };

                    let event_type = parsed["event"].as_str().unwrap_or("");

                    match event_type {
                        "started" => {
                            let pid = parsed["pid"].as_i64().unwrap_or(-1);
                            if pid > 0 {
                                sidecar_pid_clone.store(pid as i32, Ordering::Relaxed);
                            }
                            eprintln!("[UtterRecorder] started, pid={}", pid);
                        }
                        "chunk" => {
                            let kind = parsed["kind"].as_str().unwrap_or("");
                            let path = parsed["path"].as_str().unwrap_or("");
                            let seq = parsed["seq"].as_i64().unwrap_or(-1);

                            if kind == "video" {
                                match std::fs::read(path) {
                                    Ok(bytes) => {
                                        let byte_count = bytes.len() as u64;
                                        let data = Bytes::from(bytes);
                                        if let Err(e) = upload_fragment(
                                            &uploader_state_clone,
                                            &bucket_clone,
                                            &recording_id_clone,
                                            "video",
                                            data,
                                        )
                                        .await
                                        {
                                            eprintln!(
                                                "[UtterRecorder] upload_fragment error (seq={}): {}",
                                                seq, e
                                            );
                                        } else {
                                            // Track bytes only on successful upload.
                                            video_bytes_clone.fetch_add(byte_count, Ordering::Relaxed);
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[UtterRecorder] failed to read chunk (seq={}, path={}): {}",
                                            seq, path, e
                                        );
                                    }
                                }
                            }
                        }
                        "stopped" => {
                            eprintln!("[UtterRecorder] sidecar reported stopped");
                            // Don't break here — wait for the OS-level Terminated event.
                        }
                        "error" => {
                            eprintln!(
                                "[UtterRecorder] error — code={}, message={}",
                                parsed["code"].as_str().unwrap_or("?"),
                                parsed["message"].as_str().unwrap_or("?")
                            );
                        }
                        other => {
                            eprintln!("[UtterRecorder] unknown event: {}", other);
                        }
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    eprintln!(
                        "[UtterRecorder stderr] {}",
                        String::from_utf8_lossy(&line_bytes).trim()
                    );
                }
                CommandEvent::Terminated(status) => {
                    eprintln!(
                        "[UtterRecorder] process terminated, code={:?}",
                        status.code
                    );
                    // Signal stop_recording_macos that the sidecar has fully exited
                    // and audio.m4a is guaranteed to be flushed.
                    if let Some(tx) = term_tx_opt.take() {
                        let _ = tx.send(());
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Command: stop_recording_macos
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn stop_recording_macos(
    recording_id: String,
    uploader_state: State<'_, UploaderState>,
    recorder_state: State<'_, MacosRecorderState>,
) -> Result<(), String> {
    let bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());
    let web_base_url =
        std::env::var("WEB_BASE_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());
    let internal_token = std::env::var("INTERNAL_TOKEN").unwrap_or_default();

    // Retrieve and remove the handle.
    let handle = {
        let mut state = recorder_state.lock().map_err(|e| e.to_string())?;
        state
            .remove(&recording_id)
            .ok_or_else(|| format!("No recording found for id: {}", recording_id))?
    };

    let duration_sec = handle.start_time.elapsed().as_secs() as u32;
    let out_dir = handle.out_dir.clone();
    let video_key = handle.video_key.clone();
    let audio_key = handle.audio_key.clone();
    let video_bytes_counter = handle.video_bytes.clone();
    let terminated_rx_arc = handle.terminated_rx.clone();

    // Signal the sidecar to stop gracefully via SIGTERM so it can finalize audio.m4a.
    // We use the PID extracted from the "started" NDJSON event rather than child.kill(),
    // which would send SIGKILL and prevent the Swift AVAssetWriter from flushing.
    #[cfg(target_os = "macos")]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let pid = handle.sidecar_pid.load(Ordering::Relaxed);
        if pid > 0 {
            let _ = kill(Pid::from_raw(pid), Signal::SIGTERM);
        } else {
            // "started" event not yet received — fall back to SIGKILL.
            let mut child_guard = handle.child.lock().map_err(|e| e.to_string())?;
            if let Some(child) = child_guard.take() {
                let _ = child.kill();
            }
        }
    }

    // Wait for the sidecar process to fully terminate (signalled by the event loop task)
    // so that audio.m4a is guaranteed to be flushed before we read it.
    let term_rx = terminated_rx_arc
        .lock()
        .await
        .take()
        .ok_or_else(|| "terminated_rx already consumed".to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(15), term_rx)
        .await
        .map_err(|_| "Sidecar did not stop within 15s".to_string())?
        .map_err(|_| "Sidecar terminated channel dropped".to_string())?;

    let audio_path = out_dir.join("audio.m4a");

    // -----------------------------------------------------------------------
    // Finalize the video multipart upload.
    // -----------------------------------------------------------------------
    finalize_upload(
        uploader_state.inner(),
        &bucket,
        &format!("{}_video", recording_id),
    )
    .await?;

    // -----------------------------------------------------------------------
    // Upload the audio file.
    // The sidecar writes audio.m4a and flushes it before exiting.
    // -----------------------------------------------------------------------
    let audio_data = std::fs::read(&audio_path).map_err(|e| {
        format!("Failed to read audio.m4a ({}): {}", audio_path.display(), e)
    })?;
    let audio_size = audio_data.len() as u64;

    // Feed the entire audio file into the buffer so finalize_upload can flush it.
    {
        let mut uploads = uploader_state.lock().map_err(|e| e.to_string())?;
        let state_key = format!("{}_audio", recording_id);
        if let Some(u) = uploads.get_mut(&state_key) {
            u.buffer.extend_from_slice(&audio_data);
        }
    }

    finalize_upload(
        uploader_state.inner(),
        &bucket,
        &format!("{}_audio", recording_id),
    )
    .await?;

    // Accurate total: sum of all video chunk bytes fed into the uploader + audio file size.
    let video_size = video_bytes_counter.load(Ordering::Relaxed);
    let total_bytes = video_size + audio_size;

    // -----------------------------------------------------------------------
    // Notify the web app.
    // -----------------------------------------------------------------------
    let http_client = reqwest::Client::new();
    let resp = http_client
        .post(format!(
            "{}/api/recordings/{}/finalize",
            web_base_url, recording_id
        ))
        .header("Authorization", format!("Bearer {}", internal_token))
        .json(&serde_json::json!({
            "videoKey": video_key,
            "audioKey": audio_key,
            "durationSec": duration_sec,
            "sizeBytes": total_bytes,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Finalize webhook failed: HTTP {}", resp.status()));
    }

    // -----------------------------------------------------------------------
    // Cleanup temp directory.
    // -----------------------------------------------------------------------
    let _ = std::fs::remove_dir_all(&out_dir);

    Ok(())
}

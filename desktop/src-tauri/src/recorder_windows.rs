use crate::uploader::{
    complete_multipart, err_chain, make_s3_client, start_multipart, upload_part, RecordingUpload,
    UploadPart, UploaderState,
};
use bytes::Bytes;
use serde_json::{json, Value};
use tauri::State;

const MIN_PART_SIZE: usize = 5 * 1024 * 1024; // 5 MiB — S3 multipart minimum

/// Called by the webview at the start of recording.
/// Creates the recording stub and initiates the multipart upload.
#[tauri::command]
pub async fn init_recording(
    recording_id: String,
    state: State<'_, UploaderState>,
) -> Result<(), String> {
    let bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());
    let key = format!("recordings/{}/video.webm", recording_id);
    let client = make_s3_client()?;

    let upload_id = start_multipart(&client, &bucket, &key, "video/webm").await?;

    let mut uploads = state.lock().map_err(|e| e.to_string())?;
    uploads.insert(
        recording_id.clone(),
        RecordingUpload {
            recording_id,
            upload_id,
            key,
            parts: Vec::new(),
            buffer: Vec::new(),
            next_part_number: 1,
            total_bytes: 0,
        },
    );

    Ok(())
}

/// Called by the webview for each MediaRecorder chunk (every 5s).
/// Buffers chunks and uploads parts when buffer reaches 5 MiB.
#[tauri::command]
pub async fn upload_chunk(
    recording_id: String,
    _part_number: i32, // frontend chunk counter — S3 part numbering uses next_part_number from state
    bytes: Vec<u8>,
    state: State<'_, UploaderState>,
) -> Result<(), String> {
    let bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());

    let (upload_id, key, should_upload, data, s3_part_number) = {
        let mut uploads = state.lock().map_err(|e| e.to_string())?;
        let upload = uploads.get_mut(&recording_id).ok_or("Recording not found")?;
        upload.total_bytes += bytes.len() as u64;
        upload.buffer.extend_from_slice(&bytes);

        if upload.buffer.len() >= MIN_PART_SIZE {
            let s3_part_number = upload.next_part_number;
            upload.next_part_number += 1;
            let data = Bytes::from(upload.buffer.drain(..).collect::<Vec<u8>>());
            (upload.upload_id.clone(), upload.key.clone(), true, Some(data), s3_part_number)
        } else {
            (upload.upload_id.clone(), upload.key.clone(), false, None, 0)
        }
    };

    if should_upload {
        let client = make_s3_client()?;
        let etag =
            upload_part(&client, &bucket, &key, &upload_id, s3_part_number, data.unwrap()).await?;

        let mut uploads = state.lock().map_err(|e| e.to_string())?;
        if let Some(upload) = uploads.get_mut(&recording_id) {
            upload.parts.push(UploadPart { part_number: s3_part_number, etag });
        }
    }

    Ok(())
}

/// Called when recording stops. Flushes remaining buffer, completes multipart, notifies web.
#[tauri::command]
pub async fn finalize_recording(
    recording_id: String,
    duration_sec: u32,
    state: State<'_, UploaderState>,
) -> Result<(), String> {
    let bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());
    let web_base_url = std::env::var("WEB_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let internal_token = std::env::var("INTERNAL_TOKEN").unwrap_or_default();

    // Extract data without removing from the map — removal happens only on success.
    let (upload_id, key, buffer, mut parts, final_part_number, total_bytes) = {
        let uploads = state.lock().map_err(|e| e.to_string())?;
        let upload = uploads.get(&recording_id).ok_or("Recording not found")?;
        let final_part_number = upload.next_part_number;
        (
            upload.upload_id.clone(),
            upload.key.clone(),
            upload.buffer.clone(),
            upload.parts.clone(),
            final_part_number,
            upload.total_bytes,
        )
    };

    let client = make_s3_client()?;

    // Flush remaining buffer as the final part (even if <5 MiB — last part can be any size).
    if !buffer.is_empty() {
        let data = Bytes::from(buffer);
        let etag = upload_part(
            &client,
            &bucket,
            &key,
            &upload_id,
            final_part_number,
            data,
        )
        .await?;
        parts.push(UploadPart {
            part_number: final_part_number,
            etag,
        });
    }

    // Complete the multipart upload.
    complete_multipart(&client, &bucket, &key, &upload_id, &parts).await?;

    // Notify the web app and check the HTTP response status.
    let size_bytes = total_bytes;
    let client_http = reqwest::Client::new();
    let resp = client_http
        .post(format!(
            "{}/api/recordings/{}/finalize",
            web_base_url, recording_id
        ))
        .header("Authorization", format!("Bearer {}", internal_token))
        .json(&serde_json::json!({
            "videoKey": key,
            "durationSec": duration_sec,
            "sizeBytes": size_bytes,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Finalize webhook failed: HTTP {}", resp.status()));
    }

    // Remove upload state only after all operations succeed.
    let mut uploads = state.lock().map_err(|e| e.to_string())?;
    uploads.remove(&recording_id);

    Ok(())
}

/// Diagnostic command: reports R2 config (sanitized) and probes the bucket with HeadBucket.
/// Invoke from the UI to identify credential/bucket/connectivity issues without a full recording.
#[tauri::command]
pub async fn r2_diagnose() -> Result<Value, String> {
    let account_id = std::env::var("R2_ACCOUNT_ID").unwrap_or_default();
    let access_key = std::env::var("R2_ACCESS_KEY_ID").unwrap_or_default();
    let secret_key = std::env::var("R2_SECRET_ACCESS_KEY").unwrap_or_default();
    let bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());
    let endpoint = if account_id.is_empty() {
        "(R2_ACCOUNT_ID not set)".to_string()
    } else {
        format!("https://{}.r2.cloudflarestorage.com", account_id)
    };

    let config_snapshot = json!({
        "R2_ACCOUNT_ID": if account_id.is_empty() { "NOT SET".to_string() } else { format!("set ({} chars)", account_id.len()) },
        "R2_ACCESS_KEY_ID": if access_key.is_empty() { "NOT SET".to_string() } else { format!("{}… ({} chars)", &access_key[..access_key.len().min(4)], access_key.len()) },
        "R2_SECRET_ACCESS_KEY": if secret_key.is_empty() { "NOT SET".to_string() } else { format!("set ({} chars)", secret_key.len()) },
        "R2_BUCKET": bucket,
        "endpoint": endpoint,
    });

    let client = match make_s3_client() {
        Ok(c) => c,
        Err(e) => {
            return Ok(json!({ "config": config_snapshot, "headBucket": format!("client error: {}", e) }));
        }
    };

    let head_result = client
        .head_bucket()
        .bucket(&bucket)
        .send()
        .await
        .map(|_| "ok".to_string())
        .map_err(err_chain)
        .unwrap_or_else(|e| e);

    Ok(json!({ "config": config_snapshot, "headBucket": head_result }))
}

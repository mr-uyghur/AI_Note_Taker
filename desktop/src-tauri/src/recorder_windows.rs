use crate::uploader::{
    complete_multipart, make_s3_client, start_multipart, upload_part, RecordingUpload,
    UploadPart, UploaderState,
};
use bytes::Bytes;
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
    let client = make_s3_client();

    let upload_id = start_multipart(&client, &bucket, &key).await?;

    let mut uploads = state.lock().map_err(|e| e.to_string())?;
    uploads.insert(
        recording_id.clone(),
        RecordingUpload {
            recording_id,
            upload_id,
            key,
            parts: Vec::new(),
            buffer: Vec::new(),
        },
    );

    Ok(())
}

/// Called by the webview for each MediaRecorder chunk (every 5s).
/// Buffers chunks and uploads parts when buffer reaches 5 MiB.
#[tauri::command]
pub async fn upload_chunk(
    recording_id: String,
    part_number: i32,
    bytes: Vec<u8>,
    state: State<'_, UploaderState>,
) -> Result<(), String> {
    let bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());

    let (upload_id, key, should_upload, data) = {
        let mut uploads = state.lock().map_err(|e| e.to_string())?;
        let upload = uploads.get_mut(&recording_id).ok_or("Recording not found")?;
        upload.buffer.extend_from_slice(&bytes);

        if upload.buffer.len() >= MIN_PART_SIZE {
            let data = Bytes::from(upload.buffer.drain(..).collect::<Vec<u8>>());
            (upload.upload_id.clone(), upload.key.clone(), true, Some(data))
        } else {
            (upload.upload_id.clone(), upload.key.clone(), false, None)
        }
    };

    if should_upload {
        let client = make_s3_client();
        let etag =
            upload_part(&client, &bucket, &key, &upload_id, part_number, data.unwrap()).await?;

        let mut uploads = state.lock().map_err(|e| e.to_string())?;
        if let Some(upload) = uploads.get_mut(&recording_id) {
            upload.parts.push(UploadPart { part_number, etag });
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

    // Extract upload state (removes it from the map)
    let upload = {
        let mut uploads = state.lock().map_err(|e| e.to_string())?;
        uploads.remove(&recording_id).ok_or("Recording not found")?
    };

    let client = make_s3_client();

    // Flush remaining buffer as the final part (even if <5 MiB — last part can be any size)
    let mut parts = upload.parts;
    if !upload.buffer.is_empty() {
        let next_part_number = parts.len() as i32 + 1;
        let data = Bytes::from(upload.buffer);
        let etag = upload_part(
            &client,
            &bucket,
            &upload.key,
            &upload.upload_id,
            next_part_number,
            data,
        )
        .await?;
        parts.push(UploadPart {
            part_number: next_part_number,
            etag,
        });
    }

    // Complete the multipart upload
    complete_multipart(&client, &bucket, &upload.key, &upload.upload_id, &parts).await?;

    // Notify the web app
    let size_bytes = 0u64; // placeholder; actual size from S3 response is complex to extract here
    let client_http = reqwest::Client::new();
    client_http
        .post(format!(
            "{}/api/recordings/{}/finalize",
            web_base_url, recording_id
        ))
        .header("Authorization", format!("Bearer {}", internal_token))
        .json(&serde_json::json!({
            "videoKey": upload.key,
            "durationSec": duration_sec,
            "sizeBytes": size_bytes,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

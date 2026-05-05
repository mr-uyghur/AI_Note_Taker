use aws_sdk_s3::{
    config::{Credentials, Region},
    primitives::ByteStream,
    Client,
};
use bytes::Bytes;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct UploadPart {
    pub part_number: i32,
    pub etag: String,
}

pub struct RecordingUpload {
    pub recording_id: String,
    pub upload_id: String,
    pub key: String,
    pub parts: Vec<UploadPart>,
    pub buffer: Vec<u8>,
}

pub type UploaderState = Arc<Mutex<HashMap<String, RecordingUpload>>>;

pub fn make_s3_client() -> Client {
    let account_id = std::env::var("R2_ACCOUNT_ID").expect("R2_ACCOUNT_ID not set");
    let access_key = std::env::var("R2_ACCESS_KEY_ID").expect("R2_ACCESS_KEY_ID not set");
    let secret_key = std::env::var("R2_SECRET_ACCESS_KEY").expect("R2_SECRET_ACCESS_KEY not set");
    let _bucket = std::env::var("R2_BUCKET").unwrap_or_else(|_| "utter-recordings".to_string());

    let creds = Credentials::new(&access_key, &secret_key, None, None, "env");
    let endpoint = format!("https://{}.r2.cloudflarestorage.com", account_id);

    let config = aws_sdk_s3::Config::builder()
        .credentials_provider(creds)
        .region(Region::new("auto"))
        .endpoint_url(endpoint)
        .force_path_style(false)
        .build();

    Client::from_conf(config)
}

pub async fn start_multipart(
    client: &Client,
    bucket: &str,
    key: &str,
) -> Result<String, String> {
    let output = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .content_type("video/webm")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    output
        .upload_id()
        .map(|s| s.to_string())
        .ok_or_else(|| "No upload_id returned".to_string())
}

pub async fn upload_part(
    client: &Client,
    bucket: &str,
    key: &str,
    upload_id: &str,
    part_number: i32,
    data: Bytes,
) -> Result<String, String> {
    let output = client
        .upload_part()
        .bucket(bucket)
        .key(key)
        .upload_id(upload_id)
        .part_number(part_number)
        .body(ByteStream::from(data))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    output
        .e_tag()
        .map(|s| s.to_string())
        .ok_or_else(|| "No ETag in response".to_string())
}

pub async fn complete_multipart(
    client: &Client,
    bucket: &str,
    key: &str,
    upload_id: &str,
    parts: &[UploadPart],
) -> Result<(), String> {
    use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};

    let completed_parts: Vec<CompletedPart> = parts
        .iter()
        .map(|p| {
            CompletedPart::builder()
                .part_number(p.part_number)
                .e_tag(&p.etag)
                .build()
        })
        .collect();

    let completed = CompletedMultipartUpload::builder()
        .set_parts(Some(completed_parts))
        .build();

    client
        .complete_multipart_upload()
        .bucket(bucket)
        .key(key)
        .upload_id(upload_id)
        .multipart_upload(completed)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

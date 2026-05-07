use aws_sdk_s3::{
    config::{Credentials, Region},
    primitives::ByteStream,
    Client,
};
use bytes::Bytes;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct UploadPart {
    pub part_number: i32,
    pub etag: String,
}

#[derive(Clone)]
pub struct RecordingUpload {
    pub recording_id: String,
    pub upload_id: String,
    pub key: String,
    pub parts: Vec<UploadPart>,
    pub buffer: Vec<u8>,
    /// Monotonically incrementing S3 part counter, independent of frontend chunk numbers.
    pub next_part_number: i32,
    /// Cumulative bytes received across all chunks.
    pub total_bytes: u64,
}

pub type UploaderState = Arc<Mutex<HashMap<String, RecordingUpload>>>;

/// Walk the full `Error::source()` chain so callers see the real reason
/// instead of just the top-level variant tag (e.g. "service error").
fn err_chain<E: std::error::Error>(e: E) -> String {
    let mut s = e.to_string();
    let mut src: Option<&dyn std::error::Error> = e.source();
    while let Some(inner) = src {
        s.push_str(": ");
        s.push_str(&inner.to_string());
        src = inner.source();
    }
    s
}

pub fn make_s3_client() -> Result<Client, String> {
    let account_id =
        std::env::var("R2_ACCOUNT_ID").map_err(|_| "R2_ACCOUNT_ID not set".to_string())?;
    let access_key =
        std::env::var("R2_ACCESS_KEY_ID").map_err(|_| "R2_ACCESS_KEY_ID not set".to_string())?;
    let secret_key = std::env::var("R2_SECRET_ACCESS_KEY")
        .map_err(|_| "R2_SECRET_ACCESS_KEY not set".to_string())?;

    let creds = Credentials::new(&access_key, &secret_key, None, None, "env");
    let endpoint = format!("https://{}.r2.cloudflarestorage.com", account_id);

    let config = aws_sdk_s3::Config::builder()
        .credentials_provider(creds)
        .region(Region::new("auto"))
        .endpoint_url(endpoint)
        .force_path_style(false)
        .behavior_version_latest()
        .build();

    Ok(Client::from_conf(config))
}

pub async fn start_multipart(
    client: &Client,
    bucket: &str,
    key: &str,
    content_type: &str,
) -> Result<String, String> {
    let output = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .content_type(content_type)
        .send()
        .await
        .map_err(err_chain)?;

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
        .map_err(err_chain)?;

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

    // S3 requires parts in ascending part_number order.
    let mut sorted_parts: Vec<&UploadPart> = parts.iter().collect();
    sorted_parts.sort_by_key(|p| p.part_number);

    let completed_parts: Vec<CompletedPart> = sorted_parts
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
        .map_err(err_chain)?;

    Ok(())
}

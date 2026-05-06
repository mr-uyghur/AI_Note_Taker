import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

let _client: S3Client | undefined;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.WEB_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.WEB_R2_ACCESS_KEY_ID,
        secretAccessKey: env.WEB_R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

export async function getSignedGetUrl(key: string, expiresIn = 1800): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: env.WEB_R2_BUCKET, Key: key });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

import { z } from 'zod';

const schema = z.object({
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  INTERNAL_TOKEN: z.string().min(1),
  MONGODB_URI: z.string().url(),
  MONGODB_DB: z.string().min(1),
  SESSION_PASSWORD: z.string().min(32),
  GROQ_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  WEB_R2_ACCOUNT_ID: z.string().min(1),
  WEB_R2_ACCESS_KEY_ID: z.string().min(1),
  WEB_R2_SECRET_ACCESS_KEY: z.string().min(1),
  WEB_R2_BUCKET: z.string().min(1),
  WEB_BASE_URL: z.string().url(),
});

export const env = schema.parse(process.env);

import type { SessionOptions } from 'iron-session';
import { env } from './env';

export interface SessionData {
  isLoggedIn: boolean;
  username: string;
}

export const sessionOptions: SessionOptions = {
  password: env.SESSION_PASSWORD,
  cookieName: 'utter_admin',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
};

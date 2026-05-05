import { invoke } from '@tauri-apps/api/core';

export async function verifyAdmin(username: string, password: string): Promise<boolean> {
  return invoke<boolean>('verify_admin', { username, password });
}

export async function getAuthState(): Promise<boolean> {
  return invoke<boolean>('is_authenticated');
}

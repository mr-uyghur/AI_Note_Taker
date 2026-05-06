# Utter

Personal meeting recorder with AI transcript + Q&A chat.

## Apps

| App | Directory | Purpose |
|-----|-----------|---------|
| Desktop | `desktop/` | Tauri 2 app — records screen + audio, uploads to R2 |
| Web | `web/` | Next.js — admin dashboard, share links, Claude chat |

## Prerequisites

- [pnpm](https://pnpm.io) >= 9
- [Node.js](https://nodejs.org) >= 20
- [Rust](https://rustup.rs) stable (for desktop build)
- macOS 13+ **or** Windows 10+ for the desktop app
  - macOS: Xcode command-line tools (`xcode-select --install`) for the Swift sidecar
- [MongoDB](https://www.mongodb.com) running locally

## R2 Bucket setup (Cloudflare)

1. Create a bucket (e.g. `utter-recordings`) in the Cloudflare R2 dashboard.
2. Create an API token with **Object Read & Write** on that bucket.
3. Note your **Account ID**, **Access Key ID**, and **Secret Access Key** — used in the env files below.

## Environment variables

### Web (`web/.env.local`)

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
INTERNAL_TOKEN=some-long-random-string
SESSION_PASSWORD=at-least-32-chars-long-random-string
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=utter
WEB_BASE_URL=http://localhost:3000
GROQ_API_KEY=gsk_...
ANTHROPIC_API_KEY=sk-ant-...
WEB_R2_ACCOUNT_ID=<cloudflare-account-id>
WEB_R2_ACCESS_KEY_ID=<r2-access-key>
WEB_R2_SECRET_ACCESS_KEY=<r2-secret>
WEB_R2_BUCKET=utter-recordings
```

### Desktop (`desktop/src-tauri/.env` or set via system env)

```
DESKTOP_API_BASE=http://localhost:3000
DESKTOP_INTERNAL_TOKEN=same-value-as-INTERNAL_TOKEN-above
DESKTOP_R2_ACCOUNT_ID=<cloudflare-account-id>
DESKTOP_R2_ACCESS_KEY_ID=<r2-access-key>
DESKTOP_R2_SECRET_ACCESS_KEY=<r2-secret>
DESKTOP_R2_BUCKET=utter-recordings
```

## Running locally

### 1. Start MongoDB

```bash
mongod --dbpath /usr/local/var/mongodb
# or: brew services start mongodb-community
```

### 2. Start the web app

```bash
cd web
pnpm install
pnpm dev          # http://localhost:3000
```

Visit `http://localhost:3000/login`, sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 3. Start the desktop app

```bash
cd desktop
pnpm install
pnpm tauri dev    # opens the native window
```

On first run on macOS, you will be prompted to grant Screen Recording permission in System Preferences.

## Features

| Feature | Description |
|---------|-------------|
| Record | Screen + system audio + mic captured to fragmented MP4 (macOS) or WebM (Windows) |
| Transcribe | Groq Whisper large-v3 auto-runs after upload |
| Player | Video player with transcript sidebar; click a segment to seek |
| Chat | Ask Claude questions about the recording; timestamps are clickable |
| Share | Toggle a public share link per recording |
| Rename | Click the recording title to rename inline |

## Keyboard shortcuts (player)

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` | Seek −5 s |
| `→` | Seek +5 s |

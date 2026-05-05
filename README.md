# Utter

Personal meeting recorder with AI transcript Q&A.

## Apps

| App | Directory | Purpose |
|-----|-----------|---------|
| Desktop | `desktop/` | Tauri 2 app — records screen + audio, uploads to R2 |
| Web | `web/` | Next.js 15 — admin dashboard, share links, Claude chat |

## Prerequisites

- [pnpm](https://pnpm.io) >= 9
- [Node.js](https://nodejs.org) >= 20
- [Rust](https://rustup.rs) (for desktop build)
- [MongoDB](https://www.mongodb.com) running locally (`mongod`)
- macOS 13+ or Windows 10+ for the desktop app

## Setup

1. Copy `.env.example` to `.env` (or per-app `.env.local`) and fill in all values.
2. Create an R2 bucket named `utter-recordings` in Cloudflare, enable public access off.
3. Start MongoDB locally: `mongod --dbpath /usr/local/var/mongodb`

### Web

```bash
cd web
pnpm install
pnpm dev          # http://localhost:3000
```

### Desktop

```bash
cd desktop
pnpm install
pnpm tauri dev    # opens the native window
```

## Env Variables

See `.env.example` for all required variables and descriptions.

#!/usr/bin/env bash
# build.sh — compile UtterRecorder.swift into a universal macOS binary
# Usage: ./build.sh  (run from desktop/sidecars/macos/)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/UtterRecorder.swift"
OUT_DIR="$SCRIPT_DIR"

ARM64_BIN="$OUT_DIR/UtterRecorder-arm64"
X86_BIN="$OUT_DIR/UtterRecorder-x86_64"
UNIVERSAL="$OUT_DIR/UtterRecorder"

FRAMEWORKS="-framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia \
            -framework Foundation -framework AudioToolbox -framework CoreAudio"

echo "==> Building UtterRecorder for arm64 (aarch64-apple-macosx13.0) …" >&2
swiftc "$SRC" \
    -target aarch64-apple-macosx13.0 \
    $FRAMEWORKS \
    -O \
    -o "$ARM64_BIN"

echo "==> Building UtterRecorder for x86_64 (x86_64-apple-macosx13.0) …" >&2
swiftc "$SRC" \
    -target x86_64-apple-macosx13.0 \
    $FRAMEWORKS \
    -O \
    -o "$X86_BIN"

echo "==> Creating universal binary with lipo …" >&2
lipo -create "$ARM64_BIN" "$X86_BIN" -output "$UNIVERSAL"

echo "==> Making binary executable …" >&2
chmod +x "$UNIVERSAL"

echo "==> Cleaning up per-arch intermediates …" >&2
rm -f "$ARM64_BIN" "$X86_BIN"

echo "==> Done. Universal binary: $UNIVERSAL" >&2

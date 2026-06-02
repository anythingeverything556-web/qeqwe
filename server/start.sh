#!/bin/bash
cd "$(dirname "$0")"
export PORT=${PORT:-3000}
export VOICE_CACHE_PATH="${VOICE_CACHE_PATH:-./data/voice-cache.json}"
echo "Starting TTS Control Room server on port $PORT..."
node serve.js

#!/bin/bash
# Take a screenshot of the demo from specified camera angle
# Usage: ./take-screenshot.sh [camera] [output] [wait_ms]
# Camera: iso, top, front, side (default: iso)
# Output: filename (default: debug-screenshots/shot.png)
# Wait: milliseconds to wait before screenshot (default: 3000)

cd "$(dirname "$0")"

CAM="${1:-iso}"
OUTPUT="${2:-debug-screenshots/shot-$CAM-$(date +%H%M%S).png}"
WAIT="${3:-3000}"
PORT=5175

mkdir -p debug-screenshots

# Kill any existing server
pkill -f "vite preview --port $PORT" 2>/dev/null
sleep 1

# Build and start server
npm run build > /dev/null 2>&1
npx vite preview --port $PORT &
SERVER_PID=$!
sleep 2

# Take screenshot
if [ "$CAM" = "iso" ]; then
    shot-scraper "http://localhost:$PORT" -o "$OUTPUT" --wait "$WAIT" --width 1280 --height 720
else
    shot-scraper "http://localhost:$PORT" -o "$OUTPUT" --wait "$WAIT" --width 1280 --height 720 \
        --javascript "document.querySelector('[data-cam=\"$CAM\"]').click()"
fi

# Kill server
kill $SERVER_PID 2>/dev/null

echo "Screenshot saved to: $OUTPUT"

#!/bin/bash
# macOS / Linux 실행 스크립트
cd "$(dirname "$0")"
echo "http://localhost:8123 을 브라우저로 여세요 (종료: Ctrl+C)"
python3 -m http.server 8123

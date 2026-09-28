#!/bin/bash
# usage: gen.sh <out_name> <prompt> [ref_image]
cd "$(dirname "$0")/.."
NAME="$1"; PROMPT="$2"; REF="$3"
INSTR="Call your built-in image generation tool EXACTLY ONCE, passing the prompt below VERBATIM (do not rewrite, shorten or 'improve' it). If a reference image is attached, use it as the visual reference for the character design. Then copy the resulting PNG to ./assets/raw/${NAME}.png. Do nothing else.

PROMPT:
${PROMPT}"
if [ -n "$REF" ]; then
  codex exec -s workspace-write --skip-git-repo-check "$INSTR" -i "$REF" > "assets/raw/${NAME}.log" 2>&1 < /dev/null
else
  codex exec -s workspace-write --skip-git-repo-check "$INSTR" > "assets/raw/${NAME}.log" 2>&1 < /dev/null
fi
ls -la "assets/raw/${NAME}.png" 2>/dev/null || echo "FAILED ${NAME}"

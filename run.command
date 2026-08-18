#!/bin/zsh
set -e
SCRIPT_DIR="${0:A:h}"
APP_PATH="$SCRIPT_DIR/src-tauri/target/release/bundle/macos/EditWeave.app"

if [[ -d "$APP_PATH" ]]; then
  open "$APP_PATH"
  exit 0
fi

cd "$SCRIPT_DIR"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm이 필요합니다. Node.js와 pnpm을 설치한 뒤 다시 실행해주세요."
  read -k 1 "?아무 키나 누르면 닫힙니다."
  exit 1
fi
pnpm desktop:dev

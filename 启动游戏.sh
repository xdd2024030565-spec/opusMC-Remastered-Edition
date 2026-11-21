#!/bin/sh
# 起一个本地静态服务器再打开 index.html。
# 直接双击 index.html 也能玩（file://），但如果浏览器禁止本地文件读同目录资源，
# 用这个脚本最稳，区块线程、音效表、模组资源都能正常加载。
cd "$(dirname "$0")" || exit 1
PORT="${1:-8765}"
URL="http://127.0.0.1:$PORT/"
echo "游戏地址：$URL   （Ctrl+C 结束）"
if command -v xdg-open >/dev/null 2>&1; then (sleep 1; xdg-open "$URL" >/dev/null 2>&1 &) ; fi
if command -v termux-open-url >/dev/null 2>&1; then (sleep 1; termux-open-url "$URL" >/dev/null 2>&1 &) ; fi
exec python3 -m http.server "$PORT" --bind 127.0.0.1

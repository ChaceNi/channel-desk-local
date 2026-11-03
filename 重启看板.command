#!/bin/zsh
cd "${0:A:h}" || exit 1
node scripts/stop-local.mjs || { read '?按回车关闭'; exit 1; }
node scripts/start-local.mjs || { read '?按回车关闭'; exit 1; }
open "http://127.0.0.1:${PORT:-5188}/"
read '?看板已重新启动，按回车关闭'

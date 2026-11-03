#!/bin/zsh
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '需要 Node.js 22.13 或更新版本。'; read '?按回车关闭'; exit 1
fi
if [[ ! -d node_modules ]]; then
  npm install || exit 1
fi
if [[ ! -f dist/index.html ]]; then
  npm run build || exit 1
fi
node scripts/start-local.mjs || { read '?按回车关闭'; exit 1; }
open "http://127.0.0.1:${PORT:-5188}/"
print '看板已在后台运行，关闭此窗口不影响同事访问。'
read '?按回车关闭'

#!/bin/zsh
cd "${0:A:h}" || exit 1
node scripts/stop-local.mjs
read '?按回车关闭'

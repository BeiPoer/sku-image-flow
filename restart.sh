#!/usr/bin/env bash
# 线上部署/重启脚本：拉代码 → 装 web 依赖（仅缺失时）→ 构建前端 → pm2 重启
# 用法：sh restart.sh / bash restart.sh / ./restart.sh   （默认会 git pull）
#       sh restart.sh --no-pull   （跳过 git pull，仅重新构建并重启）
# 注：不用 `set -o pipefail`（dash/sh 不支持）；set -eu 足够，任一命令失败即退出。
set -eu

APP_NAME="sku-image-flow"
# 切到脚本所在目录，保证在哪执行都对
cd "$(dirname "$0")"

# 1) 拉代码（可用 --no-pull 跳过）
if [ "${1:-}" != "--no-pull" ]; then
  echo "==> git pull"
  git pull
fi

# 2) 安装 web 依赖：node_modules 缺失，或 package-lock 比 node_modules 新时才装
if [ ! -d web/node_modules ] || [ web/package-lock.json -nt web/node_modules ]; then
  echo "==> 安装 web 依赖"
  npm --prefix web install
else
  echo "==> web 依赖已是最新，跳过 install"
fi

# 3) 构建前端（产物输出到 ./dist）
echo "==> 构建前端"
npm --prefix web run build

# 4) 校验构建产物
if [ ! -f dist/index.html ]; then
  echo "!! 构建失败：未生成 dist/index.html，已中止，不重启服务" >&2
  exit 1
fi

# 5) pm2 重启（存在则 restart，否则首次 start）
# 直接跑 server.mjs，绕开 package.json 的 prestart（前面已构建过，避免重复 build）
echo "==> pm2 重启 $APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.mjs --name "$APP_NAME" --node-args="--experimental-sqlite"
fi

pm2 save >/dev/null 2>&1 || true
echo "==> 完成。查看日志：pm2 logs $APP_NAME"

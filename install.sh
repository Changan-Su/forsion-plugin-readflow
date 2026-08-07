#!/usr/bin/env bash
# 装/更新「稍后读」插件到 Forsion 家目录。
#   用法:sh install.sh [dev|prod]     缺省 dev(~/.forsion-dev);prod=~/.forsion
# 本仓即插件本体:整目录拷到 <home>/plugins/readflow/ 一处即完成——
#   桌面识别 manifest.json(UI 插件)+ spaces/(内嵌「稍后读」Space)。
set -euo pipefail
MODE="${1:-dev}"
case "$MODE" in
  dev)  HOME_DIR="$HOME/.forsion-dev" ;;
  prod) HOME_DIR="$HOME/.forsion" ;;
  *) echo "用法:sh install.sh [dev|prod]" >&2; exit 2 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME_DIR/plugins/readflow"

# 不许从已安装目录内自更新:下面的 rm -rf 会先删掉复制源(自己),把插件卸成空壳
if [ "$HERE" = "$(cd "$DEST" 2>/dev/null && pwd || true)" ]; then
  echo "❌ 正在从已安装目录运行,请从源码仓的 forsion-plugin-readflow/ 目录执行 install.sh" >&2
  exit 2
fi

mkdir -p "$HOME_DIR/plugins"
rm -rf "$DEST"
cp -R "$HERE" "$DEST"

echo "✅ 已安装 → $DEST"
echo "重开 Forsion(dev:重启 desktop)后:命令面板「稍后读:打开」,或工作台切到「稍后读」Space。"

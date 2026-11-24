#!/usr/bin/env bash
# FlexHotel üretim yayını (sunucuda çalışır): main'i çeker, bağımlılıkları kurar, migration'ları uygular,
# ön yüzü derler ve statik klasöre kopyalar, backend servisini yeniden başlatır, sağlık ucunu yoklar.
#
#   ssh root@SUNUCU 'bash /home/public_html/api/scripts/deploy-prod.sh'
#
# Varsayımlar (bugünkü kurulum): depo /home/public_html/api (dal: main), ortam dosyası /home/public_html/api/.env
# (DATABASE_URL, VITE_API_URL, JWT_*, SETTINGS_SECRET_KEY…), backend systemd birimi `hotelos`, ön yüz statik kökü
# /home/public_html/hotel (misafir portalı aynı derlemede `misafir/` altına çıkar). Dosya sahibi `www`.
set -euo pipefail

REPO="${REPO:-/home/public_html/api}"
WEB_ROOT="${WEB_ROOT:-/home/public_html/hotel}"
SERVICE="${SERVICE:-hotelos}"
OWNER="${OWNER:-www}"
BRANCH="${BRANCH:-main}"

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

cd "$REPO"
log "Depo güncelleniyor ($BRANCH)"
git fetch --quiet origin
git checkout --quiet "$BRANCH"
git pull --ff-only --quiet origin "$BRANCH"
git log -1 --format='  %h %ad %s' --date=short

log "Bağımlılıklar"
# İsteğe bağlı bağımlılıklar atlanmaz: vite / tailwind / rollup yerel ikilileri onlardadır.
npm install --no-audit --no-fund 2>&1 | tail -1

log "Veritabanı (prisma generate + migrate deploy)"
set -a; source "$REPO/.env"; set +a
HEALTH_URL="${HEALTH_URL:-http://${HOST:-127.0.0.1}:${PORT:-3000}/health}"
(cd hotel/backend && npx prisma generate >/dev/null && npx prisma migrate deploy 2>&1 | tail -2)

log "Ön yüz derleniyor (panel + misafir portalı)"
rm -rf hotel/frontend/dist
(cd hotel/frontend && npm run build 2>&1 | tail -6)
test -f hotel/frontend/dist/index.html || { echo "Ön yüz derlemesi başarısız; eski statik dosyalar yerinde bırakıldı." >&2; exit 1; }

log "Statik dosyalar → $WEB_ROOT"
mkdir -p "$WEB_ROOT"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete hotel/frontend/dist/ "$WEB_ROOT"/
else
  find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a hotel/frontend/dist/. "$WEB_ROOT"/
fi
chown -R "$OWNER:$OWNER" "$REPO" "$WEB_ROOT"

log "Backend yeniden başlatılıyor ($SERVICE)"
systemctl restart "$SERVICE"
for _ in $(seq 1 20); do
  if code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL") && [ "$code" = "200" ]; then
    echo "  sağlık: $code"
    systemctl is-active "$SERVICE"
    exit 0
  fi
  sleep 1
done
echo "  UYARI: sağlık ucu 20 sn içinde 200 dönmedi; journalctl -u $SERVICE -n 50" >&2
journalctl -u "$SERVICE" -n 30 --no-pager >&2
exit 1

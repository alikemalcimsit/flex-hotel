git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true#!/usr/bin/env bash
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true# FlexHotel üretim yayını (sunucuda çalışır): main'i çeker, bağımlılıkları kurar, migration'ları uygular,
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true# ön yüzü derler ve statik klasöre kopyalar, backend servisini yeniden başlatır, sağlık ucunu yoklar.
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true#
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true#   ssh root@SUNUCU 'bash /home/public_html/api/scripts/deploy-prod.sh'
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true#
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true# Varsayımlar (bugünkü kurulum): depo /home/public_html/api (dal: main), ortam dosyası /home/public_html/api/.env
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true# (DATABASE_URL, VITE_API_URL, JWT_*, SETTINGS_SECRET_KEY…), backend systemd birimi `hotelos`, ön yüz statik kökü
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true# /home/public_html/hotel (misafir portalı aynı derlemede `misafir/` altına çıkar). Dosya sahibi `www`.
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueset -euo pipefail
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueREPO="${REPO:-/home/public_html/api}"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueWEB_ROOT="${WEB_ROOT:-/home/public_html/hotel}"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueSERVICE="${SERVICE:-hotelos}"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueOWNER="${OWNER:-www}"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueBRANCH="${BRANCH:-main}"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truelog() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truecd "$REPO"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truelog "Depo güncelleniyor ($BRANCH)"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truegit fetch --quiet origin
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true# Derleme öncesi üretilen kılavuz referansı ağacı kirletebilir; depodaki sürüme dönülür (yeniden üretilecek).
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true|| true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truegit checkout --quiet "$BRANCH"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truegit pull --ff-only --quiet origin "$BRANCH"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truegit log -1 --format='  %h %ad %s' --date=short
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truelog "Bağımlılıklar"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true# İsteğe bağlı bağımlılıklar atlanmaz: vite / tailwind / rollup yerel ikilileri onlardadır.
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truenpm install --no-audit --no-fund 2>&1 | tail -1
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truelog "Veritabanı (prisma generate + migrate deploy)"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueset -a; source "$REPO/.env"; set +a
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueHEALTH_URL="${HEALTH_URL:-http://${HOST:-127.0.0.1}:${PORT:-3000}/health}"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true(cd hotel/backend && npx prisma generate >/dev/null && npx prisma migrate deploy 2>&1 | tail -2)
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truelog "Ön yüz derleniyor (panel + misafir portalı)"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truerm -rf hotel/frontend/dist
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true(cd hotel/frontend && npm run build 2>&1 | tail -6)
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truetest -f hotel/frontend/dist/index.html || { echo "Ön yüz derlemesi başarısız; eski statik dosyalar yerinde bırakıldı." >&2; exit 1; }
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truelog "Statik dosyalar → $WEB_ROOT"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truemkdir -p "$WEB_ROOT"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueif command -v rsync >/dev/null 2>&1; then
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true  rsync -a --delete hotel/frontend/dist/ "$WEB_ROOT"/
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueelse
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true  find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true  cp -a hotel/frontend/dist/. "$WEB_ROOT"/
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truefi
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truechown -R "$OWNER:$OWNER" "$REPO" "$WEB_ROOT"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truelog "Backend yeniden başlatılıyor ($SERVICE)"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truesystemctl restart "$SERVICE"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truefor _ in $(seq 1 20); do
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true  if code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL") && [ "$code" = "200" ]; then
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true    echo "  sağlık: $code"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true    systemctl is-active "$SERVICE"
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true    exit 0
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true  fi
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || true  sleep 1
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truedone
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueecho "  UYARI: sağlık ucu 20 sn içinde 200 dönmedi; journalctl -u $SERVICE -n 50" >&2
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || truejournalctl -u "$SERVICE" -n 30 --no-pager >&2
git checkout --quiet -- hotel/frontend/src/guide/90-teknik-referans.md package-lock.json 2>/dev/null || trueexit 1

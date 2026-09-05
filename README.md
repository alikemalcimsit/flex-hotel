# HotelOS (flex-hotel)

Otonom aktör ağıyla çalışan otel yönetim sistemi. Modül sırası: `MODUL-SIRASI.md`. Görev listesi: `GOREVLER.md`.

## 1. Sunucuda veritabanı kurulumu (bir kere, Ubuntu)

```bash
sudo apt install postgresql
sudo -u postgres psql
```
```sql
CREATE USER hotelos WITH PASSWORD 'GUCLU_SIFRE';
CREATE DATABASE hotelos OWNER hotelos;
\q
```

Dışarıdan bağlantı için:
- `/etc/postgresql/*/main/postgresql.conf` → `listen_addresses = '*'`
- `/etc/postgresql/*/main/pg_hba.conf` → sonuna sadece ikinizin IP'si için satır: `host hotelos hotelos SENIN_IP/32 md5`
- `sudo systemctl restart postgresql`
- Firewall: `sudo ufw allow from SENIN_IP to any port 5432`

## 2. Geliştirici bilgisayarında (Mac ve Windows)

Gereksinim: Node.js 22 veya üstü (https://nodejs.org).

1. `.env.example` dosyasını `.env` adıyla kopyala, `DATABASE_URL` satırını doldur.
2. Komutlar:

```bash
npm install
npm run db:migrate     # tabloları oluşturur
npm run db:seed        # demo verisi
npm run dev            # backend + frontend birlikte
```

- Backend: http://localhost:3000/health
- Frontend: http://localhost:5173 (admin@hotel.local / admin123)
- Veritabanı arayüzü: `npm run db:studio`

Sadece birini açmak için: `npm run dev:backend` veya `npm run dev:frontend`.

## Klasörler

- `shared/` → sektörden bağımsız çekirdek (core, actor-kit, ui, auth, channels, agents, workers, mcp-server)
- `hotel/` → otel paketi (frontend, backend, agents, workers)
- `clinic/` → gelecek sektör paketi (boş)

Kurallar: sadece JavaScript (ESM), TypeScript yok, test yok. Backend modülleri `hotel/backend/src/modules/`, sayfalar `hotel/frontend/src/pages/`.

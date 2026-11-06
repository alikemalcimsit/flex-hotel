# FlexHotel — Sunum ve Hakimiyet Dökümanları

Bu klasör, yarınki müşteri sunumu için hazırlandı. İki amacı var:

1. **Hakimiyet:** Projeyi (kodu AI ile yazılmış olsa da) baştan sona anlaman için.
2. **Sunum:** Müşteriye güvenle anlatman, demo yapman ve zor sorulara net cevap verebilmen için.

Tüm iddialar gerçek koddan (`dosya:satır`) doğrulanarak yazıldı — tahmin yok.

## Okuma sırası

| Dosya | Ne için | Ne zaman oku |
|---|---|---|
| [`00-GENEL-BAKIS.md`](00-GENEL-BAKIS.md) | Ürün ne, hangi problemi çözüyor, farklılaştırıcılar, **yapıldı/yol haritası haritası** | İlk; büyük resmi kur |
| [`01-MIMARI.md`](01-MIMARI.md) | Sistemin kalbi: aktör ağı, olay akışı, onay, veri bütünlüğü, güvenlik | Hakimiyet için en önemli; 2 kez oku |
| [`02-MODULLER-ON-BURO.md`](02-MODULLER-ON-BURO.md) | Modül 1–22: ön büro + operasyon + para | Modül modül çalış |
| [`03-MODULLER-ARKA-OFIS.md`](03-MODULLER-ARKA-OFIS.md) | Modül 23–47: raporlama, satış/kanal, F&B/POS, stok, muhasebe + AI ajanları | Modül modül çalış |
| [`04-SUNUM-VE-SORU-CEVAP.md`](04-SUNUM-VE-SORU-CEVAP.md) | Sunum anlatısı, konuşma metni, **40+ soru-cevap bankası** | Sunumdan önceki akşam ezberle |
| [`05-DEMO-REHBERI.md`](05-DEMO-REHBERI.md) | Canlı demo: nasıl çalıştırılır, adım adım senaryo, **demoda patlamasın notları** | Demo provası yaparken |

## En kritik 3 şey (bunları unutma)

1. **Dürüstlük seni korur.** ~68 modülden ~32'si tam yazılmış. Yazılmamış modülleri "bitti" gösterme; "mimari hazır, yol haritasında" de. Müşteri "göster" derse açığa çıkarsın. Yapıldı/yol haritası haritası `00-GENEL-BAKIS.md`'de.
2. **Farklılaştırıcı = otonom aktör ağı + güvenli insan onayı.** Rakip otel yazılımlarının olmadığı şey bu. Sunumun kalbi burası olmalı (`01-MIMARI.md`).
3. **Demo öncesi hazırlık şart.** Backend + socket ayakta, demo veritabanı dolu, (AI göstereceksen) `OPENAI_API_KEY` tanımlı olmalı. Detay `05-DEMO-REHBERI.md`'de.

## Teknoloji özeti (tek bakış)

- **Backend:** Node.js (saf JavaScript ESM, TypeScript yok), Fastify, Prisma + PostgreSQL
- **Frontend:** React + Vite + Tailwind v4 + TanStack Query + Zustand + Socket.IO
- **Mimari:** Olay-güdümlü otonom aktör ağı (`shared/actor-kit`, `shared/core`)
- **AI:** OpenAI (gerçek resmi SDK) + LangGraph; router / concierge / budget ajanları
- **Monorepo:** npm workspaces — `shared/` (sektör bağımsız çekirdek) + `hotel/` (otel paketi) + `clinic/` (gelecek sektör, boş)
- **Kurumsal site:** `web/` — ayrı FlexAI tanıtım sitesi (ürün paketinin parçası değil)

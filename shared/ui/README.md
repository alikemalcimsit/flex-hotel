# @hotelos/ui

Ortak React bileşenleri (Tailwind 4). Görünüm Spark Admin şablonunun tasarım dilinden
uyarlandı, renkler FlexAI'ın.

| Bileşen | Not |
|---|---|
| `Button` | `variant`: primary · secondary · outline · danger · dangerSoft (tablo satırında silme) · ghost — `size`: sm · md — `icon` |
| `Card` | `title` verilirse başlığıyla etiketlenen `<section>`; `description`, `actions` |
| `Input`, `Select`, `Textarea` | `label`, `error` (hata `aria-describedby` ile alana bağlı) — `Input`: `trailing` (sağ iç denetim) · `Select`: `compact` (tablo satırı) |
| `LABEL_CLASS`, `ERROR_CLASS` | form bileşeni dışında (örn. `fieldset` başlığı) aynı etiket/hata görünümü |
| `Checkbox` | `label`, `hint` |
| `Alert` | `tone`: info · success · warning · danger (danger `role="alert"`) |
| `Badge` | `tone`: neutral · success · warning · danger · info · sky · violet |
| `EmptyState`, `Spinner` | boş ve yükleniyor durumları |
| `Icon` | tek kaynaklı SVG ikon seti (Lucide yolları, ISC) — adlar `ICON_NAMES` |

**Jetonlar uygulamada tanımlı.** Sınıflar (`bg-ink`, `text-ink-muted`, `rounded-control`...)
kullanan uygulamanın `@theme` bloğundan gelir — bkz. `hotel/frontend/src/index.css`. Paket
node_modules üzerinden bağlandığı için uygulamanın CSS'i `@source` ile bu klasörü taramalı.

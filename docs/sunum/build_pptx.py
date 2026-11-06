#!/usr/bin/env python3
"""FlexHotel — otelciye (patron) sunum. Koyu tema + kırmızı vurgu (FlexAI markası).
İş değeri odaklı, bölüm ayraçlı, her slaytta konuşma notu."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ---- Marka renkleri ----
INK      = RGBColor(0x0E, 0x0E, 0x0E)
CARD     = RGBColor(0x1B, 0x1B, 0x1B)
CARD_RED = RGBColor(0x24, 0x13, 0x13)
RED      = RGBColor(0xEF, 0x44, 0x44)
RED_STR  = RGBColor(0xDC, 0x26, 0x26)
WHITE    = RGBColor(0xF6, 0xF6, 0xF6)
GRAY     = RGBColor(0xB0, 0xB0, 0xB0)
DGRAY    = RGBColor(0x82, 0x82, 0x82)
LINE     = RGBColor(0x30, 0x30, 0x30)
GREEN    = RGBColor(0x3A, 0xD6, 0x9E)
GOLD     = RGBColor(0xE8, 0xB4, 0x4A)

HEAD = "Space Grotesk"
BODY = "Plus Jakarta Sans"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
_n = [0]


def slide(bg=INK):
    s = prs.slides.add_slide(BLANK)
    # Keynote uyumu: slide.background yerine tam-kaplama dikdörtgen
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    r.fill.solid(); r.fill.fore_color.rgb = bg
    r.line.fill.background(); r.shadow.inherit = False
    return s


def note(s, text):
    s.notes_slide.notes_text_frame.text = text.strip()


def box(s, l, t, w, h, anchor=MSO_ANCHOR.TOP):
    tb = s.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = 0; tf.margin_right = 0; tf.margin_top = 0; tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    return tf


def para(tf, runs, size=18, color=WHITE, bold=False, font=BODY, align=PP_ALIGN.LEFT,
         before=0, after=8, leading=1.08, first=False):
    p = tf.paragraphs[0] if first and not tf.paragraphs[0].runs else tf.add_paragraph()
    p.alignment = align
    p.space_before = Pt(before)
    p.space_after = Pt(after)
    try:
        p.line_spacing = leading
    except Exception:
        pass
    if isinstance(runs, str):
        runs = [(runs, {})]
    for text, opt in runs:
        r = p.add_run()
        r.text = text
        r.font.size = Pt(opt.get("size", size))
        r.font.bold = opt.get("bold", bold)
        r.font.name = opt.get("font", font)
        r.font.color.rgb = opt.get("color", color)
    return p


def rect(s, l, t, w, h, fill=CARD, line=LINE, line_w=0.75, rounded=True):
    shp = s.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE, l, t, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line; shp.line.width = Pt(line_w)
    shp.shadow.inherit = False
    return shp


def kicker(s, text):
    rect(s, Inches(0.9), Inches(0.62), Inches(0.28), Inches(0.08), fill=RED_STR, line=None, rounded=False)
    tf = box(s, Inches(1.28), Inches(0.5), Inches(10.5), Inches(0.4))
    para(tf, text.upper(), size=12.5, color=RED, bold=True, font=HEAD, after=0, first=True)


def title(s, text, size=32):
    tf = box(s, Inches(0.9), Inches(0.98), Inches(11.6), Inches(1.15))
    para(tf, text, size=size, color=WHITE, bold=True, font=HEAD, after=0, first=True, leading=1.0)


def footer(s):
    _n[0] += 1
    tf = box(s, Inches(0.9), Inches(7.04), Inches(9), Inches(0.33))
    para(tf, [("FlexHotel", {"color": RED, "bold": True, "font": HEAD, "size": 9.5}),
              ("  ·  FlexAI  ·  hotel.flexai.tr", {"color": DGRAY, "size": 9.5})], after=0, first=True)
    tf2 = box(s, Inches(11.9), Inches(7.04), Inches(0.9), Inches(0.33))
    para(tf2, str(_n[0]), size=9.5, color=DGRAY, align=PP_ALIGN.RIGHT, after=0, first=True)


def bullets(s, items, top=2.1, left=0.9, width=11.6, gap=0.9, size=18):
    t = top
    for it in items:
        tf = box(s, Inches(left), Inches(t), Inches(width), Inches(gap))
        if isinstance(it, tuple):
            head, rest = it
            runs = [("—  ", {"color": RED, "bold": True, "size": size}),
                    (head, {"color": WHITE, "bold": True, "size": size})]
            if rest:
                runs.append(("  " + rest, {"color": GRAY, "size": size - 3}))
        else:
            runs = [("—  ", {"color": RED, "bold": True, "size": size}),
                    (it, {"color": WHITE, "size": size})]
        para(tf, runs, after=0, first=True, leading=1.06)
        t += gap


def cards(s, items, top=2.0, cols=2, left=0.9, total_w=11.6, gap=0.3, ch=1.5, accent=False,
          head_sz=16.5, body_sz=12.5):
    cw = (total_w - gap * (cols - 1)) / cols
    for i, (head, body) in enumerate(items):
        r, c = divmod(i, cols)
        cl = Inches(left + c * (cw + gap)); ct = Inches(top + r * (ch + gap))
        card = rect(s, cl, ct, Inches(cw), Inches(ch),
                    fill=CARD_RED if accent else CARD, line=RED_STR if accent else LINE)
        tf = card.text_frame; tf.word_wrap = True
        tf.margin_left = Inches(0.24); tf.margin_right = Inches(0.2)
        tf.margin_top = Inches(0.17); tf.margin_bottom = Inches(0.12)
        para(tf, head, size=head_sz, color=WHITE, bold=True, font=HEAD, after=5, first=True, leading=1.0)
        if body:
            para(tf, body, size=body_sz, color=GRAY, after=0, leading=1.08)


def checklist(s, items, top=2.15, cols=2, mark="✓", mark_color=GREEN, size=15, col_w=5.6, gap=9):
    half = (len(items) + cols - 1) // cols
    for ci in range(cols):
        chunk = items[ci * half:(ci + 1) * half]
        tf = box(s, Inches(0.9 + ci * (col_w + 0.3)), Inches(top), Inches(col_w), Inches(4.6))
        for j, m in enumerate(chunk):
            if isinstance(m, tuple):
                mm, extra = m
                runs = [(mark + "  ", {"color": mark_color, "bold": True, "size": size}),
                        (mm, {"color": WHITE, "size": size, "bold": True}),
                        ("  " + extra, {"color": DGRAY, "size": size - 2})]
            else:
                runs = [(mark + "  ", {"color": mark_color, "bold": True, "size": size}),
                        (m, {"color": WHITE, "size": size})]
            para(tf, runs, after=gap, first=(j == 0), leading=1.02)


def steps(s, items, top=2.15, left=0.9, width=11.6, gap=1.18):
    t = top
    for num, head, body in items:
        c = rect(s, Inches(left), Inches(t), Inches(0.62), Inches(0.62), fill=CARD_RED, line=RED_STR)
        tfc = c.text_frame; tfc.vertical_anchor = MSO_ANCHOR.MIDDLE
        para(tfc, str(num), size=20, color=RED, bold=True, font=HEAD, align=PP_ALIGN.CENTER, after=0, first=True)
        tf = box(s, Inches(left + 0.85), Inches(t - 0.02), Inches(width - 0.9), Inches(gap))
        para(tf, head, size=17, color=WHITE, bold=True, font=HEAD, after=3, first=True, leading=1.0)
        para(tf, body, size=13, color=GRAY, after=0, leading=1.06)
        t += gap


def section(s, num, titletext, sub=None):
    rect(s, 0, 0, Inches(0.22), Inches(7.5), fill=RED_STR, line=None, rounded=False)
    tf = box(s, Inches(1.0), Inches(2.5), Inches(3), Inches(1.4))
    para(tf, f"{num:02d}", size=84, color=CARD, bold=True, font=HEAD, after=0, first=True)
    # kırmızı küçük numara üstte
    tf2 = box(s, Inches(1.05), Inches(2.35), Inches(6), Inches(0.5))
    para(tf2, f"BÖLÜM {num:02d}", size=13, color=RED, bold=True, font=HEAD, after=0, first=True)
    tf3 = box(s, Inches(1.05), Inches(3.9), Inches(11), Inches(1.6))
    para(tf3, titletext, size=38, color=WHITE, bold=True, font=HEAD, after=6, first=True, leading=1.02)
    if sub:
        para(tf3, sub, size=17, color=GRAY, leading=1.1)


# ================================================================= SLAYTLAR

# 1 — KAPAK
s = slide()
rect(s, 0, 0, Inches(0.22), Inches(7.5), fill=RED_STR, line=None, rounded=False)
# canlıda rozeti
badge = rect(s, Inches(0.95), Inches(1.35), Inches(2.35), Inches(0.5), fill=CARD_RED, line=RED_STR)
tfb = badge.text_frame; tfb.vertical_anchor = MSO_ANCHOR.MIDDLE
para(tfb, [("●  ", {"color": GREEN, "size": 12, "bold": True}),
           ("CANLIDA — ÜRETİMDE", {"color": WHITE, "size": 11.5, "bold": True, "font": HEAD})],
     align=PP_ALIGN.CENTER, after=0, first=True)
tf = box(s, Inches(0.95), Inches(2.35), Inches(11.6), Inches(1.5))
para(tf, [("Flex", {"color": RED, "bold": True, "font": HEAD, "size": 68}),
          ("Hotel", {"color": WHITE, "bold": True, "font": HEAD, "size": 68})], after=0, first=True)
tf = box(s, Inches(0.98), Inches(3.7), Inches(11.6), Inches(1.2))
para(tf, "Yapay zekâ ile çalışan otel yönetim sistemi", size=23, color=WHITE, font=HEAD, after=6, first=True)
para(tf, [("İşin tekrarı yazılıma, ", {"color": GRAY, "size": 17}),
          ("kararlar size.", {"color": RED, "size": 17, "bold": True})])
tf = box(s, Inches(0.98), Inches(6.65), Inches(11.5), Inches(0.5))
para(tf, [("FlexAI", {"color": RED, "bold": True, "font": HEAD, "size": 12}),
          ("   ·   hotel.flexai.tr   ·   Ürün tanıtımı · Kasım 2026", {"color": DGRAY, "size": 12})],
     after=0, first=True)
note(s, """Açılış (30 sn). "Size FlexHotel'i tanıtacağım — otelin tüm işini tek sistemde toplayan,
rutini yapay zekâ ile kendiliğinden yapan ama kararı size bırakan bir sistem.
En önemlisi: bu bir maket değil, şu an CANLIDA, üretimde çalışıyor — hotel.flexai.tr.
Sloganımız her şeyi özetliyor: işin tekrarı yazılıma, kararlar size." Özgüvenli ve kısa başla.""")

# 2 — BÖLÜM 1
s = slide()
section(s, 1, "Otelcinin derdi", "Oteli yöneten değil, yazılımla boğuşan bir gün")
note(s, """Geçiş slaytı. "Önce bugünkü tabloyu konuşalım — eminim tanıdık gelecek." Patronla empati kur;
onun her gün yaşadığı sorunları senin de bildiğini göster. Bu, güven kurmanın ilk adımı.""")

# 3 — Dertler
s = slide()
kicker(s, "Tanıdık geliyor mu?")
title(s, "Her otel aynı sorunlarla boğuşuyor")
cards(s, [
    ("Dağınık sistemler", "PMS ayrı, kanal yöneticisi ayrı, muhasebe ayrı, restoran ayrı. Hiçbiri diğerini tutmuyor; aynı veri üç kez giriliyor."),
    ("Kaçan gelir", "Minibar, geç çıkış, oda servisi folyoya düşmüyor; tahsilat muhasebeye geçmiyor. Ay sonu mizan tutmuyor."),
    ("Çifte satış (overbooking)", "İki resepsiyonist aynı odayı aynı anda satıyor; kanaldan gelen rezervasyon elde yok."),
    ("7/24 cevap yok", "Gece gelen WhatsApp mesajı sabaha kadar cevapsız; rezervasyon rakibe gidiyor."),
    ("Personele bağımlılık", "“O arkadaş işi biliyordu, ayrıldı.” Süreç kafalarda, sistemde değil."),
    ("Görünürlük yok", "“Bu neden böyle oldu?” sorusunun izlenebilir bir cevabı yok."),
], top=1.95, cols=3, ch=1.9, head_sz=15, body_sz=11.5)
footer(s)
note(s, """(2 dk) Bu altı derdi tek tek, otelcinin diliyle anlat. Her birinde kısa bir örnek ver:
"Minibarı kat görevlisi görür ama folyoya düşmezse o gelir buharlaşır." Patronun başını salladığını göreceksin —
amaç bu. Çözümü henüz anlatma; önce derdi sahiplendiğini göster. Sonra 'işte tam da bunun için FlexHotel' diye bağla.""")

# 4 — Yaklaşım (marka ifadesi)
s = slide()
rect(s, 0, 0, Inches(0.22), Inches(7.5), fill=RED_STR, line=None, rounded=False)
kicker(s, "Yaklaşımımız")
tf = box(s, Inches(0.9), Inches(2.1), Inches(11.6), Inches(2))
para(tf, [("İşin tekrarı ", {"color": WHITE, "bold": True, "font": HEAD, "size": 44}),
          ("yazılıma,", {"color": RED, "bold": True, "font": HEAD, "size": 44})], after=2, first=True, leading=1.02)
para(tf, [("kararlar ", {"color": WHITE, "bold": True, "font": HEAD, "size": 44}),
          ("size.", {"color": RED, "bold": True, "font": HEAD, "size": 44})], leading=1.02)
tf = box(s, Inches(0.95), Inches(4.5), Inches(11), Inches(2))
para(tf, "Tek bir dev yapay zekâ değil; her biri tek işten sorumlu “dijital çalışanlar” kuruyoruz.",
     size=19, color=GRAY, after=8, first=True)
para(tf, "Sınırını aştığında işi size devreder ve neden devrettiğini yazar. Sessizce yanlış karar veren sistem, hiç karar vermeyenden kötüdür.",
     size=19, color=GRAY)
footer(s)
note(s, """(1 dk) Markanın özü. "Biz yapay zekâyı vitrin için kullanmıyoruz. Her işi devretmeden önce şunu soruyoruz:
burada gerçekten karar verebilir mi, veremediğinde ne yapacak? Net değilse o iş insanda kalır."
Bu cümle patrona güven verir — abartı satmadığını gösterir.""")

# 5 — FlexHotel nedir
s = slide()
kicker(s, "Peki FlexHotel ne?")
title(s, "Otelin tüm işi tek sistemde — canlı ve çalışır")
bullets(s, [
    ("Uçtan uca.", "Rezervasyon, ön büro, kat hizmetleri, folyo/ödeme, restoran/POS, satın alma, ön muhasebe — tek sistem, tek doğruluk kaynağı."),
    ("Otonom.", "Rutin işi dijital çalışanlar yapar; resepsiyon “işi sisteme bırakıp” misafire bakar."),
    ("Kontrollü.", "Para ve risk içeren her kararda sistem durup size onay sorar."),
    ("Güvenli.", "Çifte satış ve para hatası yazılımla değil, veritabanı seviyesinde engellenir."),
    ("Üretimde.", "Bugün hotel.flexai.tr üzerinde canlı çalışıyor — maket değil."),
], top=2.15, gap=0.92)
footer(s)
note(s, """(1 dk) Tek cümlelik tanım + 5 ayırt edici nitelik. Son maddeyi vurgula: "Bunlar slaytta güzel duran sözler değil;
şu an canlıda çalışıyor, birazdan göstereceğim." Demoya köprü kur.""")

# 6 — BÖLÜM 2
s = slide()
section(s, 2, "Sistemin içinde dijital çalışanlar var", "Otonom aktör ağı — ama kontrol sizde")
note(s, """Geçiş. "Şimdi bizi diğerlerinden ayıran şeye gelelim: dijital çalışanlar." Bu bölüm farklılaştırıcı — enerjini buraya koy.""")

# 7 — Otonom aktör ağı (ne yapar + nasıl)
s = slide()
kicker(s, "Dijital çalışanlar")
title(s, "Resepsiyon uyur, sisteminiz uyumaz")
cards(s, [
    ("Oda aktörü", "“Rezervasyon oluştu” olayını duyar; o gecelerde boş odaları hesaplar, en uygununu (bugün gelen için önce temiz+boş) seçip atar."),
    ("Folyo aktörü", "Giriş/çıkış ve her harcama olayını duyar; hesabı açar, gece ücretini ve kalemleri işler, bakiyesi sıfır folyoyu kapatır."),
    ("Kanal aktörü", "Müsaitlik/fiyat değişince etkilenen günleri işaretler; yalnız değişen günleri Channex.io’ya gönderir, o da OTA’lara yazar."),
    ("Muhasebe aktörü", "Mal kabul/tahsilat olayını duyar; ilgili cari ya da kasayı bulup borç/giriş kaydını yazar. Aynı belge iki kez işlenmez."),
    ("Concierge (AI)", "Misafirin niyetini duyar; gerçek müsaitlik/fiyatı sorgular, teklif sunar, yalnız açık onayda rezervasyon ister."),
    ("Bildirim aktörü", "Onay/hoş geldiniz gibi olayları duyar; mesajı misafirin dilinde hazırlayıp gönderim kuyruğuna yazar."),
], top=Inches(1.95), cols=3, ch=2.0, head_sz=14, body_sz=10.5)
footer(s)
note(s, """(1.5 dk) Her aktörü bir ekip üyesi gibi anlat; artık kartta "nasıl" yaptığı da yazıyor.
Otelci "nasıl otomatik?" diye sorarsa bir sonraki slayt (mekanizma) tam bu soruya cevap.""")

# 7b — Mekanizma: nasıl otomatik?
s = slide()
kicker(s, "Mekanizma")
title(s, "Peki nasıl “otomatik”? — perde arkası")
mflow = ["Mal kabul\nirsaliye girilir", "Olay üretilir\ntedarikçi · tutar · vade",
         "Muhasebe aktörü\nolayı dinler", "Cariye yazılır\nborç + vade"]
mfw, mfh, mfy, mfx0 = 2.7, 1.35, 2.25, 0.9
mcols = [CARD, CARD, CARD, CARD_RED]
for i, (txt, col) in enumerate(zip(mflow, mcols)):
    fx = Inches(mfx0 + i * (mfw + 0.33))
    c = rect(s, fx, Inches(mfy), Inches(mfw), Inches(mfh), fill=col, line=RED_STR if i == 3 else LINE)
    tf = c.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    head, sub = txt.split("\n")
    para(tf, head, size=15, color=WHITE, bold=True, font=HEAD, align=PP_ALIGN.CENTER, after=3, first=True)
    para(tf, sub, size=10.5, color=GRAY, align=PP_ALIGN.CENTER, after=0, leading=1.05)
    if i < 3:
        ar = box(s, Inches(mfx0 + i * (mfw + 0.33) + mfw + 0.01), Inches(mfy), Inches(0.32), Inches(mfh),
                 anchor=MSO_ANCHOR.MIDDLE)
        para(ar, "›", size=28, color=RED, bold=True, align=PP_ALIGN.CENTER, after=0, first=True)
bullets(s, [
    ("Her işlem bir olay üretir", "— ne olduğu, tutarı ve vadesi içinde (mal kabulde: tedarikçi, KDV-dahil tutar, vade)."),
    ("Sorumlu aktör olayı dinler ve kaydı yazar", "— tedarikçinin cari hesabını bulur, yoksa açar, borcu vadesiyle işler."),
    ("Her kayıt yalnız bir kez işlenir", "— aynı irsaliye iki kez borç yazmaz (tekil anahtar). Sihir değil: olay + sorumlu aktör + değişmez kayıt."),
], top=Inches(4.1), gap=0.82, size=16)
footer(s)
note(s, """(1.5 dk) "Otomatik nasıl?" sorusunun cevabı. Mal kabul örneğini soldan sağa anlat: irsaliye girilir → olay çıkar →
muhasebe aktörü duyar → tedarikçi carisine borç+vade yazılır. "Aynı mantık her yerde: tahsilat→kasa, çıkış→folyo kapanışı."
"Aynı belge iki kez işlenmez" vurgusu güven verir.""")

# 8 — Akış diyagramı
s = slide()
kicker(s, "Nasıl çalışır")
title(s, "Bir rezervasyonun otonom yolculuğu")
flow = ["Misafir\nWhatsApp'tan yazar", "Concierge\nmüsaitlik + fiyat, teklif", "Siz / AI\nonay",
        "Aktörler\noda + folyo + bildirim + kanal"]
fw, fh, fy, fx0 = 2.7, 1.5, 2.6, 0.9
cols = [CARD, CARD, CARD_RED, CARD]
for i, (txt, col) in enumerate(zip(flow, cols)):
    fx = Inches(fx0 + i * (fw + 0.33))
    c = rect(s, fx, Inches(fy), Inches(fw), Inches(fh), fill=col, line=RED_STR if i == 2 else LINE)
    tf = c.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    head, sub = txt.split("\n")
    para(tf, head, size=16, color=WHITE, bold=True, font=HEAD, align=PP_ALIGN.CENTER, after=3, first=True)
    para(tf, sub, size=11, color=GRAY, align=PP_ALIGN.CENTER, after=0, leading=1.05)
    if i < 3:
        ar = box(s, Inches(fx0 + i * (fw + 0.33) + fw + 0.01), Inches(fy), Inches(0.32), Inches(fh),
                 anchor=MSO_ANCHOR.MIDDLE)
        para(ar, "›", size=30, color=RED, bold=True, align=PP_ALIGN.CENTER, after=0, first=True)
bullets(s, [
    ("Saniyeler içinde, insan dokunmadan", "— ama onay adımı her zaman sizde."),
    ("Tüm zincir tek ekranda izlenir", "— “bu rezervasyon neden böyle açıldı?” tek tıkla görünür."),
], top=4.75, gap=0.8, size=16)
footer(s)
note(s, """(1.5 dk) Diyagramı soldan sağa anlat. "Misafir gece yazdı, concierge fiyat verdi, misafir evet dedi,
onay adımından geçti ve dört ayrı dijital çalışan aynı anda işe koyuldu: oda atandı, folyo açıldı, kanal güncellendi,
onay mesajı gitti. Sabah resepsiyon açıldığında her şey hazır." Onay kutusunun kırmızı olması bilinçli — kontrol vurgusu.""")

# 9 — Güvenli otomasyon
s = slide()
kicker(s, "Kontrol sizde — 1")
title(s, "Parada kararı insan verir")
bullets(s, [
    ("Otomatik onay kuyruğu.", "Büyük ödeme, iade, overbooking, folyo iptali, eşik üstü satın alma → otomatik yetkiliye düşer."),
    ("Kaldığı yerden.", "Onayladığınız an iş, çift işleme olmadan tam kaldığı yerden tamamlanır."),
    ("Dört göz kuralı.", "İsteyen kendi isteğini onaylayamaz; iki yönetici aynı işi çakıştıramaz."),
    ("Net sınır.", "Yapay zekâ oteli işletir; ama kasaya, iadeye, büyük tutara insan karar verir."),
], top=2.2, gap=0.95)
footer(s)
note(s, """(1 dk) Patronun en çok merak edeceği şey: "AI benim iznim olmadan para hareketi yapar mı?" Cevap net: HAYIR.
"Eşik koyarsınız; o eşiğin üstü size sorulur, siz onaylayana kadar kasaya girmez." Güven mesajı.""")

# 10 — Aktör paneli
s = slide()
kicker(s, "Kontrol sizde — 2")
title(s, "Dijital ekibinizi tek ekrandan yönetin")
cards(s, [
    ("Tek tıkla aç/kapat", "Her dijital çalışanı istediğiniz an durdurursunuz. Otel, hepsi kapalıyken bile elle çalışır."),
    ("“Kapatırsam ne durur?”", "Panel, bir aktörü kapatmanın etkisini önceden gösterir."),
    ("İş kaybolmaz", "Kapalı aktörün işi personelin görev listesine düşer — okunur başlıkla."),
    ("AI maliyeti şeffaf", "Yapay zekânın günlük harcaması bütçeye karşı ekranda; sürpriz fatura yok."),
], top=2.1, cols=2, ch=1.6)
footer(s)
note(s, """(1 dk) "Otomasyona mahkûm değilsiniz. Güvenmediğiniz bir otomasyonu kapatırsınız; işi personeliniz görür.
Yavaş yavaş güven arttıkça açarsınız." Bu, otomasyona temkinli yaklaşan patronun en çok sevdiği mesajdır.""")

# 11 — BÖLÜM 3
s = slide()
section(s, 3, "Ne kazandırır?", "Gelir ↑  ·  kaçak ↓  ·  iş gücü ↓  ·  kontrol ↑")
note(s, """Geçiş. "Teknolojiyi bir yana bırakalım — bu sistem cebinize ne yapar?" Patron bu bölümü bekliyor. Somut konuş.""")

# 12 — Daha çok gelir
s = slide()
kicker(s, "Kazanç — 1")
title(s, "Daha çok gelir, daha az boş oda")
bullets(s, [
    ("Kanallar hep güncel.", "Booking, Expedia, Airbnb, Agoda fiyat ve müsaitliği saniyeler içinde eşitlenir — boş oda kanalda kapalı kalmaz."),
    ("Boş geceyi önceden gör.", "30 günlük tahmin (geçen yılın verisiyle), zayıf günleri haftalar önce gösterir — kampanyayı zamanında kur."),
    ("ADR / RevPAR canlı.", "Doluluk, ortalama fiyat ve oda başı gelir her an gözünüzün önünde."),
    ("7/24 satış.", "Gece gelen misafiri AI concierge karşılar, teklif sunar — rezervasyon rakibe gitmez."),
], top=2.2, gap=0.95)
footer(s)
note(s, """(1.5 dk) Gelir hikayesi. Forecast'ı vurgula: "Boş kalacak bir haftayı 15 gün önceden görürseniz, o haftaya
promosyon kurup doldurursunuz. Göremezseniz oda boş gider — o gelir bir daha gelmez." RevPAR/ADR dilini kullan, otelci sever.""")

# 13 — Kaçan gelir sıfır
s = slide()
kicker(s, "Kazanç — 2")
title(s, "Kaçan gelir sıfır, mizan kuruşu kuruşuna")
bullets(s, [
    ("Her harcama folyoya.", "Minibar, çamaşır, oda servisi, geç çıkış — kat görevlisinin telefonundan bile folyoya düşer, kaçmaz."),
    ("Otomatik muhasebe.", "Her tahsilat, mal kabulü kendiliğinden cariye/kasaya işlenir; aynı para iki kez sayılmaz."),
    ("Kuruş garantisi.", "Restoran hesabı folyoya kuruşu kuruşuna aynı yansır; para hesabı ondalık aritmetikle, yuvarlama hatasız."),
    ("Çek/senet takibi.", "Portföyden tahsile, karşılıksız çıkarsa cariyi yeniden borçlandırmaya kadar — hiçbir kâğıt kaybolmaz."),
], top=2.2, gap=0.95)
footer(s)
note(s, """(1.5 dk) Bu slayt muhasebeden anlayan patron için altın. "Çoğu otelde gelirin bir kısmı sessizce buharlaşır:
folyoya düşmeyen minibar, muhasebeye geçmeyen tahsilat. Burada her kuruş yakalanır ve otomatik muhasebeye düşer.
Ay sonu mizan kuruşu kuruşuna tutar." Gerçek bir acıya dokunuyorsun.""")

# 14 — Daha az iş gücü + hata
s = slide()
kicker(s, "Kazanç — 3")
title(s, "Daha az iş gücü, neredeyse sıfır hata")
bullets(s, [
    ("Rutin kendiliğinden.", "Oda atama, folyo, bildirim, kanal güncelleme — personel bunlarla uğraşmaz, misafire bakar."),
    ("Overbooking imkânsız.", "Aynı oda iki misafire satılamaz — uygulama + veritabanı, iki kat garanti."),
    ("Yanlış fiyat durur.", "Ekrandaki ücretle sistemin hesabı tutmazsa işlem durur; sessiz yanlış tahsilat olmaz."),
    ("Bilgi sistemde.", "Süreç kafalarda değil sistemde; personel ayrılsa da otel aksamaz."),
], top=2.2, gap=0.95)
footer(s)
note(s, """(1 dk) İş gücü + hata. "Overbooking bir otelin itibarını da parasını da yer. Burada bu matematiksel olarak imkânsız."
'Personele bağımlılık' derdine de dokun: 'O arkadaş ayrıldı, iş aksadı' tablosunu bitirir.""")

# 15 — Kontrol & güven
s = slide()
kicker(s, "Kazanç — 4")
title(s, "Tam kontrol ve içiniz rahat")
bullets(s, [
    ("Her şeyin izi var.", "Kim, ne, ne zaman yaptı — değişmez denetim defteri. Bir işlemin tüm zinciri tek ağaçta."),
    ("Canlı sabah ekranı.", "Doluluk, gelir, bekleyen işler, kasa durumu — otelin nabzı tek bakışta."),
    ("Yetki her istekte.", "Kat görevlisi parayı/folyoyu göremez; yetki ekranda değil, sunucuda zorlanır."),
    ("KVKK’ya uygun.", "Kimlik, telefon, kart maskeli; hassas bilgiler şifreli saklanır."),
], top=2.2, gap=0.95)
footer(s)
note(s, """(1 dk) Patronun gönül rahatlığı. "İstediğiniz an 'bu oda neden bedava verildi' diye sorarsınız, cevabı iziyle çıkar.
Denetim geldiğinde hazırlanacak bir şey kalmaz." Audit + KVKK + yetki = kurumsal güven.""")

# 16 — BÖLÜM 4
s = slide()
section(s, 4, "Otelin bir günü FlexHotel ile", "Modüller, işin kendi akışıyla")
note(s, """Geçiş. "Şimdi tek tek modül saymak yerine, bir otelin gününü sistemle birlikte yaşayalım." Senaryo anlatımı ilgi çeker.""")

# 17 — Senaryo 1
s = slide()
kicker(s, "Senaryo — gece")
title(s, "Gece 02:00 · WhatsApp’tan rezervasyon")
steps(s, [
    (1, "Misafir yazar", "“15–18 Ekim 2 kişilik odanız var mı?” — WhatsApp’tan, gece yarısı."),
    (2, "Concierge cevaplar", "Müsaitliği ve gece gece fiyatı gerçek veriden çeker, net bir teklif sunar."),
    (3, "Misafir onaylar", "“Evet” der. Sistem fiyatı ve müsaitliği son kez doğrular."),
    (4, "Zincir çalışır", "Rezervasyon açılır, oda atanır, onay kodu yazılır, karşılama mesajı gider — insan dokunmadan."),
], top=2.1, gap=1.12)
footer(s)
note(s, """(1.5 dk) Canlı, somut senaryo. "Bu konuşma siz uyurken oldu. Sabah geldiğinizde rezervasyon hazır, oda atanmış.
Önemli: concierge misafir açıkça 'evet' demeden rezervasyon açmaz, fiyatı göndermeden önce bir daha kontrol eder —
yani yanlış fiyata oda satmaz." Güvenlik + kazanç bir arada.""")

# 18 — Senaryo 2
s = slide()
kicker(s, "Senaryo — gündüz")
title(s, "Giriş → konaklama → çıkış → yeniden satış")
steps(s, [
    (1, "Check-in", "Tek tıkla giriş: oda “dolu” olur, folyo açılır, teminat işlenir, kanallar güncellenir."),
    (2, "Konaklama", "Minibar, oda servisi, çamaşır otomatik folyoya düşer; hiçbir gelir kaçmaz."),
    (3, "Check-out", "Kalan geceler + geç çıkış ücreti işlenir; bakiye sıfırsa folyo kapanır."),
    (4, "Temizlik & yeniden satış", "Oda otomatik temizlik listesine düşer; şef onaylayınca kanallara geri açılır."),
], top=2.1, gap=1.12)
footer(s)
note(s, """(1.5 dk) Otelcinin günlük döngüsü. Vurgu: "Her adım bir sonrakini kendiliğinden tetikliyor — resepsiyonun
'şimdi şunu da yapmam lazım' dediği her şey otomatik. Oda boşalır boşalmaz temizliğe, temizlenince satışa döner.
Oda bir dakika bile boş yere kapalı kalmaz." """)

# 19 — Ön büro modülleri
s = slide()
kicker(s, "Kapsam — Ön büro & operasyon (hazır)")
title(s, "Resepsiyonun ihtiyacı olan her şey")
checklist(s, [
    "Rezervasyon (tek · grup · bekleme listesi)", "Oda planı / takvim (sürükle-bırak)",
    "Müsaitlik & otomatik oda atama", "Check-in / Check-out",
    "Folyo (harcama · böl · birleştir · iptal)", "Ödeme (nakit · kart · döviz)",
    "Kat hizmetleri (housekeeping)", "Misafir mesaj & istek takibi",
    "WhatsApp / web chat ile AI rezervasyon", "Bildirim merkezi (SMS · e-posta)",
    "Minibar & çamaşır", "Kayıp eşya",
    "Günlük durum (ADR · RevPAR · doluluk)", "Onay kuyruğu + aktör paneli",
], top=2.1, cols=2)
footer(s)
note(s, """(1 dk) Hızlı tara, her maddede durma. "Bunların hepsi bugün çalışıyor." Yeşil tikler 'bitti' demek.
Eğer sorarlarsa fatura/night audit gibi bazılarının yol haritasında olduğunu dürüstçe söyle (Bölüm 6).""")

# 20 — Gelir & satış
s = slide()
kicker(s, "Kapsam — Gelir & satış (hazır)")
title(s, "Daha çok satmanın araçları")
checklist(s, [
    "Gelir raporları (ADR / RevPAR / doluluk)", "30 günlük forecast (pickup)",
    "Bütçe + sapma + AI yorum", "Kontrat & acente yönetimi",
    "Promosyon & kupon", "Acente prim / sadakat",
    "Kanal yönetimi — gerçek Channex.io", "OTA senkron + stop-sale + iCal",
], top=2.15, cols=2)
footer(s)
note(s, """(1 dk) Gelir tarafı. Channex'i vurgula: "Kanal yönetimi gerçek bir entegrasyon — Booking, Expedia, Airbnb'ye
gerçekten bağlanıyor." Forecast ve RevPAR raporu otelci için en değerli iki şey.""")

# 21 — F&B / POS
s = slide()
kicker(s, "Kapsam — Restoran & oda servisi (hazır)")
title(s, "Restoran, mutfak ve oda servisi")
checklist(s, [
    "Restoran POS (masa · adisyon · böl/birleştir)", "“Odaya yaz” — folyoya kuruşu kuruşuna",
    "Oda servisi (QR’dan sipariş)", "Oda servisi panosu (mutfak görünümü)",
    "Menü & reçete (maliyet · gıda-maliyeti %)", "Reçete maliyeti yetkiye göre gizli",
    "Banket & etkinlik (salon · teklif · PDF)", "Banket F&B (kişiye göre malzeme + maliyet)",
], top=2.15, cols=2)
footer(s)
note(s, """(1 dk) F&B. "Odaya yaz" kuruş garantisini vurgula — restoran ↔ folyo entegrasyonu çoğu sistemde sorunludur.
QR oda servisi modern bir dokunuş, misafir deneyimi puanı.""")

# 22 — Muhasebe & satın alma
s = slide()
kicker(s, "Kapsam — Arka ofis (hazır)")
title(s, "Satın alma ve ön muhasebe — otomatik")
checklist(s, [
    "Satın alma (talep → teklif → sipariş → mal kabul)", "Tedarikçi borcu otomatik oluşur (vadeli)",
    "Ön muhasebe: cari hesaplar + FIFO yaşlandırma", "Kasa / banka (kasa eksiye düşmez)",
    "Çek / senet (tam durum makinesi)", "Fişler + dört göz onayı",
    "Stok: giriş + hareketli ortalama maliyet", "Tahsilat/mal kabul → otomatik muhasebe kaydı",
], top=2.15, cols=2)
footer(s)
note(s, """(1 dk) Ön muhasebe grubun en güçlü yanı. "Tahsilat kendiliğinden muhasebeye düşüyor, aynı para iki kez sayılmıyor.
Çek karşılıksız çıkarsa cari otomatik yeniden borçlanıyor." Dürüstlük: stokta çıkış/fire/sayım, tam genel muhasebe yol haritasında.""")

# 23 — BÖLÜM 5
s = slide()
section(s, 5, "Neden güvenebilirsiniz", "Canlıda çalışıyor · veriniz güvende · gerçek entegrasyon")
note(s, """Geçiş. "Peki buna neden güvenesiniz?" Üç kanıt sunacağız: üretimde olması, veri güvenliği, gerçek entegrasyonlar.""")

# 24 — Canlıda
s = slide()
rect(s, 0, 0, Inches(0.22), Inches(7.5), fill=RED_STR, line=None, rounded=False)
kicker(s, "Kanıt — 1")
title(s, "Maket değil — bugün üretimde çalışıyor")
badge = rect(s, Inches(0.9), Inches(2.2), Inches(5.6), Inches(1.1), fill=CARD_RED, line=RED_STR)
tfb = badge.text_frame; tfb.vertical_anchor = MSO_ANCHOR.MIDDLE; tfb.margin_left = Inches(0.3)
para(tfb, [("●  ", {"color": GREEN, "size": 15, "bold": True}),
           ("hotel.flexai.tr", {"color": WHITE, "size": 22, "bold": True, "font": HEAD})], after=0, first=True)
bullets(s, [
    ("Gerçek ortamda, gerçek veriyle.", "Gösterdiğimiz her ekran canlı sistemden — ekran görüntüsü değil."),
    ("İki kişilik ekip, tam sorumluluk.", "Mimariyi kuran, kodu yazan, sunucuyu ayağa kaldıran ve telefonu açan aynı kişiler."),
    ("Kurduğumuzu biz işletiriz.", "Sunucu, yedek, güncelleme, gece yarısı çıkan sorun — hepsi bizde."),
], top=3.7, gap=0.92)
footer(s)
note(s, """(1 dk) EN GÜÇLÜ SLAYT. "İsterseniz şimdi açıp canlı girelim." Mümkünse gerçekten aç (hotel.flexai.tr/login).
Çoğu rakip 'yapacağız' der; sizinki çalışıyor. İki kişilik ekibi zayıflık değil güç olarak sun:
'Aradığınız kişi kodu yazan kişi, arada kayıp yok.' """)

# 25 — Veri bütünlüğü & güvenlik
s = slide()
kicker(s, "Kanıt — 2")
title(s, "Veriniz ve paranız güvende")
cards(s, [
    ("Çifte satış imkânsız", "Uygulama kilidi + veritabanı kuralı — iki kat. Son odayı iki kişi aynı anda satamaz."),
    ("Para kaybolmaz", "Ondalık aritmetik, kuruş hatası yok. Silinen kayıt sessizce geri gelmez."),
    ("Değişmez iz", "Her değişiklik + işlem silinmeyen denetim defterinde. Kim ne yaptı — kanıtıyla."),
    ("Kurumsal güvenlik", "Rol bazlı yetki (sunucuda), şifreli sırlar, KVKK maskeleme, güvenli oturum."),
], top=2.1, cols=2, ch=1.6)
footer(s)
note(s, """(1 dk) Güven mühendisliği. Otelci diliyle: "Bunlar yazılımın 'umarım doğru çalışır' dediği yerler değil;
veritabanı seviyesinde garanti. Yani program hata yapsa bile aynı oda iki kez satılamaz." """)

# 26 — Gerçek entegrasyonlar
s = slide()
kicker(s, "Kanıt — 3")
title(s, "Dışarıyla gerçekten konuşuyor")
cards(s, [
    ("Kanal yöneticisi", "Channex.io ile Booking · Expedia · Airbnb · Agoda + iCal. Fark-bazlı canlı senkron."),
    ("Yapay zekâ", "OpenAI — gerçek, bütçe kontrollü. Misafir sohbeti ve bütçe yorumu."),
    ("WhatsApp & web chat", "Meta resmî API + güvenli oturum. Çift gönderim engelli."),
    ("Açık API & dışa aktarım", "Veriniz bizde hapis değil; ilk günden dışa aktarım ve webhook var."),
], top=2.1, cols=2, ch=1.6, accent=False)
footer(s)
note(s, """(1 dk) "Mock yok, gerçek bağlantı." Açık API/dışa aktarımı vurgula: "Yarın başka sisteme geçmek isterseniz
veriniz standart biçimde sizinle gelir — rehin almıyoruz." Bu, bağımsız bir patronun duymak istediği şeydir.
KBS/e-Fatura gibi resmi entegrasyonlar yol haritasında (dürüst ol).""")

# 27 — BÖLÜM 6
s = slide()
section(s, 6, "Yol haritası ve başlangıç", "Bugün hazır olan, sırada olan ve nasıl başlayacağımız")
note(s, """Geçiş. Dürüstlük bölümü. "Her şeyin bittiğini iddia etmiyoruz — neyin hazır, neyin sırada olduğunu açık söyleriz." """)

# 28 — Yol haritası
s = slide()
kicker(s, "Dürüst tablo")
title(s, "Bugün hazır — sırada ne var")
rect(s, Inches(0.9), Inches(2.0), Inches(5.6), Inches(4.7), fill=CARD, line=LINE)
rect(s, Inches(6.8), Inches(2.0), Inches(5.6), Inches(4.7), fill=CARD_RED, line=RED_STR)
tf = box(s, Inches(1.15), Inches(2.25), Inches(5.1), Inches(4.3))
para(tf, "BUGÜN HAZIR — ÇEKİRDEK", size=14, color=GREEN, bold=True, font=HEAD, after=10, first=True)
for m in ["Rezervasyon · oda planı · müsaitlik", "Check-in/out · folyo · ödeme",
          "Kat hizmetleri", "Restoran POS · oda servisi", "Kanal yönetimi (Channex)",
          "Ön muhasebe · satın alma", "AI concierge · onay · aktör paneli", "Raporlar · forecast · bütçe"]:
    para(tf, [("✓  ", {"color": GREEN, "bold": True, "size": 13.5}), (m, {"color": WHITE, "size": 13.5})], after=7)
tf = box(s, Inches(7.05), Inches(2.25), Inches(5.1), Inches(4.3))
para(tf, "SIRADA — ALTYAPI HAZIR", size=14, color=RED, bold=True, font=HEAD, after=10, first=True)
for m in ["Fatura & e-Fatura / e-Arşiv", "Gece denetimi / kasa kapama", "Dinamik fiyat (yield)",
          "Stok çıkış · fire · sayım", "KBS bildirimi · kimlik OCR", "CRM & sadakat genişletme",
          "Personel & İK · bordro", "Kapı kilidi / santral entegrasyonu"]:
    para(tf, [("›  ", {"color": RED, "bold": True, "size": 13.5}), (m, {"color": GRAY, "size": 13.5})], after=7)
footer(s)
note(s, """(1.5 dk) KRİTİK DÜRÜSTLÜK SLAYTI. Asla 'her şey bitti' deme. "Sol taraf bugün canlıda çalışıyor.
Sağ taraf sırada — ve mimarimiz öyle kurulu ki bunları eklemek yeni bir şey icat etmek değil, hazır iskelete iş mantığı yazmak.
Modül modül, her biri canlıya çıkınca kullanmaya başlarsınız." Patron 'fatura var mı' diye sorarsa: 'Folyo kapanışı hazır,
fatura ekranı sıradaki teslimde.' """)

# 29 — Nasıl çalışırız + ekip
s = slide()
kicker(s, "Nasıl çalışırız")
title(s, "Dört adım — her adımda elinizde somut bir şey")
steps(s, [
    (1, "Akışı çıkarırız", "Sizi ve sahadaki ekibi dinleriz; işin haritasını çıkarırız (yazılım değil, önce harita)."),
    (2, "Kapsamı yazılı hale getiririz", "Ne yapılacağı, nasıl davranacağı, “bitti” kriteri yazılır. Sonradan sürpriz yok."),
    (3, "Modül modül teslim ederiz", "Büyük tek teslimat değil; çalışan parçalar. İlk modülü hemen kullanmaya başlarsınız."),
    (4, "Kurup bırakmayız", "Sunucu, yedek, güncelleme, sorun çözümü bizde. Kurduğumuzu biz işletiriz."),
], top=2.05, gap=1.0)
tf = box(s, Inches(0.9), Inches(6.35), Inches(11.6), Inches(0.5))
para(tf, [("Ekip:  ", {"color": RED, "bold": True, "size": 13, "font": HEAD}),
          ("Ahmet Yusuf Demir  ·  Ali Kemal Cimşit  —  iki kurucu ortak. Projeyi anlattığınız kişi, kodu yazan kişidir.",
           {"color": GRAY, "size": 13})], after=0, first=True)
footer(s)
note(s, """(1.5 dk) Satın alma güvenini kur. "Aylarca analiz raporu yazıp kaybolmuyoruz; dört adım, her adımın sonunda
somut bir şey. En önemlisi: kurduğumuzu biz işletiriz — teslim edip gitmiyoruz." İki kişilik ekibi güç olarak sun.""")

# 30 — Özet
s = slide()
kicker(s, "Özet")
title(s, "Neden FlexHotel?")
cards(s, [
    ("Tek sistem", "Rezervasyondan muhasebeye tek doğruluk kaynağı."),
    ("Yapısal güven", "Çifte satış ve para hatası mimariyle engellenir."),
    ("Otonom ama kontrollü", "Dijital çalışanlar işi yapar; kararı siz verirsiniz."),
    ("7/24 güvenli AI", "WhatsApp’tan rezervasyon — yalnız açık onayda."),
    ("Canlıda, gerçek entegrasyonlu", "Üretimde çalışıyor; Channex + OpenAI gerçek."),
    ("Kurup işleten ekip", "İki kurucu, tam sorumluluk, veriniz özgür."),
], top=2.1, cols=2, ch=1.42)
footer(s)
note(s, """(1 dk) Altı mesajı hızlı özetle, sonra kapanışa geç. Bu slayt 'aklında kalsın' slaytı.""")

# 31 — Kapanış
s = slide()
rect(s, 0, 0, Inches(0.22), Inches(7.5), fill=RED_STR, line=None, rounded=False)
tf = box(s, Inches(0.95), Inches(2.35), Inches(11.4), Inches(1.4))
para(tf, "Projenizi konuşalım", size=48, color=WHITE, bold=True, font=HEAD, after=0, first=True)
tf = box(s, Inches(0.98), Inches(3.6), Inches(11.4), Inches(1.6))
para(tf, "Otelinizde en çok zaman yiyen süreci birkaç cümleyle anlatın;", size=19, color=GRAY, after=4, first=True)
para(tf, [("yapay zekânın gerçekten fark yaratacağı yeri birlikte bulalım. ", {"color": GRAY, "size": 19}),
          ("Satmak için evet demiyoruz.", {"color": RED, "size": 19, "bold": True})])
tf = box(s, Inches(0.98), Inches(6.5), Inches(11.4), Inches(0.7))
para(tf, [("flexai.tr", {"color": WHITE, "bold": True, "font": HEAD, "size": 15}),
          ("    ·    hotel.flexai.tr    ·    iletisim@flexai.tr", {"color": GRAY, "size": 15})],
     after=0, first=True)
note(s, """(30 sn) Kapanış ve çağrı. "Pilot otelle bugün başlayabiliriz: çekirdek modüller hazır, eksikleri yol haritasında
birlikte ekleriz. Son sözümüz: satmak için evet demiyoruz — fark yaratmayacaksa onu da açıkça söyleriz."
Dürüst, güven veren bir kapanış. İletişim bilgisiyle bitir.""")

out = "/Users/alikemal/Documents/GitHub/flex-hotel/docs/sunum/FlexHotel-Sunum.pptx"
prs.save(out)
print("OK ->", out, "| slayt:", len(prs.slides._sldIdLst))

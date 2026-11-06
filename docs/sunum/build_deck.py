#!/usr/bin/env python3
"""FlexHotel sunumu — yüksek çözünürlüklü PDF (Keynote/Preview'da kesin açılır).
Marka fontları + gerçek canlı ekran görüntüleri gömülü. İş değeri odaklı, otelciye."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Users/alikemal/Documents/GitHub/flex-hotel"
FDIR = f"{ROOT}/docs/katalog/fontlar"
IMG  = f"{ROOT}/docs/sunum/img"
OUT_PDF = f"{ROOT}/docs/sunum/FlexHotel-Sunum.pdf"

W, H = 2560, 1440
M = 190  # kenar boşluğu

# Renkler
INK=(14,14,14); CARD=(27,27,27); CARD_RED=(36,19,19)
RED=(239,68,68); RED_STR=(220,38,38)
WHITE=(246,246,246); GRAY=(176,176,176); DGRAY=(130,130,130)
LINE=(48,48,48); GREEN=(58,214,158); GOLD=(232,180,74)

_FC = {}
def font(kind, size):
    key=(kind,size)
    if key in _FC: return _FC[key]
    files={"hb":"SpaceGrotesk-Bold.ttf","hm":"SpaceGrotesk-Medium.ttf",
           "b":"PlusJakartaSans-Bold.ttf","sb":"PlusJakartaSans-SemiBold.ttf",
           "m":"PlusJakartaSans-Medium.ttf","r":"PlusJakartaSans-Regular.ttf"}
    f=ImageFont.truetype(f"{FDIR}/{files[kind]}", size)
    _FC[key]=f; return f

SLIDES=[]
def newslide(bg=INK):
    im=Image.new("RGB",(W,H),bg); return im, ImageDraw.Draw(im)
def push(im): SLIDES.append(im)

def tw(d,s,f): return d.textlength(s,font=f)
def text(d,xy,s,f,fill,anchor="la"): d.text(xy,s,font=f,fill=fill,anchor=anchor)

def wrap(d,s,f,maxw):
    words=s.split(); lines=[]; cur=""
    for w in words:
        t=(cur+" "+w).strip()
        if tw(d,t,f)<=maxw: cur=t
        else:
            if cur: lines.append(cur)
            cur=w
    if cur: lines.append(cur)
    return lines

def para(d,x,y,s,f,fill,maxw,leading=1.18):
    lh=int(f.size*leading)
    for ln in wrap(d,s,f,maxw):
        text(d,(x,y),ln,f,fill); y+=lh
    return y

def rrect(d,box,r,fill=None,outline=None,width=2):
    d.rounded_rectangle(box,radius=r,fill=fill,outline=outline,width=width)

def dash(d,x,y,color=RED,w=38,h=7):
    d.rounded_rectangle([x,y,x+w,y+h],radius=3,fill=color)

def check(d,x,y,s=30,color=GREEN):
    d.line([(x,y+s*0.55),(x+s*0.38,y+s*0.9)],fill=color,width=7)
    d.line([(x+s*0.38,y+s*0.9),(x+s*1.0,y+s*0.15)],fill=color,width=7)

def chevron(d,cx,cy,s=34,color=RED):
    d.line([(cx-s*0.3,cy-s*0.5),(cx+s*0.3,cy),(cx-s*0.3,cy+s*0.5)],fill=color,width=9,joint="curve")

def dot(d,x,y,r=9,color=GREEN):
    d.ellipse([x-r,y-r,x+r,y+r],fill=color)

# ---- ortak parçalar
def kicker(d,s):
    d.rounded_rectangle([M,96,M+40,108],radius=3,fill=RED_STR)
    text(d,(M+60,82),s.upper(),font("hb",27),RED)

def title(d,s,size=68,y=150,maxw=W-2*M):
    lines=wrap(d,s,font("hb",size),maxw); lh=int(size*1.08)
    for ln in lines: text(d,(M,y),ln,font("hb",size),WHITE); y+=lh
    return y

def footer(d,n):
    text(d,(M,H-70),"FlexHotel",font("hb",21),RED)
    text(d,(M+tw(d,"FlexHotel",font("hb",21))+16,H-70),"·  FlexAI  ·  hotel.flexai.tr",font("m",21),DGRAY)
    text(d,(W-M,H-70),str(n),font("m",21),DGRAY,anchor="ra")

def accent_bar(d):
    d.rectangle([0,0,14,H],fill=RED_STR)

def bullets(d,items,y0=360,gap=184,size=38,maxw=W-2*M-70):
    y=y0
    for it in items:
        dash(d,M,y+size*0.5)
        if isinstance(it,tuple):
            head,rest=it
            text(d,(M+70,y),head,font("hb",size),WHITE)
            yy=y+int(size*1.25)
            if rest: yy=para(d,M+70,yy,rest,font("r",size-6),GRAY,maxw,1.16)
        else:
            para(d,M+70,y,it,font("sb",size),WHITE,maxw,1.12)
        y+=gap

def cards(d,items,y0=340,cols=2,ch=300,gap=40,hs=36,bs=28):
    cw=(W-2*M-gap*(cols-1))//cols
    for i,(head,body) in enumerate(items):
        r,c=divmod(i,cols)
        x=M+c*(cw+gap); y=y0+r*(ch+gap)
        rrect(d,[x,y,x+cw,y+ch],24,fill=CARD,outline=LINE,width=2)
        pad=38; ty=y+pad
        for ln in wrap(d,head,font("hb",hs),cw-2*pad):
            text(d,(x+pad,ty),ln,font("hb",hs),WHITE); ty+=int(hs*1.12)
        ty+=10
        para(d,x+pad,ty,body,font("r",bs),GRAY,cw-2*pad,1.22)

def checklist(d,items,y0=360,col_w=None,gap=22,size=37):
    if col_w is None: col_w=(W-2*M-120)//2
    half=(len(items)+1)//2
    for ci in range(2):
        cx=M+ci*(col_w+120); y=y0
        for it in items[ci*half:(ci+1)*half]:
            check(d,cx,y+6,30,GREEN)
            text(d,(cx+56,y),it,font("sb",size),WHITE)
            y+=int(size*1.1)+gap

def steps(d,items,y0=330,gap=230):
    y=y0
    for num,head,body in items:
        rrect(d,[M,y,M+96,y+96],20,fill=CARD_RED,outline=RED_STR,width=3)
        text(d,(M+48,y+48),str(num),font("hb",48),RED,anchor="mm")
        text(d,(M+140,y+4),head,font("hb",40),WHITE)
        para(d,M+140,y+62,body,font("r",31),GRAY,W-M-(M+140),1.2)
        y+=gap

def fit_box(im_w,im_h,bw,bh):
    s=min(bw/im_w,bh/im_h); return int(im_w*s),int(im_h*s)

def shot(base,d,path,box,radius=18,border=LINE):
    x0,y0,x1,y1=box
    try:
        pic=Image.open(path).convert("RGB")
    except Exception:
        rrect(d,box,radius,fill=CARD,outline=border);
        text(d,((x0+x1)//2,(y0+y1)//2),"(görsel yok)",font("m",30),DGRAY,anchor="mm"); return
    nw,nh=fit_box(pic.width,pic.height,x1-x0,y1-y0)
    pic=pic.resize((nw,nh))
    px=x0+((x1-x0)-nw)//2; py=y0+((y1-y0)-nh)//2
    # yuvarlak köşe maskesi
    mask=Image.new("L",(nw,nh),0); md=ImageDraw.Draw(mask)
    md.rounded_rectangle([0,0,nw,nh],radius=radius,fill=255)
    base.paste(pic,(px,py),mask)
    d.rounded_rectangle([px,py,px+nw,py+nh],radius=radius,outline=border,width=3)

def shot_slide(kickers,titles,path,callouts,caption=None,n=0):
    im,d=newslide(); kicker(d,kickers); ty=title(d,titles,size=56,y=150)
    img_box=(M,300,M+1430,300+840)
    shot(im,d,path,img_box)
    cx=M+1500; cy=340
    for head in callouts:
        dash(d,cx,cy+18);
        yy=para(d,cx+56,cy,head,font("sb",33),WHITE,W-M-(cx+56),1.18)
        cy=yy+40
    if caption:
        para(d,M,1170,caption,font("m",27),DGRAY,1430,1.2)
    footer(d,n); push(im)

def flow(d,items,y0=320,bh=240):
    n=len(items); arrow=78
    bw=(W-2*M-arrow*(n-1))//n; x=M
    for i,(head,sub) in enumerate(items):
        fill=CARD_RED if i==n-1 else CARD; outline=RED_STR if i==n-1 else LINE
        rrect(d,[x,y0,x+bw,y0+bh],20,fill=fill,outline=outline,width=2)
        cx=x+bw//2; hy=y0+66
        for ln in wrap(d,head,font("hb",32),bw-50):
            text(d,(cx,hy),ln,font("hb",32),WHITE,anchor="ma"); hy+=40
        hy+=10
        for ln in wrap(d,sub,font("r",25),bw-50):
            text(d,(cx,hy),ln,font("r",25),GRAY,anchor="ma"); hy+=32
        if i<n-1: chevron(d,x+bw+arrow//2,y0+bh//2,40,RED)
        x+=bw+arrow

def section(d_im,num,titletext,sub=None):
    im,d=d_im; accent_bar(d)
    text(d,(M-10,470),f"{num:02d}",font("hb",200),CARD)
    text(d,(M,455),f"BÖLÜM {num:02d}",font("hb",28),RED)
    y=para(d,M,740,titletext,font("hb",80),WHITE,W-2*M-60,1.04)
    if sub: para(d,M,y+28,sub,font("m",34),GRAY,W-2*M-60,1.2)
    push(im)

# ================================================================= SLAYTLAR
N=[0]
def pg(): N[0]+=1; return N[0]

# 1 KAPAK
im,d=newslide(); accent_bar(d)
rrect(d,[M,300,M+470,380],18,fill=CARD_RED,outline=RED_STR,width=3)
dot(d,M+42,340,12,GREEN); text(d,(M+72,340),"CANLIDA — ÜRETİMDE",font("hb",26),WHITE,anchor="lm")
text(d,(M,470),"Flex",font("hb",150),RED); text(d,(M+tw(d,"Flex",font("hb",150)),470),"Hotel",font("hb",150),WHITE)
text(d,(M,690),"Yapay zekâ ile çalışan otel yönetim sistemi",font("hm",50),WHITE)
text(d,(M,770),"İşin tekrarı yazılıma, ",font("m",38),GRAY)
text(d,(M+tw(d,"İşin tekrarı yazılıma, ",font("m",38)),770),"kararlar size.",font("b",38),RED)
text(d,(M,H-120),"FlexAI",font("hb",26),RED)
text(d,(M+tw(d,"FlexAI",font("hb",26))+20,H-120),"·  hotel.flexai.tr  ·  Ürün tanıtımı · Kasım 2026",font("m",26),DGRAY)
push(im); pg()

# 2 BÖLÜM 1
section(newslide(),1,"Otelcinin derdi","Oteli yöneten değil, yazılımla boğuşan bir gün")
pg()

# 3 Dertler
im,d=newslide(); kicker(d,"Tanıdık geliyor mu?"); title(d,"Her otel aynı sorunlarla boğuşuyor",y=150)
cards(d,[
 ("Dağınık sistemler","PMS ayrı, kanal yöneticisi ayrı, muhasebe ayrı, restoran ayrı. Aynı veri üç kez giriliyor."),
 ("Kaçan gelir","Minibar, geç çıkış, oda servisi folyoya düşmüyor; tahsilat muhasebeye geçmiyor."),
 ("Çifte satış","İki resepsiyonist aynı odayı aynı anda satıyor; kanaldan gelen rezervasyon elde yok."),
 ("7/24 cevap yok","Gece gelen WhatsApp mesajı sabaha kadar cevapsız; rezervasyon rakibe gidiyor."),
 ("Personele bağımlılık","“O arkadaş işi biliyordu, ayrıldı.” Süreç kafalarda, sistemde değil."),
 ("Görünürlük yok","“Bu neden böyle oldu?” sorusunun izlenebilir bir cevabı yok."),
],y0=330,cols=3,ch=360,gap=36,hs=33,bs=26); footer(d,pg()); push(im)

# 4 Yaklaşım (ifade)
im,d=newslide(); accent_bar(d); kicker(d,"Yaklaşımımız")
text(d,(M,330),"İşin tekrarı ",font("hb",96),WHITE); text(d,(M+tw(d,"İşin tekrarı ",font("hb",96)),330),"yazılıma,",font("hb",96),RED)
text(d,(M,460),"kararlar ",font("hb",96),WHITE); text(d,(M+tw(d,"kararlar ",font("hb",96)),460),"size.",font("hb",96),RED)
para(d,M,700,"Tek bir dev yapay zekâ değil; her biri tek işten sorumlu “dijital çalışanlar” kuruyoruz.",font("m",40),GRAY,W-2*M,1.25)
para(d,M,820,"Sınırını aştığında işi size devreder ve neden devrettiğini yazar. Sessizce yanlış karar veren sistem, hiç karar vermeyenden kötüdür.",font("m",40),GRAY,W-2*M,1.25)
footer(d,pg()); push(im)

# 5 FlexHotel nedir
im,d=newslide(); kicker(d,"Peki FlexHotel ne?"); title(d,"Otelin tüm işi tek sistemde — canlı ve çalışır",y=150)
bullets(d,[
 ("Uçtan uca","Rezervasyon, ön büro, kat hizmetleri, folyo/ödeme, restoran/POS, satın alma, ön muhasebe — tek sistem."),
 ("Otonom","Rutin işi dijital çalışanlar yapar; resepsiyon işi sisteme bırakıp misafire bakar."),
 ("Kontrollü","Para ve risk içeren her kararda sistem durup size onay sorar."),
 ("Güvenli","Çifte satış ve para hatası yazılımla değil, veritabanı seviyesinde engellenir."),
 ("Üretimde","Bugün hotel.flexai.tr üzerinde canlı çalışıyor — maket değil."),
],y0=360,gap=170); footer(d,pg()); push(im)

# 6 EKRAN: Dashboard
shot_slide("Canlı ekran — sabah","Müdürün sabah ekranı",f"{IMG}/01-dashboard.png",
 ["Doluluk (dünle kıyaslı), gelen/giden","Oda geliri · ADR · RevPAR tek bakışta","Bekleyen işler ve sistem durumu canlı"],
 "Gerçek, canlı sistemden — ekran görüntüsü değil, bugünkü hotel.flexai.tr paneli.",pg())

# 7 BÖLÜM 2
section(newslide(),2,"Sistemin içinde dijital çalışanlar var","Otonom aktör ağı — ama kontrol sizde"); pg()

# 8 Dijital çalışanlar — ne yapar + nasıl
im,d=newslide(); kicker(d,"Dijital çalışanlar"); title(d,"Resepsiyon uyur, sisteminiz uyumaz",y=150)
cards(d,[
 ("Oda aktörü","“Rezervasyon oluştu” olayını duyar; o gecelerde boş odaları hesaplar, en uygununu (bugün gelen için önce temiz+boş) seçip atar."),
 ("Folyo aktörü","Giriş/çıkış ve her harcama olayını duyar; hesabı açar, gece ücretini ve kalemleri işler, bakiyesi sıfır folyoyu kapatır."),
 ("Kanal aktörü","Müsaitlik/fiyat değişince etkilenen günleri işaretler; yalnız değişen günleri Channex.io’ya gönderir, o da OTA’lara yazar."),
 ("Muhasebe aktörü","Mal kabul/tahsilat olayını duyar; ilgili cari ya da kasayı bulup borç/giriş kaydını yazar. Aynı belge iki kez işlenmez."),
 ("Concierge (AI)","Misafirin niyetini duyar; gerçek müsaitlik/fiyatı sorgular, teklif sunar, yalnız açık onayda rezervasyon ister."),
 ("Bildirim aktörü","Onay/hoş geldiniz gibi olayları duyar; mesajı misafirin dilinde hazırlayıp gönderim kuyruğuna yazar."),
],y0=330,cols=3,ch=370,gap=36,hs=32,bs=25); footer(d,pg()); push(im)

# 9 Mekanizma — "nasıl otomatik?"
im,d=newslide(); kicker(d,"Mekanizma"); title(d,"Peki nasıl “otomatik”? — perde arkası",y=150)
flow(d,[
 ("Mal kabul","irsaliye girilir"),
 ("Olay üretilir","tedarikçi · tutar · vade"),
 ("Muhasebe aktörü","olayı dinler"),
 ("Cariye yazılır","borç + vade"),
],y0=300,bh=235)
bullets(d,[
 ("Her işlem bir olay üretir","— ne olduğu, tutarı ve vadesi içinde. Mal kabulde: tedarikçi, KDV-dahil tutar, vade tarihi."),
 ("Sorumlu aktör olayı dinler ve kaydı yazar","— tedarikçinin cari hesabını bulur, yoksa açar, borcu vadesiyle işler."),
 ("Her kayıt yalnız bir kez işlenir","— aynı irsaliye iki kez borç yazmaz (tekil anahtar). Sihir değil: olay + sorumlu aktör + değişmez kayıt."),
],y0=650,gap=172,size=34); footer(d,pg()); push(im)

# 9 EKRAN: Aktör paneli
shot_slide("Canlı ekran — kumanda","Dijital ekibinizi tek ekrandan yönetin",f"{IMG}/03-aktorler.png",
 ["Her aktörü tek tıkla aç/kapat","“Kapatırsam ne durur” + son 24s iş/hata","AI günlük maliyeti bütçeye karşı"],
 "Kapatılan aktörün işi kaybolmaz — personelin görev listesine düşer.",pg())

# 10 Güvenli otomasyon
im,d=newslide(); kicker(d,"Kontrol sizde"); title(d,"Parada kararı insan verir",y=150)
bullets(d,[
 ("Otomatik onay kuyruğu","Büyük ödeme, iade, overbooking, folyo iptali, eşik üstü satın alma → yetkiliye düşer."),
 ("Kaldığı yerden","Onayladığınız an iş, çift işleme olmadan tam kaldığı yerden tamamlanır."),
 ("Dört göz kuralı","İsteyen kendi isteğini onaylayamaz; iki yönetici aynı işi çakıştıramaz."),
 ("Net sınır","Yapay zekâ oteli işletir; kasaya, iadeye, büyük tutara insan karar verir."),
],y0=360,gap=180); footer(d,pg()); push(im)

# 11 BÖLÜM 3
section(newslide(),3,"Ne kazandırır?","Gelir ↑  ·  kaçak ↓  ·  iş gücü ↓  ·  kontrol ↑"); pg()

# 12 Daha çok gelir
im,d=newslide(); kicker(d,"Kazanç — 1"); title(d,"Daha çok gelir, daha az boş oda",y=150)
bullets(d,[
 ("Kanallar hep güncel","Booking, Expedia, Airbnb fiyat ve müsaitliği saniyeler içinde eşitlenir — boş oda kanalda kapalı kalmaz."),
 ("Boş geceyi önceden gör","30 günlük tahmin, zayıf günleri haftalar önce gösterir — kampanyayı zamanında kur."),
 ("ADR / RevPAR canlı","Doluluk, ortalama fiyat ve oda başı gelir her an gözünüzün önünde."),
 ("7/24 satış","Gece gelen misafiri AI concierge karşılar — rezervasyon rakibe gitmez."),
],y0=360,gap=180); footer(d,pg()); push(im)

# 13 EKRAN: Gelir raporu
shot_slide("Canlı ekran — gelir","Sektör metrikleri, canlı",f"{IMG}/05-gelir-raporu.png",
 ["Doluluk · ADR · RevPAR · oda geliri","Dönem, oda tipi ve kaynak kırılımı","Geçen yılla otomatik kıyas"],
 "Oranlar dönem toplamından hesaplanır; “rapor ne diyor, kasa ne diyor” ayrışması biter.",pg())

# 14 Kaçan gelir sıfır
im,d=newslide(); kicker(d,"Kazanç — 2"); title(d,"Kaçan gelir sıfır, mizan kuruşu kuruşuna",y=150)
bullets(d,[
 ("Her harcama folyoya","Minibar, çamaşır, oda servisi, geç çıkış — kat görevlisinin telefonundan bile folyoya düşer."),
 ("Otomatik muhasebe","Her tahsilat, mal kabulü kendiliğinden cariye/kasaya işlenir; aynı para iki kez sayılmaz."),
 ("Kuruş garantisi","Restoran hesabı folyoya kuruşu kuruşuna aynı yansır; yuvarlama hatası yok."),
 ("Çek/senet takibi","Karşılıksız çıkarsa cari otomatik yeniden borçlanır — hiçbir kâğıt kaybolmaz."),
],y0=360,gap=180); footer(d,pg()); push(im)

# 15 Daha az iş gücü + hata
im,d=newslide(); kicker(d,"Kazanç — 3"); title(d,"Daha az iş gücü, neredeyse sıfır hata",y=150)
bullets(d,[
 ("Rutin kendiliğinden","Oda atama, folyo, bildirim, kanal güncelleme — personel bunlarla uğraşmaz, misafire bakar."),
 ("Overbooking imkânsız","Aynı oda iki misafire satılamaz — uygulama + veritabanı, iki kat garanti."),
 ("Yanlış fiyat durur","Ekrandaki ücretle sistemin hesabı tutmazsa işlem durur; sessiz yanlış tahsilat olmaz."),
 ("Bilgi sistemde","Süreç kafalarda değil sistemde; personel ayrılsa da otel aksamaz."),
],y0=360,gap=180); footer(d,pg()); push(im)

# 16 BÖLÜM 4
section(newslide(),4,"Otelin bir günü FlexHotel ile","Modüller, işin kendi akışıyla"); pg()

# 17 Senaryo 1
im,d=newslide(); kicker(d,"Senaryo — gece"); title(d,"Gece 02:00 · WhatsApp’tan rezervasyon",y=150)
steps(d,[
 (1,"Misafir yazar","“15–18 Ekim 2 kişilik odanız var mı?” — WhatsApp’tan, gece yarısı."),
 (2,"Concierge cevaplar","Müsaitliği ve gece gece fiyatı gerçek veriden çeker, net bir teklif sunar."),
 (3,"Misafir onaylar","“Evet” der. Sistem fiyatı ve müsaitliği son kez doğrular."),
 (4,"Zincir çalışır","Rezervasyon açılır, oda atanır, onay kodu yazılır, karşılama mesajı gider — insan dokunmadan."),
],y0=330,gap=228); footer(d,pg()); push(im)

# 18 EKRAN: Oda planı
shot_slide("Canlı ekran — oda planı","Tüm odalar, tüm geceler tek takvimde",f"{IMG}/02-oda-plani.png",
 ["Satır oda, sütun gece","Sürükle-bırakla oda değişimi","Boş hücreden tek tıkla rezervasyon"],
 "Oda bekleyenler şeridinden odaya sürükleyin; geçmiş yeniden yazılmaz, iz kalır.",pg())

# 19 Senaryo 2
im,d=newslide(); kicker(d,"Senaryo — gündüz"); title(d,"Giriş → konaklama → çıkış → yeniden satış",y=150)
steps(d,[
 (1,"Check-in","Tek tıkla giriş: oda “dolu” olur, folyo açılır, teminat işlenir, kanallar güncellenir."),
 (2,"Konaklama","Minibar, oda servisi, çamaşır otomatik folyoya düşer; hiçbir gelir kaçmaz."),
 (3,"Check-out","Kalan geceler + geç çıkış ücreti işlenir; bakiye sıfırsa folyo kapanır."),
 (4,"Temizlik & yeniden satış","Oda otomatik temizlik listesine düşer; şef onaylayınca kanallara geri açılır."),
],y0=330,gap=228); footer(d,pg()); push(im)

# 20 EKRAN: Oda servisi KDS
shot_slide("Canlı ekran — restoran","Oda servisi / mutfak panosu",f"{IMG}/06-oda-servisi.png",
 ["Onay → Mutfakta → Hazır → Yolda","QR’dan gelen sipariş anında panoda","“Odaya yaz” folyoya kuruşu kuruşuna"],
 "Restoran ve oda servisi hesabı folyoya birebir yansır; yuvarlanamayan tutar reddedilir.",pg())

# 21 Ön büro modülleri
im,d=newslide(); kicker(d,"Kapsam — Ön büro & operasyon (hazır)"); title(d,"Resepsiyonun ihtiyacı olan her şey",y=150)
checklist(d,[
 "Rezervasyon (tek · grup · bekleme)","Oda planı / takvim (sürükle-bırak)",
 "Müsaitlik & otomatik oda atama","Check-in / Check-out",
 "Folyo (böl · birleştir · iptal)","Ödeme (nakit · kart · döviz)",
 "Kat hizmetleri (housekeeping)","Misafir mesaj & istek takibi",
 "WhatsApp / web chat ile AI rezervasyon","Bildirim merkezi (SMS · e-posta)",
 "Minibar & çamaşır","Kayıp eşya",
 "Günlük durum (ADR · RevPAR)","Onay kuyruğu + aktör paneli",
],y0=330); footer(d,pg()); push(im)

# 22 Gelir & satış + Restoran + Arka ofis (üç küçük kolon)
im,d=newslide(); kicker(d,"Kapsam — gelir · restoran · arka ofis (hazır)"); title(d,"Satıştan muhasebeye, uçtan uca",y=150)
colw=(W-2*M-2*60)//3; groups=[
 ("Gelir & satış",["Gelir raporları (ADR/RevPAR)","30 günlük forecast","Bütçe + sapma + AI yorum","Kontrat & acente","Promosyon & kupon","Acente prim / sadakat","Kanal yönetimi (Channex)"]),
 ("Restoran & oda servisi",["Restoran POS (adisyon)","“Odaya yaz” folyoya","Oda servisi (QR)","Oda servisi panosu","Menü & reçete (maliyet)","Banket & etkinlik","Banket F&B"]),
 ("Satın alma & muhasebe",["Satın alma (talep→sipariş)","Tedarikçi borcu otomatik","Cari + FIFO yaşlandırma","Kasa / banka","Çek / senet","Fişler + dört göz","Otomatik muhasebe kaydı"]),
]
for gi,(gt,items) in enumerate(groups):
    gx=M+gi*(colw+60);
    text(d,(gx,330),gt,font("hb",34),RED); y=400
    for it in items:
        check(d,gx,y+4,26,GREEN);
        for ln in wrap(d,it,font("m",28),colw-50):
            text(d,(gx+46,y),ln,font("m",28),WHITE); y+=34
        y+=24
footer(d,pg()); push(im)

# 23 BÖLÜM 5
section(newslide(),5,"Neden güvenebilirsiniz","Canlıda çalışıyor · veriniz güvende · gerçek entegrasyon"); pg()

# 24 Canlıda
im,d=newslide(); accent_bar(d); kicker(d,"Kanıt — 1"); title(d,"Maket değil — bugün üretimde çalışıyor",y=150)
rrect(d,[M,320,M+760,430],20,fill=CARD_RED,outline=RED_STR,width=3)
dot(d,M+55,375,13,GREEN); text(d,(M+90,375),"hotel.flexai.tr",font("hb",46),WHITE,anchor="lm")
bullets(d,[
 ("Gerçek ortamda, gerçek veriyle","Gösterdiğimiz her ekran canlı sistemden — ekran görüntüsü yeter demedik, kendiniz girin."),
 ("İki kişilik ekip, tam sorumluluk","Projeyi anlattığınız kişi, kodu yazan kişiyle aynı. Arada aktarım kaybı yok."),
 ("Kurduğumuzu biz işletiriz","Sunucu, yedek, güncelleme, gece yarısı çıkan sorun — hepsi bizde."),
],y0=500,gap=185); footer(d,pg()); push(im)

# 25 Veri bütünlüğü
im,d=newslide(); kicker(d,"Kanıt — 2"); title(d,"Veriniz ve paranız güvende",y=150)
cards(d,[
 ("Çifte satış imkânsız","Uygulama kilidi + veritabanı kuralı — iki kat. Son odayı iki kişi aynı anda satamaz."),
 ("Para kaybolmaz","Ondalık aritmetik, kuruş hatası yok. Silinen kayıt sessizce geri gelmez."),
 ("Değişmez iz","Her değişiklik silinmeyen denetim defterinde. Kim ne yaptı — kanıtıyla."),
 ("Kurumsal güvenlik","Rol bazlı yetki (sunucuda), şifreli sırlar, KVKK maskeleme, güvenli oturum."),
],y0=340,cols=2,ch=300); footer(d,pg()); push(im)

# 26 Entegrasyonlar
im,d=newslide(); kicker(d,"Kanıt — 3"); title(d,"Dışarıyla gerçekten konuşuyor",y=150)
cards(d,[
 ("Kanal yöneticisi","Channex.io ile Booking · Expedia · Airbnb · Agoda + iCal. Fark-bazlı canlı senkron."),
 ("Yapay zekâ","OpenAI — gerçek, bütçe kontrollü. Anahtar girilince concierge ve bütçe yorumu devreye girer."),
 ("WhatsApp & web chat","Meta resmî API + güvenli oturum. Çift gönderim engelli."),
 ("Açık API & dışa aktarım","Veriniz bizde hapis değil; ilk günden dışa aktarım ve webhook var."),
],y0=340,cols=2,ch=300); footer(d,pg()); push(im)

# 27 BÖLÜM 6
section(newslide(),6,"Yol haritası ve başlangıç","Bugün hazır, sırada olan ve nasıl başlayacağımız"); pg()

# 28 Yol haritası
im,d=newslide(); kicker(d,"Dürüst tablo"); title(d,"Bugün hazır — sırada ne var",y=150)
rrect(d,[M,320,M+1080,1260],24,fill=CARD,outline=LINE,width=2)
rrect(d,[M+1140,320,W-M,1260],24,fill=CARD_RED,outline=RED_STR,width=2)
text(d,(M+50,360),"BUGÜN HAZIR — ÇEKİRDEK",font("hb",30),GREEN); y=440
for m in ["Rezervasyon · oda planı · müsaitlik","Check-in/out · folyo · ödeme","Kat hizmetleri",
          "Restoran POS · oda servisi","Kanal yönetimi (Channex)","Ön muhasebe · satın alma",
          "AI concierge · onay · aktör paneli","Raporlar · forecast · bütçe"]:
    check(d,M+50,y+4,28,GREEN); text(d,(M+100,y),m,font("sb",31),WHITE); y+=88
text(d,(M+1190,360),"SIRADA — ALTYAPI HAZIR",font("hb",30),RED); y=440
for m in ["Fatura & e-Fatura / e-Arşiv","Gece denetimi / kasa kapama","Dinamik fiyat (yield)",
          "Stok çıkış · fire · sayım","KBS bildirimi · kimlik OCR","CRM & sadakat genişletme",
          "Personel & İK · bordro","Kapı kilidi / santral"]:
    chevron(d,M+1205,y+22,26,RED); text(d,(M+1245,y),m,font("m",31),GRAY); y+=88
footer(d,pg()); push(im)

# 29 Nasıl çalışırız
im,d=newslide(); kicker(d,"Nasıl çalışırız"); title(d,"Dört adım — her adımda elinizde somut bir şey",y=150)
steps(d,[
 (1,"Akışı çıkarırız","Sizi ve sahadaki ekibi dinleriz; işin haritasını çıkarırız (önce harita, sonra yazılım)."),
 (2,"Kapsamı yazılı hale getiririz","Ne yapılacağı, nasıl davranacağı, “bitti” kriteri yazılır. Sonradan sürpriz yok."),
 (3,"Modül modül teslim ederiz","Çalışan parçalar. İlk modülü hemen kullanmaya başlarsınız, geri bildirim erken gelir."),
 (4,"Kurup bırakmayız","Sunucu, yedek, güncelleme, sorun çözümü bizde. Kurduğumuzu biz işletiriz."),
],y0=320,gap=205)
text(d,(M,1250),"Ekip:  ",font("hb",28),RED)
text(d,(M+tw(d,"Ekip:  ",font("hb",28)),1250),"Ahmet Yusuf Demir  ·  Ali Kemal Cimşit  —  iki kurucu ortak.",font("m",28),GRAY)
footer(d,pg()); push(im)

# 30 Özet
im,d=newslide(); kicker(d,"Özet"); title(d,"Neden FlexHotel?",y=150)
cards(d,[
 ("Tek sistem","Rezervasyondan muhasebeye tek doğruluk kaynağı."),
 ("Yapısal güven","Çifte satış ve para hatası mimariyle engellenir."),
 ("Otonom ama kontrollü","Dijital çalışanlar işi yapar; kararı siz verirsiniz."),
 ("7/24 güvenli AI","WhatsApp’tan rezervasyon — yalnız açık onayda."),
 ("Canlıda, gerçek entegrasyonlu","Üretimde çalışıyor; Channex + OpenAI gerçek."),
 ("Kurup işleten ekip","İki kurucu, tam sorumluluk, veriniz özgür."),
],y0=340,cols=2,ch=290); footer(d,pg()); push(im)

# 31 Kapanış
im,d=newslide(); accent_bar(d)
text(d,(M,360),"Projenizi konuşalım",font("hb",100),WHITE)
para(d,M,560,"Otelinizde en çok zaman yiyen süreci birkaç cümleyle anlatın;",font("m",40),GRAY,W-2*M,1.25)
text(d,(M,640),"yapay zekânın fark yaratacağı yeri birlikte bulalım. ",font("m",40),GRAY)
text(d,(M+tw(d,"yapay zekânın fark yaratacağı yeri birlikte bulalım. ",font("m",40)),640),"Satmak için evet demiyoruz.",font("b",40),RED)
text(d,(M,H-180),"flexai.tr",font("hb",32),WHITE)
text(d,(M+tw(d,"flexai.tr",font("hb",32))+24,H-180),"·  hotel.flexai.tr  ·  iletisim@flexai.tr",font("m",32),GRAY)
push(im); pg()

# ---- PDF kaydet
SLIDES[0].save(OUT_PDF,"PDF",save_all=True,append_images=SLIDES[1:],resolution=96.0)
print("OK ->",OUT_PDF,"| slayt:",len(SLIDES))

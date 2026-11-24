# report-agent

Doğal dil raporlama ajanı (modül 24, LangGraph). Yöneticinin sorusunu ("geçen ayın haftalık doluluğu") bir **rapor
tanımına** çevirir: hangi rapor, hangi dönem (tercihen göreli: "geçen ay"), hangi gruplama; raporu veri aracıyla görür,
sonra cevabı sunar (tanım + grafik + kısa yorum).

- Paket ürün bilmez: talimat, araç şemaları, veri aracı ve cevabın kabulü servisten gelir (otel tarafı:
  `hotel/backend/src/modules/report-chat/`). Rakamları ajan değil sistem üretir — cevaptaki tablo, servisin
  MCP rapor araçlarıyla çalıştırdığı rapordur.
- Servis cevabı reddederse (geçersiz tanım / seri) hata modele araç mesajı olarak döner; model düzeltir.
- Soru başına en fazla `MAX_MODEL_CALLS` model çağrısı; aşılırsa soru "cevaplanamadı" olur.
- AI kullanılamıyorsa (bütçe, anahtar, sağlayıcı) ya da ajan kapalıysa soru **rapor talebi** manuel görevi olarak
  personele düşer.

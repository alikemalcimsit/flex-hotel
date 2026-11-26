/** Faturalar (şimdilik döviz karşılığı — modül 60; ekranın geri kalanı kademeli taşınır). Anahtarlar `invoices.` ile başlar. */
export default Object.freeze({
  'invoices.foreign.label': 'Döviz karşılığı',
  'invoices.foreign.none': 'Yok (yalnız otelin para birimi)',
  'invoices.foreign.hint': 'Fatura otelin para biriminde kesilir; seçilen dövizde toplamın karşılığı kesim günündeki kurla faturaya not olarak yazılır.',
  'invoices.foreign.pending': '{currency} karşılığı kesimde güncel kurdan hesaplanır.',
  'invoices.foreign.equivalent': 'Döviz karşılığı:',
  'invoices.foreign.rateLine': '1 {currency} = {rate} {hotelCurrency} · {date}',
  'invoices.foreign.rateMissing': '{currency} için kesim gününün kuru yok. Kasa › Döviz kurları ekranından kuru girin (ya da TCMB\'den çekin) veya döviz karşılığını kaldırın.',
});

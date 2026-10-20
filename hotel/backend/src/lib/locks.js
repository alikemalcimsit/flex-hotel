/**
 * Satır kilitleri (`SELECT ... FOR UPDATE`).
 *
 * Neden gerekli: "önce oku, sonra yaz" kontrolü READ COMMITTED'da yarışa
 * açıktır. İki personel aynı anda 101'e misafir atayıp 101'i arızaya alırsa
 * ikisi de "çakışma yok" okur ve ikisi de yazar. Aynı satırı kilitleyen
 * işlemler sıraya girer; ikinci işlem, birincinin commit ettiği veriyi görerek
 * karar verir.
 *
 * **Kilit sırası kuralı (deadlock önlemi):** rezervasyon → oda tipi → oda →
 * konuşma → mesaj → istek → folyo; her grup kendi içinde id sırasıyla. Bu dosyadaki
 * fonksiyonlar id'leri sıralayıp tek sorguda kilitler — çağıranlar yalnızca
 * gruplar arası sıraya uymalı (oda kilidini aldıktan sonra rezervasyon
 * kilitlenmez). Modül 4 rezervasyon oluştururken `lockRoomTypes` çağırmalı;
 * aksi hâlde aynı anda açılan son iki rezervasyon envanteri aşabilir. Modül 6
 * giriş/çıkışta önce rezervasyonu, sonra odayı kilitlemeli. Modül 29: acente
 * oda tipinden **sonra** kilitlenir (rezervasyon → oda tipi → acente); satışta
 * paylaşımlı (aynı acentenin rezervasyonları birbirini beklemez), kontrat
 * yazımında özel (satış yazılırken kontrat değişmez, kontrat yazılırken satış
 * eski fiyatı okumaz). Modül 31: promosyon ve kupon acenteden sonra
 * (rezervasyon → oda tipi → acente → promosyon → kupon); kupon kullanımı kupon
 * satırı kilitliyken sayılır. Modül 33: kanal satırı (ayar, eşleştirme, stop-sale,
 * gönderim) ve kanal rezervasyonu (revizyonlar sırayla uygulanır) — kanal
 * rezervasyonu rezervasyondan **önce** kilitlenir (kanal rezervasyonu →
 * rezervasyon → oda tipi …): revizyonu işleyen iş, rezervasyonu açan / değiştiren
 * servisi çağırmadan önce kanal rezervasyonunu tutar. Modül 35: prim kuralı →
 * hak ediş (ikisi de rezervasyon kilitlemez; hak ediş hesabı rezervasyonları
 * yalnızca okur). Onay kararı hak edişi commit'ten sonra, ayrı işlemde kilitler.
 * Modül 37: etkinlik → salon → ekipman → etkinlik ödemesi (etkinlik konaklama
 * tablolarına dokunmaz).
 * Modül 39: vardiya → adisyon (birden fazlası kimlik sırasıyla) → rezervasyon (odaya
 * yaz yalnızca okur; folyoya kalem aktör yazar).
 *
 * Soft-delete edilmiş satırlar kilitlenmez ve "bulunamadı" sayılır.
 */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} table Tablo adı (sabit, kullanıcı girdisi değil)
 * @param {string} hotelId
 * @param {string[]} ids
 * @returns {Promise<Set<string>>} kilitlenen (var olan) satırların id'leri
 */
async function lockRows(tx, table, hotelId, ids) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  if (unique.length === 0) return new Set();

  // Tablo adı yalnızca bu dosyadaki sabitlerden gelir; değerler parametreli.
  const rows = await tx.$queryRawUnsafe(
    `SELECT id FROM "${table}" WHERE id = ANY($1::text[]) AND "hotelId" = $2 AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`,
    unique,
    hotelId,
  );
  return new Set(rows.map((row) => row.id));
}

/**
 * Rezervasyon satırı: odası değişen konaklama. Kilitlenmezse aynı misafiri
 * aynı anda iki odaya taşıyan iki işlem (ya da otomatik atama ile personel)
 * birbirinin eski okumasıyla çalışır; bir oda sahipsiz "dolu" kalır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} reservationIds
 */
export function lockReservations(tx, hotelId, reservationIds) {
  return lockRows(tx, 'Reservation', hotelId, reservationIds);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} roomTypeIds
 */
export function lockRoomTypes(tx, hotelId, roomTypeIds) {
  return lockRows(tx, 'RoomType', hotelId, roomTypeIds);
}

/**
 * Silinmeyen (`deletedAt` kolonu olmayan) tablolar için kilit.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} table Tablo adı (sabit, kullanıcı girdisi değil)
 * @param {string} hotelId
 * @param {string[]} ids
 * @param {boolean} shared `FOR SHARE` (okuyanlar birbirini beklemez, yazan hepsini bekler)
 * @returns {Promise<Set<string>>}
 */
async function lockPlainRows(tx, table, hotelId, ids, shared) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  if (unique.length === 0) return new Set();
  const rows = await tx.$queryRawUnsafe(
    `SELECT id FROM "${table}" WHERE id = ANY($1::text[]) AND "hotelId" = $2 ORDER BY id ${shared ? 'FOR SHARE' : 'FOR UPDATE'}`,
    unique,
    hotelId,
  );
  return new Set(rows.map((row) => row.id));
}

/**
 * Acente satırı (modül 29). Acenteye rezervasyon yazan işlem `shared: true` ile
 * alır (kontrat / stop-sale / durum okuması bu kilit altında yapılır); acente
 * kartını ya da kontratını değiştiren işlem özel alır. Böylece stop-sale
 * eklenirken aynı anda gelen rezervasyon eski durumu görüp geçemez.
 * Sıra: rezervasyon → oda tipi → acente.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} agencyIds
 * @param {{ shared?: boolean }} [options]
 */
export function lockAgencies(tx, hotelId, agencyIds, { shared = false } = {}) {
  return lockPlainRows(tx, 'Agency', hotelId, agencyIds, shared);
}

/**
 * Promosyon satırı (modül 31): promosyonu değiştiren işlem (düzenleme, yayına
 * alma / durdurma, silme, kupon üretimi) özel kilitler. Sıra: rezervasyon → oda
 * tipi → acente → promosyon → kupon.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} promotionIds
 */
export function lockPromotions(tx, hotelId, promotionIds) {
  return lockPlainRows(tx, 'Promotion', hotelId, promotionIds, false);
}

/**
 * Kupon satırı (modül 31): kupon kullanan rezervasyon (açma, kupon ekleme, iptali
 * geri alma) ve kuponu kapatan işlem özel kilitler. Kullanım sayısı bu kilit
 * altında sayılır: tek kullanımlık kuponu aynı anda iki rezervasyon alamaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} couponIds
 */
export function lockCoupons(tx, hotelId, couponIds) {
  return lockPlainRows(tx, 'Coupon', hotelId, couponIds, false);
}

/**
 * Kanal satırı (modül 33): ayarı, eşleştirmesi, stop-sale'i ya da gönderim
 * durumu değişen kanal. Silinmiş kanal kilitlenmez ("bulunamadı").
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} channelIds
 */
export function lockChannels(tx, hotelId, channelIds) {
  return lockRows(tx, 'Channel', hotelId, channelIds);
}

/**
 * Kanal rezervasyonu (modül 33): aynı rezervasyonun revizyonları aynı anda
 * işlenmez; eski revizyon yenisinin üstüne yazılmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} bookingIds
 */
export function lockChannelBookings(tx, hotelId, bookingIds) {
  return lockPlainRows(tx, 'ChannelBooking', hotelId, bookingIds, false);
}

/**
 * Acente prim kuralı (modül 35): kuralı değiştiren (düzenleme, yürürlüğe alma, iptal)
 * ve hak edişini hesaplayan / onaya gönderen işlem özel kilitler. Böylece hesap
 * sürerken kural değişmez; aynı kural için iki hesap üst üste yazmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} ruleIds
 */
export function lockAgencyBonusRules(tx, hotelId, ruleIds) {
  return lockPlainRows(tx, 'AgencyBonusRule', hotelId, ruleIds, false);
}

/**
 * Hak ediş (modül 35): onaya gönderme, onay kararı, ödeme işareti ve yeniden açma
 * aynı anda yapılmaz. Sıra: prim kuralı → hak ediş.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} bonusIds
 */
export function lockAgencyBonuses(tx, hotelId, bonusIds) {
  return lockPlainRows(tx, 'AgencyBonus', hotelId, bonusIds, false);
}

/**
 * Etkinlik dosyası (modül 37): başlığı, oturumu, kalemi, ödeme planı, durumu, belgesi ya
 * da ödemesi değişen etkinlik özel kilitlenir; toplamları bu kilit altında yeniden yazılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} eventIds
 */
export function lockEvents(tx, hotelId, eventIds) {
  return lockPlainRows(tx, 'Event', hotelId, eventIds, false);
}

/**
 * Salon (modül 37): kesinleştirme ve kesin etkinliğin oturum değişikliği, ilgili atomik
 * salon parçalarını kilitleyip sırayı / çakışmayı denetler — aynı anda iki etkinlik aynı
 * salonda "1. opsiyon"dan kesine geçemez. Sıra: etkinlik → salon → ekipman.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} venueIds
 */
export function lockVenues(tx, hotelId, venueIds) {
  return lockPlainRows(tx, 'Venue', hotelId, venueIds, false);
}

/**
 * Garson vardiyası (modül 39): ödeme ve adisyon açma `shared` alır (vardiya açıkken),
 * kapanış özel alır — sayım yapılırken kasaya yeni para girmez.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} shiftIds
 * @param {{ shared?: boolean }} [options]
 */
export function lockPosShifts(tx, hotelId, shiftIds, { shared = false } = {}) {
  return lockPlainRows(tx, 'PosShift', hotelId, shiftIds, shared);
}

/**
 * Adisyon (modül 39): kalem, düzeltme, ödeme, bölme / birleştirme / taşıma yazan işlem
 * adisyonu özel kilitler; toplamlar bu kilit altında yeniden yazılır. Birden fazla
 * adisyon (birleştirme, bölme) kimlik sırasıyla kilitlenir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} checkIds
 */
export function lockPosChecks(tx, hotelId, checkIds) {
  return lockPlainRows(tx, 'PosCheck', hotelId, checkIds, false);
}

/**
 * Banket ekipmanı (modül 37): stok denetimi (kesin etkinliklerde aynı saatte stoktan
 * fazlası ayrılamaz) ekipman satırı kilitliyken yapılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} equipmentIds
 */
export function lockEventEquipment(tx, hotelId, equipmentIds) {
  return lockPlainRows(tx, 'EventEquipment', hotelId, equipmentIds, false);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} roomIds
 */
export function lockRooms(tx, hotelId, roomIds) {
  return lockRows(tx, 'Room', hotelId, roomIds);
}

/**
 * Konuşma satırı: okunmamış sayacı ve son mesaj özeti aynı anda gelen iki
 * mesajda birbirini ezmesin diye mesaj yazan her işlem önce konuşmayı kilitler.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} conversationIds
 */
export function lockConversations(tx, hotelId, conversationIds) {
  return lockRows(tx, 'Conversation', hotelId, conversationIds);
}

/**
 * Mesaj satırı: kanalın art arda gönderdiği teslim bildirimleri ("gönderildi",
 * "iletildi", "okundu") aynı anda işlenince durum geri gitmesin.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} messageIds
 */
export function lockMessages(tx, hotelId, messageIds) {
  return lockRows(tx, 'Message', hotelId, messageIds);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} requestIds
 */
export function lockGuestRequests(tx, hotelId, requestIds) {
  return lockRows(tx, 'GuestRequest', hotelId, requestIds);
}

/**
 * Onay satırı: aynı anda iki karar verilemez; süre dolumu taraması karar
 * verilmekte olan satırı atlar (`SKIP LOCKED`).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} approvalIds
 */
export function lockApprovals(tx, hotelId, approvalIds) {
  return lockRows(tx, 'Approval', hotelId, approvalIds);
}

/**
 * Bekleme listesi kaydı: rezervasyona çevirme, kapatma ve tarama aynı kaydı
 * aynı anda değiştirmesin.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} waitlistIds
 */
export function lockWaitlistEntries(tx, hotelId, waitlistIds) {
  return lockRows(tx, 'WaitlistEntry', hotelId, waitlistIds);
}

/**
 * Folyo satırı (modül 15): kalem işleme, aktarma, bölme, birleştirme, kapatma
 * ve çıkıştaki bakiye okuması aynı folyoda sıraya girer. Kilit altında
 * toplamlar yeniden hesaplanır; kapanmakta olan folyoya kalem düşmez.
 * Sıra: önce rezervasyon kilidi (gerekiyorsa), sonra folyolar (id sırasıyla).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} folioIds
 */
export function lockFolios(tx, hotelId, folioIds) {
  return lockRows(tx, 'Folio', hotelId, folioIds);
}

/**
 * Çamaşır siparişi (modül 19): durum geçişi ve sayım düzeltmesi aynı siparişte
 * sıraya girer (aynı siparişi iki kişi aynı anda teslim edip ücreti iki kez
 * yazmasın). Sıra: önce rezervasyon kilidi (gerekiyorsa), sonra sipariş.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} orderIds
 */
export function lockLaundryOrders(tx, hotelId, orderIds) {
  return lockRows(tx, 'LaundryOrder', hotelId, orderIds);
}

/**
 * Kayıp eşya (modül 21): eşleştirme, teslim, kapatma ve fotoğraf ekleme aynı
 * eşyada sıraya girer (aynı eşya iki kişiye teslim edilmesin, fotoğraf sınırı
 * aşılmasın). Başka kilitten sonra alınır (bu akışlar rezervasyon kilitlemez).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} itemIds
 */
export function lockLostItems(tx, hotelId, itemIds) {
  return lockRows(tx, 'LostItem', hotelId, itemIds);
}

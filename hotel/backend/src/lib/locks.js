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
 * konuşma → mesaj → istek; her grup kendi içinde id sırasıyla. Bu dosyadaki
 * fonksiyonlar id'leri sıralayıp tek sorguda kilitler — çağıranlar yalnızca
 * gruplar arası sıraya uymalı (oda kilidini aldıktan sonra rezervasyon
 * kilitlenmez). Modül 4 rezervasyon oluştururken `lockRoomTypes` çağırmalı;
 * aksi hâlde aynı anda açılan son iki rezervasyon envanteri aşabilir. Modül 6
 * giriş/çıkışta önce rezervasyonu, sonra odayı kilitlemeli.
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

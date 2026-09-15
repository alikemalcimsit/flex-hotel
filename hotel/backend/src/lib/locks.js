/**
 * Satır kilitleri (`SELECT ... FOR UPDATE`).
 *
 * Neden gerekli: "önce oku, sonra yaz" kontrolü READ COMMITTED'da yarışa
 * açıktır. İki personel aynı anda 101'e misafir atayıp 101'i arızaya alırsa
 * ikisi de "çakışma yok" okur ve ikisi de yazar. Aynı satırı kilitleyen
 * işlemler sıraya girer; ikinci işlem, birincinin commit ettiği veriyi görerek
 * karar verir.
 *
 * **Kilit sırası kuralı (deadlock önlemi):** önce oda tipleri, sonra odalar;
 * her grup kendi içinde id sırasıyla. Bu dosyadaki fonksiyonlar id'leri
 * sıralayıp tek sorguda kilitler — çağıranlar yalnızca "önce tip, sonra oda"
 * sırasına uymalı. Modül 4 rezervasyon oluştururken `lockRoomTypes` çağırmalı;
 * aksi hâlde aynı anda açılan son iki rezervasyon envanteri aşabilir.
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

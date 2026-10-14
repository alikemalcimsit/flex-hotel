/**
 * Kanal yönetimi formlarının saf dönüşümleri (modül 33): ayar formu ↔ sunucu,
 * eşleştirme tablosu ↔ sunucu, senkron durumunun okunur cümlesi ve iCal
 * dışa aktarma adresi. React bilmez; `channelForm.test.js` sınar.
 */

/**
 * Ayar formunun başlangıç değerleri. Anahtar hiçbir zaman gelmez: boş alan
 * "değiştirme" demektir.
 * @param {any} channel sunucunun kanal kartı
 */
export function settingsFormOf(channel) {
  return {
    name: channel.name,
    horizonDays: String(channel.horizonDays),
    priceMarkupPercent: channel.type === 'CHANNEX' ? String(Number(channel.priceMarkupPercent)) : '0',
    environment: channel.environment ?? 'STAGING',
    propertyId: channel.propertyId ?? '',
    apiKey: '',
    provider: channel.provider ?? 'AIRBNB',
  };
}

/**
 * Ayar formu → `updateChannelSchema` girdisi (türe ait olmayan alan gönderilmez).
 * @param {ReturnType<typeof settingsFormOf>} values
 * @param {{ type: string, updatedAt: string }} channel
 */
export function settingsPayload(values, channel) {
  const common = { expectedUpdatedAt: channel.updatedAt, name: values.name, horizonDays: values.horizonDays };
  if (channel.type === 'CHANNEX') {
    return {
      ...common,
      priceMarkupPercent: values.priceMarkupPercent,
      environment: values.environment,
      propertyId: values.propertyId.trim(),
      apiKey: values.apiKey.trim() || null,
    };
  }
  return { ...common, provider: values.provider };
}

/**
 * Ayar değişikliği bağlantıyı yeniden kurar mı (Channex mülkü / ortamı değişti)?
 * Değişirse eşleştirme silinir; ekran onay ister.
 * @param {ReturnType<typeof settingsFormOf>} values
 * @param {{ type: string, environment: string | null, propertyId: string | null }} channel
 */
export function propertyChanged(values, channel) {
  return channel.type === 'CHANNEX' && (values.environment !== channel.environment || values.propertyId.trim() !== channel.propertyId);
}

/**
 * @typedef {{
 *   roomTypeId: string,
 *   roomTypeName: string,
 *   roomTypeCode: string,
 *   deleted: boolean,
 *   enabled: boolean,
 *   externalRoomTypeId: string,
 *   rates: Array<{ externalRatePlanId: string, boardType: string }>,
 *   icalImportUrl: string,
 *   exportPath: string | null,
 *   lastImportAt: string | null,
 *   lastImportError: string | null,
 *   lastExportAt: string | null,
 * }} MappingRow
 */

/**
 * Eşleştirme tablosunun satırları: otelin her oda tipi (eşleşmiş ya da değil)
 * ve silinmiş ama hâlâ eşleşmiş tipler (kaldırılabilsin diye).
 *
 * @param {{ rooms: any[] }} channel
 * @param {Array<{ id: string, code: string, name: string }>} roomTypes
 * @returns {MappingRow[]}
 */
export function mappingRowsOf(channel, roomTypes) {
  const byType = new Map(channel.rooms.map((room) => [room.roomTypeId, room]));
  const row = (roomTypeId, code, name, deleted) => {
    const room = byType.get(roomTypeId);
    return {
      roomTypeId,
      roomTypeName: name,
      roomTypeCode: code,
      deleted,
      enabled: Boolean(room),
      externalRoomTypeId: room?.externalRoomTypeId ?? '',
      rates: (room?.rates ?? []).map((rate) => ({ externalRatePlanId: rate.externalRatePlanId, boardType: rate.boardType })),
      icalImportUrl: room?.icalImportUrl ?? '',
      exportPath: room?.exportPath ?? null,
      lastImportAt: room?.lastImportAt ?? null,
      lastImportError: room?.lastImportError ?? null,
      lastExportAt: room?.lastExportAt ?? null,
    };
  };
  const rows = roomTypes.map((type) => row(type.id, type.code, type.name, false));
  const known = new Set(roomTypes.map((type) => type.id));
  for (const room of channel.rooms) {
    if (!known.has(room.roomTypeId)) rows.push(row(room.roomTypeId, room.roomType.code, room.roomType.name, true));
  }
  return rows;
}

/**
 * Seçilen Channex oda tipine bağlı fiyat planları.
 * @param {{ ratePlans: Array<{ id: string, title: string, roomTypeId: string | null }> } | undefined} options
 * @param {string} externalRoomTypeId
 */
export function ratePlansFor(options, externalRoomTypeId) {
  if (!options || !externalRoomTypeId) return [];
  return options.ratePlans.filter((plan) => !plan.roomTypeId || plan.roomTypeId === externalRoomTypeId);
}

/**
 * Tablo → `saveChannelMappingsSchema` girdisi. Kanal adları Channex
 * listesinden eklenir (log ve kartta okunur ad).
 *
 * @param {MappingRow[]} rows
 * @param {{ type: string, updatedAt: string }} channel
 * @param {{ roomTypes: Array<{ id: string, title: string }>, ratePlans: Array<{ id: string, title: string }> } | undefined} options
 */
export function mappingPayload(rows, channel, options) {
  const roomTitle = new Map((options?.roomTypes ?? []).map((row) => [row.id, row.title]));
  const planTitle = new Map((options?.ratePlans ?? []).map((row) => [row.id, row.title]));
  return {
    expectedUpdatedAt: channel.updatedAt,
    rooms: rows
      .filter((row) => row.enabled)
      .map((row) =>
        channel.type === 'CHANNEX'
          ? {
              roomTypeId: row.roomTypeId,
              externalRoomTypeId: row.externalRoomTypeId,
              externalName: roomTitle.get(row.externalRoomTypeId) ?? null,
              rates: row.rates
                .filter((rate) => rate.externalRatePlanId)
                .map((rate) => ({ externalRatePlanId: rate.externalRatePlanId, externalName: planTitle.get(rate.externalRatePlanId) ?? null, boardType: rate.boardType })),
              icalImportUrl: null,
            }
          : { roomTypeId: row.roomTypeId, externalRoomTypeId: null, externalName: null, rates: [], icalImportUrl: row.icalImportUrl.trim() || null },
      ),
  };
}

/**
 * Sunucunun hata alanı ("rooms.0.externalRoomTypeId") → tablodaki satır ve alan.
 * Şema satırları yalnızca açık (eşleşen) satırlardan kurduğu için sıra açık satırların sırasıdır.
 *
 * @param {Record<string, string>} errors
 * @param {MappingRow[]} rows
 * @returns {Record<string, Record<string, string>>} oda tipi → alan → mesaj
 */
export function mappingErrorsByRow(errors, rows) {
  const enabled = rows.filter((row) => row.enabled);
  const result = {};
  for (const [path, message] of Object.entries(errors ?? {})) {
    const match = /^rooms\.(\d+)\.(.+)$/.exec(path);
    if (!match) continue;
    const row = enabled[Number(match[1])];
    if (!row) continue;
    result[row.roomTypeId] = { ...(result[row.roomTypeId] ?? {}), [match[2]]: message };
  }
  return result;
}

/**
 * Kanalın senkron durumunun bir cümlesi ve tonu (kart başlığı, liste).
 *
 * @param {{ status: string, type: string, sync: any }} channel
 * @param {(value: string) => string} formatTime
 * @returns {{ text: string, tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }}
 */
export function syncSummary(channel, formatTime) {
  const { sync } = channel;
  if (channel.status === 'DRAFT') return { text: 'Henüz senkrona alınmadı', tone: 'neutral' };
  if (channel.status === 'PAUSED') return { text: 'Durduruldu: kanala hiçbir şey gitmiyor', tone: 'neutral' };
  if (sync.pausedUntil) {
    return { text: `${sync.lastError ?? 'Kanal hata verdi'} — ${formatTime(sync.pausedUntil)} sonrası yeniden denenecek`, tone: 'danger' };
  }
  if (sync.lastSyncStatus === 'FAILED') return { text: sync.lastError ?? 'Son iş başarısız', tone: 'danger' };
  if (sync.lastSyncStatus === 'PARTIAL') return { text: sync.lastError ?? 'Kanal bazı satırları reddetti', tone: 'warning' };
  if (sync.pending) return { text: 'Gönderilecek değişiklik var; birkaç saniye içinde gider', tone: 'info' };
  // iCal'de değişiklik olmayan okuma log yazmaz: son iş yoksa son okuma zamanı.
  const last = sync.lastSyncAt ?? (channel.type === 'ICAL' ? sync.lastIcalImportAt : null);
  if (!last) return { text: channel.type === 'CHANNEX' ? 'İlk tam eşitleme bekleniyor' : 'Takvim henüz okunmadı', tone: 'info' };
  return { text: `Güncel · son iş ${formatTime(last)}`, tone: 'success' };
}

/**
 * iCal dışa aktarma adresi: sunucunun kök adresi + yol.
 * @param {string} apiUrl
 * @param {string | null} path
 */
export function exportUrl(apiUrl, path) {
  return path ? `${apiUrl.replace(/\/+$/, '')}${path}` : '';
}

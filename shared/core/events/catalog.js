import { z } from 'zod';

/**
 * Event kataloğu.
 *
 * Bir event'in adı ve gövdesi burada tanımlanmadan yayınlanamaz. Sebep:
 * event'ler modüller arası sözleşmedir — yayınlayan ile dinleyen farklı
 * zamanlarda, farklı kişiler tarafından yazılıyor. Şemasız event, iki hafta
 * sonra "bu alan neden yok" tartışmasıdır.
 *
 * `version` alanı ileriye dönük: gövde değişince eski sürüm bir süre
 * desteklenebilsin diye zarf sürümü taşıyor.
 */

const hotelScoped = z.object({ hotelId: z.string().uuid() });

/** Ayar kayıtlarının ortak kimlik gövdesi. */
const settingsEntity = hotelScoped.extend({
  id: z.string().uuid(),
  label: z.string().min(1),
});

/**
 * Event gövdeleri JSON olarak saklandığı için tarihler ISO metne indirgenir.
 * Date da kabul edilir; yayıncı her seferinde elle çevirmek zorunda kalmasın.
 */
const isoDate = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value))
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'geçersiz tarih' });

/** Rezervasyon olaylarının ortak gövdesi (modül 4): kimlik ve envanter etkisi. */
const reservationStay = hotelScoped.extend({
  reservationId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  checkIn: isoDate,
  checkOut: isoDate,
});

/** "1234.50" / "-45.00" biçiminde tutar metni. */
const moneyText = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'tutar "1234.50" biçiminde olmalı');

/** "YYYY-MM-DD" takvim günü (otelin günü). */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'gün "YYYY-MM-DD" biçiminde olmalı');

/** Folyo olaylarının ortak gövdesi (modül 15): hangi folyo, hangi konaklamanın. */
const folioEvent = hotelScoped.extend({
  folioId: z.string().uuid(),
  reservationId: z.string().uuid(),
});

/** Ödeme olaylarının ortak gövdesi (modül 17): hangi ödeme, hangi folyoda, hangi konaklamanın. */
const paymentEvent = folioEvent.extend({ paymentId: z.string().uuid() });

/**
 * Bakiyeyi değiştiren ödeme olayları: folyonun konaklaması bitmiş mi (çıkmış,
 * iptal, gelmedi). Folyo aktörü yalnızca bunlarda "bakiye sıfırlandıysa kapat"
 * işine bakar; içerideki misafirin her ödemesi için iş açmaz.
 */
const balanceChange = { stayEnded: z.boolean().default(false) };

/**
 * Dış kaynaktan (restoran siparişi, minibar tüketimi) folyoya işlenecek
 * harcama. Konaklama biliniyorsa `reservationId`; bilinmiyorsa oda (`roomId`,
 * o an odada konaklayan misafir bulunur). Tutarlar otelin para biriminde,
 * vergi dahil/hariç otelin vergi ayarına göre (kalem tipi: restoran / minibar).
 */
const externalCharge = hotelScoped
  .extend({
    reservationId: z.string().uuid().nullable().default(null),
    roomId: z.string().uuid().nullable().default(null),
    /** Kaynaktaki kayıt no (adisyon, tüketim fişi) — folyoda ve denetimde görünür. */
    reference: z.string().min(1).max(60),
    items: z
      .array(
        z.object({
          description: z.string().min(1).max(200),
          unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'birim fiyat "45.50" biçiminde olmalı'),
          quantity: z.number().int().min(1).max(999),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine((value) => Boolean(value.reservationId || value.roomId), { message: 'konaklama ya da oda gerekli' });

/** Onay olaylarının ortak gövdesi (modül 11). */
const approvalEvent = hotelScoped.extend({
  approvalId: z.string().uuid(),
  /** Sözleşmedeki onay türü (`APPROVAL_TYPES`). */
  type: z.string().min(1),
  /** İsteyen aktör; kişi ya da servis istediyse `null`. */
  actorName: z.string().nullable(),
});

export const EVENT_CATALOG = Object.freeze({
  'settings.hotel.updated': hotelScoped.extend({
    /** Değişen alan adları — dinleyen taraf neyin değiştiğine göre karar verebilsin. */
    changedFields: z.array(z.string()).default([]),
  }),

  'settings.roomType.created': settingsEntity,
  'settings.roomType.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }),
  'settings.roomType.deleted': settingsEntity,

  'settings.tax.created': settingsEntity,
  'settings.tax.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }),
  'settings.tax.deleted': settingsEntity,

  'settings.season.created': settingsEntity,
  'settings.season.updated': settingsEntity.extend({ changedFields: z.array(z.string()).default([]) }),
  'settings.season.deleted': settingsEntity,

  /* ── Oda envanteri (modül 3) ── */

  'inventory.room.created': settingsEntity.extend({ roomTypeId: z.string().uuid() }),
  'inventory.room.updated': settingsEntity.extend({
    roomTypeId: z.string().uuid(),
    changedFields: z.array(z.string()).default([]),
  }),
  'inventory.room.deleted': settingsEntity.extend({ roomTypeId: z.string().uuid() }),

  'room.assigned': hotelScoped.extend({
    reservationId: z.string().uuid(),
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    /** Aktör mü yoksa personel mi attı — Activity Feed'de ayırt edilsin. */
    assignedBy: z.enum(['manual', 'auto']).default('manual'),
  }),
  'room.unassigned': hotelScoped.extend({
    reservationId: z.string().uuid(),
    roomId: z.string().uuid(),
    roomNumber: z.string(),
  }),
  /**
   * Odanın iki bağımsız durumundan biri değişti.
   *
   * `field` hangisi olduğunu söyler: `occupancy` (Boş/Dolu — yalnızca giriş ve
   * çıkış değiştirir) ya da `housekeeping` (Kirli/Temizleniyor/Temiz/Kontrol
   * edildi). Çıkışta ikisi birden değiştiği için iki ayrı event yayınlanır.
   */
  'room.status.changed': hotelScoped.extend({
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    field: z.enum(['occupancy', 'housekeeping']),
    from: z.string(),
    to: z.string(),
  }),
  /**
   * Oda tarih aralığıyla arızalı ya da hizmet dışı işaretlendi.
   * `OUT_OF_ORDER` envanterden düşer; `OUT_OF_SERVICE` satışta kalır ama atanmaz.
   */
  'room.blocked': hotelScoped.extend({
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    blockId: z.string().uuid(),
    type: z.enum(['OUT_OF_ORDER', 'OUT_OF_SERVICE']),
    startDate: isoDate,
    endDate: isoDate.nullable(),
    reason: z.string(),
  }),
  /**
   * Blok kaldırıldı. `CANCELLED`: henüz başlamamıştı, kayıt silindi.
   * `ENDED`: sürüyordu, bitişi bugüne çekildi (geçmiş günler değişmez).
   */
  'room.unblocked': hotelScoped.extend({
    roomId: z.string().uuid(),
    roomNumber: z.string(),
    blockId: z.string().uuid(),
    mode: z.enum(['CANCELLED', 'ENDED']),
  }),

  /* ── Rezervasyon (modül 4) ── */

  'reservation.created': reservationStay.extend({
    /** Rezervasyon oluşturulurken oda zaten atandıysa aktör tekrar atamaz. */
    roomId: z.string().uuid().nullable().default(null),
    /** Grup rezervasyonunun parçasıysa grup kimliği. */
    groupId: z.string().uuid().nullable().default(null),
    /**
     * Rezervasyonun kaynağı ve isteğin kimliği (modül 8): concierge yalnızca
     * kanal isteğinden (WhatsApp / web chat) açılanlarla ilgilenir; sohbete
     * yazacağı onay kodunu isteğe bu kimlikle bağlar.
     */
    source: z.string().min(1).max(30).nullable().default(null),
    requestId: z.string().min(1).max(100).nullable().default(null),
  }),
  /** Tarih, oda tipi, kişi, pansiyon, fiyat ya da not değişti. */
  'reservation.updated': reservationStay.extend({
    changedFields: z.array(z.string()).default([]),
  }),
  /** Opsiyonlu (bekleyen) rezervasyon kesinleşti. */
  'reservation.confirmed': hotelScoped.extend({ reservationId: z.string().uuid() }),
  /** İptal: envanter serbest kalır (bekleme listesi taranır). */
  'reservation.cancelled': reservationStay,
  /** Misafir gelmedi: envanter serbest kalır. */
  'reservation.no_show': reservationStay,
  /** İptal / gelmedi geri alındı: envanter yeniden tüketilir. */
  'reservation.reinstated': reservationStay,
  /**
   * Kanaldan (WhatsApp, web chat, e-posta, OTA) gelen rezervasyon isteği.
   * reservation-worker işler: `reservation.created` ya da `reservation.rejected`.
   * `requestId` isteği yapanın kimliğidir; aynı kimlikle ikinci rezervasyon açılmaz.
   */
  'reservation.requested': hotelScoped.extend({
    requestId: z.string().min(1).max(100),
    source: z.enum(['WEBCHAT', 'WHATSAPP', 'EMAIL', 'WIDGET', 'OTA', 'AGENCY', 'PHONE']),
    guest: z.object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
      phone: z.string().max(40).nullable().default(null),
      email: z.string().max(200).nullable().default(null),
      nationality: z.string().max(2).nullable().default(null),
    }),
    roomTypeId: z.string().uuid(),
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20).default(0),
    boardType: z.enum(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI']).nullable().default(null),
    notes: z.string().max(2000).nullable().default(null),
    /** Kanal isteği varsayılan olarak opsiyonludur: personel onaylar. */
    status: z.enum(['PENDING', 'CONFIRMED']).default('PENDING'),
    /**
     * Kanal misafiri zaten tanıyorsa (konuşma bir misafir kartına bağlı) o kart
     * kullanılır; yoksa yeni kart açılır. Modül 8.
     */
    guestId: z.string().uuid().nullable().default(null),
  }),
  /** Kanal isteği karşılanamadı (yer yok, kapasite, geçersiz tarih). */
  'reservation.rejected': hotelScoped.extend({
    requestId: z.string().min(1).max(100),
    code: z.string().min(1),
    reason: z.string().min(1),
  }),
  /** Bekleme listesi kaydı açıldı, yer açıldı / doldu, çevrildi ya da kapandı. */
  'waitlist.changed': hotelScoped.extend({
    waitlistId: z.string().uuid(),
    status: z.enum(['WAITING', 'AVAILABLE', 'CONVERTED', 'CANCELLED', 'EXPIRED']),
  }),

  /* ── Giriş / çıkış (modül 6) ──
     room-worker odanın doluluğunu bunlardan yazar (doluluğun tek yazıcısı);
     notification-worker hoş geldin / teşekkür bildirimini gönderir; folyo
     aktörü (modül 15) folyoyu açar, ücretleri kalem olarak işler ve çıkışta
     bakiyeyi denetler. Tutarlar "1234.50" biçiminde metin; ücret yoksa null. */
  'guest.checked_in': reservationStay.extend({
    roomId: z.string().uuid(),
    guestId: z.string().uuid(),
    /** Erken giriş ücreti (politikadan; personel uygulamadıysa null). */
    earlyCheckInFee: z.string().nullable().default(null),
    /** Girişte alınan teminat (tahsilat değil; kasaya girişi ödeme modülünde). */
    deposit: z
      .object({
        method: z.enum(['CASH', 'CARD_PREAUTH', 'TRANSFER']),
        amount: z.string(),
        reference: z.string().nullable().default(null),
      })
      .nullable()
      .default(null),
  }),

  'guest.checked_out': reservationStay.extend({
    roomId: z.string().uuid(),
    guestId: z.string().uuid(),
    lateCheckOutFee: z.string().nullable().default(null),
    /** Çıkış tarihinden önce ayrıldı: `checkOut` kısaltılmış tarihtir, kalan geceler bırakıldı. */
    earlyDeparture: z.boolean().default(false),
    /** Bakiyesi kapanmadan çıkış yapıldıysa o anki açık tutar (yetkili onayıyla). */
    openBalance: z.string().nullable().default(null),
  }),

  /** Yanlışlıkla yapılan giriş geri alındı (aynı gün): oda yeniden boş. */
  'guest.check_in_reverted': reservationStay.extend({
    roomId: z.string().uuid(),
    reason: z.string().min(1),
  }),

  /** Yanlışlıkla yapılan çıkış geri alındı (aynı gün): misafir yine içeride, oda dolu. */
  'guest.check_out_reverted': reservationStay.extend({
    roomId: z.string().uuid(),
    reason: z.string().min(1),
  }),

  /* ── Misafir mesajları ve istekleri (modül 7) ──
     Kanallar (WhatsApp, web chat) modül 8'de. Sözleşme:
     - Kanal gelen mesajı `messaging/service.js → receiveInboundMessage` ile
       teslim eder; servis kaydeder ve `guest.message.received` yayınlar
       (router/concierge ajanları bunu dinler).
     - Personelin ya da AI'ın cevabı `guest.message.reply` yayınlar; kanal
       bunu dinleyip gönderir ve `markMessageDelivery` ile sonucu bildirir. */

  'guest.message.received': hotelScoped.extend({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    channel: z.string(),
    guestId: z.string().uuid().nullable(),
    /** Konuşma "manuele alınmış"sa AI asistanı cevap vermemeli. */
    mode: z.enum(['AI', 'MANUAL']),
  }),

  'guest.message.reply': hotelScoped.extend({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    channel: z.string(),
    /** Kanaldaki alıcı: telefon numarası, web chat oturumu. */
    recipient: z.string(),
    author: z.enum(['STAFF', 'AI', 'SYSTEM']),
  }),

  /**
   * Router ajanı gelen misafir mesajının niyetini belirledi (modül 8).
   * Concierge ajanı bunu dinler; şikâyet ve "personelle görüşmek istiyorum"
   * konuşmayı personele devreder. `affirmative`: mesaj, misafire sunulmuş bir
   * teklife açık bir "evet" mi (rezervasyon isteği ancak bununla gönderilir).
   */
  'guest.intent.detected': hotelScoped.extend({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    intent: z.enum(['RESERVATION', 'QUESTION', 'COMPLAINT', 'HUMAN', 'OTHER']),
    confidence: z.number().min(0).max(1),
    language: z.string().min(2).max(8),
    affirmative: z.boolean(),
  }),

  'guest.message.delivery': hotelScoped.extend({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    delivery: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
  }),

  /** Konuşmanın durumu, modu, ataması ya da bağlı konaklaması değişti. */
  'conversation.updated': hotelScoped.extend({
    conversationId: z.string().uuid(),
    changedFields: z.array(z.string()).default([]),
    mode: z.enum(['AI', 'MANUAL']),
    status: z.enum(['OPEN', 'CLOSED']),
  }),

  /** Konuşma okundu: diğer paneller okunmamış rozetini düşürsün. */
  'conversation.read': hotelScoped.extend({
    conversationId: z.string().uuid(),
  }),

  'guest.request.created': hotelScoped.extend({
    requestId: z.string().uuid(),
    category: z.string(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
    roomId: z.string().uuid().nullable(),
    conversationId: z.string().uuid().nullable(),
  }),

  'guest.request.updated': hotelScoped.extend({
    requestId: z.string().uuid(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']),
    changedFields: z.array(z.string()).default([]),
  }),

  /* ── Bildirim merkezi (modül 9) ──
     Misafir bildirimi kuyruğa yazılınca `notification.send.requested`
     yayınlanır; gönderici (backend `notifications/dispatcher.js`) üstlenip
     gönderir ve sonucu `notification.sent` / `notification.failed` ile duyurur.
     Gönderim HTTP isteğinin yolunda yapılmaz: dinleyiciler beklendiği için
     yavaş bir SMTP sunucusu oda atamasını bekletirdi. */

  'notification.send.requested': hotelScoped.extend({
    notificationId: z.string().uuid(),
    channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']),
    source: z.string(),
  }),

  'notification.sent': hotelScoped.extend({
    notificationId: z.string().uuid(),
    channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']),
    provider: z.string(),
  }),

  /** Sağlayıcı teslim raporu (SMS): alıcıya ulaştı. */
  'notification.delivered': hotelScoped.extend({
    notificationId: z.string().uuid(),
    channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']),
  }),

  /**
   * Gönderim başarısız. `final: false` ise yeniden denenecek; `true` ise
   * hakkı bitti ya da hata kalıcı (yanlış parola, tanımsız başlık).
   */
  'notification.failed': hotelScoped.extend({
    notificationId: z.string().uuid(),
    channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']),
    errorCode: z.string().nullable(),
    final: z.boolean(),
  }),

  /** Bekleyen gönderim iptal edildi ya da gönderilmedi (kanal kapalı, alıcı istemiyor). */
  'notification.cancelled': hotelScoped.extend({
    notificationId: z.string().uuid(),
    channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']),
  }),

  /** Şablon eklendi / değişti / varsayılana döndü. */
  'notification.template.saved': hotelScoped.extend({
    templateId: z.string().uuid(),
    key: z.string(),
    channel: z.string(),
    language: z.string(),
    changedFields: z.array(z.string()).default([]),
  }),

  /** Kanal ayarı değişti (parola değişikliği yalnızca alan adıyla görünür). */
  'notification.channel.updated': hotelScoped.extend({
    channel: z.string(),
    enabled: z.boolean(),
    changedFields: z.array(z.string()).default([]),
  }),

  /**
   * Personel uyarısı açıldı ya da birleşerek öne çıktı. Kime gittiği
   * (`userId` ya da `permission`) gövdede: paneller yalnızca kendilerini
   * ilgilendiren uyarıda rozeti artırır, herkes sunucuya sormaz.
   */
  'staff.alert.raised': hotelScoped.extend({
    alertId: z.string().uuid(),
    kind: z.enum([
      'GUEST_MESSAGE',
      'URGENT_REQUEST',
      'OVERDUE_REQUEST',
      'MANUAL_TASK',
      'NOTIFICATION_FAILED',
      'APPROVAL_REQUESTED',
      'APPROVAL_DECIDED',
      'WAITLIST_AVAILABLE',
      'CHECKOUT_OPEN_BALANCE',
      'FOLIO_ATTENTION',
      'AI_HANDOFF',
      'AI_BUDGET',
    ]),
    userId: z.string().uuid().nullable(),
    permission: z.string().nullable(),
  }),

  /* ── Onay kuyruğu (modül 11) ── */

  /**
   * Bir iş personelin onayına düştü. Gövde yalnızca kimlik ve tür taşır;
   * özet ve veri ekranda HTTP ile okunur (socket'e içerik çıkmaz).
   */
  'approval.requested': approvalEvent.extend({
    /** Süreli onayın son anı; süresiz ise `null`. */
    expiresAt: isoDate.nullable(),
  }),
  /** Onaylandı: `PendingAction` varsa isteyen aktör kaldığı yerden devam eder. */
  'approval.granted': approvalEvent.extend({ decidedBy: z.string().min(1) }),
  'approval.denied': approvalEvent.extend({ decidedBy: z.string().min(1) }),
  /** Süresi kimse karar vermeden doldu; iş yapılmadı. */
  'approval.expired': approvalEvent,

  /* ── Aktör paneli (modül 12) ── */

  /**
   * Aktör bu otelde açıldı ya da kapatıldı. Kapalı aktörün işi manuel göreve
   * düşer; AI ajanları kapanınca yeni konuşmalar personelde açılır.
   */
  'actor.setting.changed': hotelScoped.extend({
    actorName: z.string().min(1),
    enabled: z.boolean(),
  }),

  /** Aktörün yapamadığı iş personelin önüne düştü (görev ekranı ve rozet tazelenir). */
  'manual_task.created': hotelScoped.extend({
    taskId: z.string().uuid(),
    module: z.string().min(1),
    actorName: z.string().nullable(),
  }),

  /** Görev üstlenildi, bırakıldı, tamamlandı ya da "gerek kalmadı" dendi. */
  'manual_task.updated': hotelScoped.extend({
    taskId: z.string().uuid(),
    module: z.string().min(1),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']),
  }),

  /* ── Folyo (modül 15) ──
     Folyo ekranı, liste ve ön büro bakiyeleri bunlarla canlı tazelenir
     (`FOLIO_EVENTS`). Gövdelerde tutar ve açıklama yok (socket'e hesap
     içeriği çıkmaz); ekran HTTP ile okur. Fatura modülü (16) `folio.closed`'u,
     sadakat (35) harcamayı dinler. */

  /** Konaklamaya folyo açıldı (girişte aktör, bölmede ya da elle personel). */
  'folio.opened': folioEvent.extend({ window: z.number().int().min(1) }),
  /** Ödeyen adı değişti. */
  'folio.updated': folioEvent,
  /** Folyoya kalem işlendi (elle harcama, indirim, giriş/çıkış ücreti, restoran, minibar). */
  'folio.charge.posted': folioEvent.extend({
    itemIds: z.array(z.string().uuid()).min(1).max(100),
    source: z.string().min(1),
    total: moneyText,
  }),
  /**
   * Bu gecenin oda ücretleri işlenmeli (zamanlayıcı, gün dönünce bir kez).
   * Folyo aktörü dinler; kapalıysa iş "oda ücretleri işlenecek" görevine düşer.
   */
  'folio.room_charges.due': hotelScoped.extend({ night: isoDay }),
  /** Oda ücretleri işlendi (gece ya da çıkışta): kaç konaklama, kaç kalem, toplam. */
  'folio.room_charges.posted': hotelScoped.extend({
    night: isoDay,
    stays: z.number().int().min(0),
    items: z.number().int().min(0),
    total: moneyText,
  }),
  /** Kalem iptali onaya gitti. */
  'folio.item.void_requested': folioEvent.extend({ itemId: z.string().uuid(), approvalId: z.string().uuid() }),
  /** Kalem iptal edildi (ters kayıt işlendi). Onaylı iptalde `approvalId` dolu; sistemin geri alması boş. */
  'folio.item.voided': folioEvent.extend({
    itemId: z.string().uuid(),
    reversalId: z.string().uuid(),
    approvalId: z.string().uuid().nullable().default(null),
  }),
  /** İptal isteği reddedildi ya da süresi doldu: kalem olduğu gibi kalır. */
  'folio.item.void_declined': folioEvent.extend({
    itemId: z.string().uuid(),
    approvalId: z.string().uuid(),
    outcome: z.enum(['DENIED', 'EXPIRED']),
  }),
  /** Kalemler bir folyodan diğerine aktarıldı (başka konaklamanın folyosuna da olabilir). */
  'folio.items.transferred': hotelScoped.extend({
    fromFolioId: z.string().uuid(),
    toFolioId: z.string().uuid(),
    /** Etkilenen konaklamalar (kaynak ve hedef). */
    reservationIds: z.array(z.string().uuid()).min(1).max(2),
    itemIds: z.array(z.string().uuid()).min(1).max(200),
  }),
  /** Folyo bölündü: aynı konaklamada yeni folyo açıldı, seçilen kalemler taşındı. */
  'folio.split': folioEvent.extend({
    newFolioId: z.string().uuid(),
    itemIds: z.array(z.string().uuid()).max(200),
  }),
  /** Folyolar bu folyoda birleşti (grup hesabı): kaynaklar "birleştirildi" oldu. */
  'folio.merged': folioEvent.extend({
    sourceFolioIds: z.array(z.string().uuid()).min(1).max(20),
    /** Kaynak folyoların konaklamaları (sonraki kalemleri buraya yönlendi). */
    reservationIds: z.array(z.string().uuid()).min(1).max(21),
  }),
  /** Konaklamanın yönlendirmesi değişti (hangi tip hangi folyoya düşer). */
  'folio.routes.changed': hotelScoped.extend({ reservationId: z.string().uuid() }),
  /** Folyo kapandı (bakiye sıfır). Fatura modülü taslak faturayı buradan üretir. */
  'folio.closed': folioEvent.extend({ chargesTotal: moneyText, currency: z.string().length(3) }),
  /** Kapanmış folyo yeniden açıldı (yetkiliyle, gerekçeli; ya da çıkış geri alındı). */
  'folio.reopened': folioEvent.extend({ reason: z.string().min(1) }),

  /* ── Folyoya dış kaynaklı harcama (yayıncıları: modül 19 minibar, 39 / 41 restoran) ── */

  /** Restoran / oda servisi siparişi odaya yazıldı. */
  'fnb.order.charged': externalCharge,
  /** Kat görevlisi odada minibar tüketimi girdi. */
  'minibar.consumed': externalCharge,
  /** Çamaşır siparişi misafire teslim edildi: ücreti folyoya (modül 19). */
  'laundry.charged': externalCharge,

  /* ── Minibar ve çamaşırhane ekranları (modül 19) ──
     Kayıt ve pano ekranları bunlarla canlı tazelenir (`EXTRAS_EVENTS`).
     Folyoya giden ücret yukarıdaki `minibar.consumed` / `laundry.charged`. */

  /** Odanın minibar sayımı girildi (folyoya giden ya da kayıp). */
  'minibar.recorded': hotelScoped.extend({
    consumptionId: z.string().uuid(),
    roomId: z.string().uuid(),
    reservationId: z.string().uuid().nullable(),
    chargeTarget: z.enum(['IN_HOUSE', 'LATE', 'NONE']),
  }),
  /** Çamaşır siparişi açıldı, sayımı düzeldi ya da durumu değişti. */
  'laundry.order.changed': hotelScoped.extend({
    orderId: z.string().uuid(),
    roomId: z.string().uuid(),
    reservationId: z.string().uuid(),
    status: z.enum(['RECEIVED', 'IN_PROCESS', 'READY', 'DELIVERED', 'CANCELLED']),
  }),
  /** Minibar / çamaşır fiyat listesi ya da ekspres farkı değişti. */
  'extras.catalog.changed': hotelScoped.extend({ catalog: z.enum(['MINIBAR', 'LAUNDRY', 'SETTINGS']) }),

  /* ── Kayıp eşya (modül 21) ──
     Liste ve eşya ekranı bunlarla canlı tazelenir (`LOST_ITEM_EVENTS`).
     Yükte yalnızca kimlikler: açıklama ve misafir bilgisi socket'e çıkmaz. */

  /** Bulunan eşya kaydedildi. */
  'lost_item.recorded': hotelScoped.extend({
    itemId: z.string().uuid(),
    roomId: z.string().uuid().nullable(),
    valuable: z.boolean(),
  }),
  /** Eşya değişti: bilgi, fotoğraf, eşleşme, iletişim notu, teslim ya da kapatma. */
  'lost_item.changed': hotelScoped.extend({
    itemId: z.string().uuid(),
    status: z.enum(['STORED', 'MATCHED', 'RETURNED', 'DISPOSED']),
    change: z.enum(['UPDATED', 'PHOTO_ADDED', 'PHOTO_REMOVED', 'MATCHED', 'UNMATCHED', 'CONTACTED', 'RETURNED', 'DISPOSED', 'PHOTOS_PURGED']),
    guestId: z.string().uuid().nullable().default(null),
  }),
  /** Saklama süreleri değişti ("süresi dolan" listesi yeniden hesaplanır). */
  'lost_items.settings.changed': hotelScoped,

  /* ── Ödeme (modül 17) ──
     Folyo ekranı (bakiye) ve kasa görünümü bunlarla canlı tazelenir
     (`PAYMENT_EVENTS`). Tutar folyonun para biriminde (`amount`, iade ve
     iptal kaydında eksi); socket'e yalnızca kimlikler çıkar. Folyo aktörü
     işlenen ödemeden sonra çıkmış misafirin bakiyesi sıfırlandıysa folyoyu
     kapatır; gece kapanışı (18) kasayı veritabanından okur. */

  /** Ödeme ya da iade onaya gitti (eşik üstü ödeme, her iade): bakiyeye henüz girmedi. */
  'payment.requested': paymentEvent.extend({ kind: z.enum(['PAYMENT', 'REFUND']), approvalId: z.string().uuid() }),
  /** Ödeme işlendi (doğrudan ya da onaylanınca): bakiye düştü. */
  'payment.received': paymentEvent.extend({
    ...balanceChange,
    method: z.string().min(1),
    source: z.string().min(1),
    amount: moneyText,
    currency: z.string().length(3),
    approvalId: z.string().uuid().nullable().default(null),
  }),
  /** İade işlendi (onaylandı): bakiye arttı, para misafire döndü. */
  'payment.refunded': paymentEvent.extend({
    ...balanceChange,
    method: z.string().min(1),
    amount: moneyText,
    currency: z.string().length(3),
    approvalId: z.string().uuid(),
  }),
  /**
   * Onay bekleyen ödeme / iade işlenmedi: reddedildi, süresi doldu ya da
   * onaylandığında folyo kapanmıştı (yalnızca yarışla).
   */
  'payment.declined': paymentEvent.extend({
    kind: z.enum(['PAYMENT', 'REFUND']),
    approvalId: z.string().uuid(),
    outcome: z.enum(['DENIED', 'EXPIRED', 'FOLIO_CLOSED']),
  }),
  /** Hatalı ödeme girişi için iptal istendi (onaya gitti). */
  'payment.void_requested': paymentEvent.extend({ approvalId: z.string().uuid() }),
  /**
   * Ödeme iptal edildi: iptal kaydı (ters tutar) işlendi. Onaylı iptalde
   * `approvalId` dolu; sistemin geri alması (giriş geri alındı → teminat) boş.
   */
  'payment.voided': paymentEvent.extend({
    ...balanceChange,
    reversalId: z.string().uuid(),
    amount: moneyText,
    currency: z.string().length(3),
    approvalId: z.string().uuid().nullable().default(null),
  }),
  /** Ödeme iptali reddedildi ya da süresi doldu: ödeme olduğu gibi kalır. */
  'payment.void_declined': paymentEvent.extend({
    approvalId: z.string().uuid(),
    outcome: z.enum(['DENIED', 'EXPIRED', 'FOLIO_CLOSED']),
  }),
  /** Günün döviz kurları girildi / düzeltildi. */
  'exchange_rate.updated': hotelScoped.extend({
    date: isoDay,
    currencies: z.array(z.string().length(3)).min(1).max(20),
  }),
});

/** @typedef {keyof typeof EVENT_CATALOG} EventName */

/**
 * Event adının katalogda olup olmadığını söyler.
 * @param {string} name
 */
export function isKnownEvent(name) {
  return Object.hasOwn(EVENT_CATALOG, name);
}

/**
 * Gövdeyi katalogdaki şemaya göre doğrular.
 * @param {string} name
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
export function validatePayload(name, payload) {
  const schema = EVENT_CATALOG[name];
  if (!schema) {
    throw new Error(`Bilinmeyen event: "${name}". Önce shared/core/events/catalog.js içinde tanımlayın.`);
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    throw new Error(`"${name}" event gövdesi geçersiz — ${detail}`);
  }
  return result.data;
}

/** Cache invalidation gibi toplu dinlemeler için: ayar değişikliği event'leri. */
export const SETTINGS_CHANGED_EVENTS = Object.freeze(
  Object.keys(EVENT_CATALOG).filter((name) => name.startsWith('settings.')),
);

/**
 * Müsaitliği etkileyen her şey: oda eklenmesi, atanması, arıza kaydı ve
 * misafir giriş-çıkışı. Canlı güncellenen ekranlar (modül 5 oda planı, socket
 * yayını) bu listeyi dinleyerek yeniden hesaplar. Müsaitliğin kendisi
 * cache'lenmez — bkz. `hotel/backend/src/modules/rooms/service.js`.
 */
export const INVENTORY_CHANGED_EVENTS = Object.freeze([
  'inventory.room.created',
  'inventory.room.updated',
  'inventory.room.deleted',
  'room.assigned',
  'room.unassigned',
  'room.blocked',
  'room.unblocked',
  'reservation.created',
  'reservation.updated',
  'reservation.cancelled',
  'reservation.no_show',
  'reservation.reinstated',
  'guest.checked_in',
  'guest.checked_out',
  'guest.check_in_reverted',
  'guest.check_out_reverted',
]);

/**
 * Envanteri **artırabilen** değişiklikler: bekleme listesi bunlardan sonra
 * taranır (yer açıldı mı). Tarih değişikliği ve oda tipi düzenlemesi iki
 * yöne de gidebildiği için listede.
 */
export const INVENTORY_RELEASING_EVENTS = Object.freeze([
  'inventory.room.created',
  'inventory.room.updated',
  'room.unblocked',
  'reservation.updated',
  'reservation.cancelled',
  'reservation.no_show',
  'guest.checked_out',
]);

/**
 * Canlı ekranları (oda planı, oda listesi) etkileyen her şey: envanter
 * değişiklikleri + oda durumu (Boş/Dolu, Kirli/Temiz). Socket yayını ve canlı
 * ekranların okuma önbelleği bu listeyi kullanır — ikisi ayrışırsa ekran ya
 * haber alır ama eski cevabı görür ya da hiç haber almaz.
 */
export const LIVE_VIEW_EVENTS = Object.freeze([
  ...new Set([...INVENTORY_CHANGED_EVENTS, 'room.status.changed', 'reservation.confirmed']),
]);

/** Rezervasyon listesi ve detayını etkileyen event'ler (canlı yayın: `reservations.changed`). */
export const RESERVATIONS_CHANGED_EVENTS = Object.freeze([
  'reservation.created',
  'reservation.updated',
  'reservation.confirmed',
  'reservation.cancelled',
  'reservation.no_show',
  'reservation.reinstated',
  'room.assigned',
  'room.unassigned',
  'guest.checked_in',
  'guest.checked_out',
  'guest.check_in_reverted',
  'guest.check_out_reverted',
  'waitlist.changed',
]);

/** Gelen kutusunu etkileyen event'ler (canlı yayın: `messaging.changed`). */
export const MESSAGING_CHANGED_EVENTS = Object.freeze([
  'guest.message.received',
  'guest.message.reply',
  'guest.message.delivery',
  'guest.intent.detected',
  'conversation.updated',
  'conversation.read',
]);

/** İstek listesini etkileyen event'ler (canlı yayın: `requests.changed`). */
export const REQUESTS_CHANGED_EVENTS = Object.freeze(['guest.request.created', 'guest.request.updated']);

/** Bildirim geçmişini etkileyen event'ler (canlı yayın: `notifications.changed`). */
export const NOTIFICATIONS_CHANGED_EVENTS = Object.freeze([
  'notification.send.requested',
  'notification.sent',
  'notification.delivered',
  'notification.failed',
  'notification.cancelled',
  'notification.template.saved',
  'notification.channel.updated',
]);

/** Zil (canlı yayın: `staff.alerts`). */
export const STAFF_ALERT_EVENTS = Object.freeze(['staff.alert.raised']);

/** Manuel görev listesini ve rozetini etkileyen event'ler (canlı yayın: `manual-tasks.changed`). */
export const MANUAL_TASK_EVENTS = Object.freeze(['manual_task.created', 'manual_task.updated']);

/**
 * Folyo ekranlarını ve bakiyeleri etkileyen event'ler (canlı yayın:
 * `folios.changed`). `folio.room_charges.due` iç tetikleyicidir, listede yok.
 */
export const FOLIO_EVENTS = Object.freeze(
  Object.keys(EVENT_CATALOG).filter((name) => name.startsWith('folio.') && name !== 'folio.room_charges.due'),
);

/**
 * Ödeme olayları (modül 17): folyo ekranı (bakiye, ödemeler) ve kasa
 * görünümü bunlarla tazelenir (canlı yayın: `folios.changed`, `cash.changed`).
 */
export const PAYMENT_EVENTS = Object.freeze(Object.keys(EVENT_CATALOG).filter((name) => name.startsWith('payment.')));

/** Kasa görünümünü ve kur ekranını etkileyen olaylar (canlı yayın: `cash.changed`). */
export const CASH_EVENTS = Object.freeze([...PAYMENT_EVENTS, 'exchange_rate.updated']);

/** Minibar / çamaşırhane ekranlarını etkileyen olaylar (canlı yayın: `extras.changed`, modül 19). */
export const EXTRAS_EVENTS = Object.freeze(['minibar.recorded', 'laundry.order.changed', 'extras.catalog.changed']);

/** Kayıp eşya ekranlarını etkileyen olaylar (canlı yayın: `lost-items.changed`, modül 21). */
export const LOST_ITEM_EVENTS = Object.freeze(['lost_item.recorded', 'lost_item.changed', 'lost_items.settings.changed']);

/** Onay kuyruğunu etkileyen event'ler (canlı yayın: `approvals.changed`). */
export const APPROVAL_EVENTS = Object.freeze([
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'approval.expired',
]);

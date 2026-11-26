import { randomUUID } from 'node:crypto';
import { CODE_PREFIX } from './demo-config.mjs';

/**
 * Spa ve spor salonu demo verisi (modül 57; `demo-data.mjs` çağırır).
 *
 * Kayıtlar **servislerle** üretilir (yerleştirme, çakışma, bedel, vergi, folyo, kasa gerçek): ayarlar (07:00–22:00,
 * portal açık), sekiz oda / salon, dokuz terapist ve eğitmen (haftalık saatleriyle), on üç hizmet (çift masajı, hamam
 * ritüeli, PT; dört dilde ad), haftalık yoga ve pilates dersleri. Son 21 günün randevuları — tamamlanan (içerideki
 * misafirde odaya, dışarıdan gelende spa kasasında nakit / kart), ücretsiz ve geç iptal, gelmedi, sadakat indirimi —
 * ve dersleri (kayıt, katılım). Bugünün panosu (biten, süren, sıradaki), önümüzdeki günlerin randevuları (portaldan
 * gelenler, ön ödemeli), dolu ders ve yedek listesi, terapist izni ve hamam bakım bloğu, onay bekleyen kısmi iade.
 *
 * Geçmiş gün servis kuralı gereği o günün saatiyle (`now`) açılır / kapanır; kasa ve folyo kalemlerinin tarihi
 * aynı kaymayla o güne taşınır (POS demosundaki gibi). Bütün spa kayıtları otelindir: `--reset` hepsini siler.
 * Gerçek kişiye ait veri yok.
 */

const HISTORY_DAYS = 21;
const SESSION_FUTURE_DAYS = 28;
const STAFF = 'onburo@hotel.local';
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

let seed = 57_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

const SETTINGS = Object.freeze({
  openTime: '07:00',
  closeTime: '22:00',
  slotMinutes: 15,
  freeCancelHours: 6,
  lateCancelFeePct: '50',
  noShowFeePct: '100',
  portalEnabled: true,
  portalLeadMinutes: 120,
  portalMaxActive: 4,
  reminderHours: 3,
});

const ROOMS = Object.freeze([
  { key: 't1', name: 'Bakım Odası 1', kind: 'TREATMENT' },
  { key: 't2', name: 'Bakım Odası 2', kind: 'TREATMENT' },
  { key: 't3', name: 'Bakım Odası 3', kind: 'TREATMENT' },
  { key: 't4', name: 'Bakım Odası 4', kind: 'TREATMENT' },
  { key: 'cift', name: 'Çift Bakım Odası', kind: 'TREATMENT' },
  { key: 'hamam', name: 'Türk Hamamı', kind: 'HAMMAM' },
  { key: 'studyo', name: 'Yoga & Pilates Stüdyosu', kind: 'STUDIO' },
  { key: 'fitness', name: 'Fitness Salonu', kind: 'GYM' },
]);

/** Haftalık saat: [günler, başlangıç, bitiş] dilimleri (1 = pazartesi). */
const hours = (...slices) => slices.flatMap(([days, start, end]) => days.map((weekday) => ({ weekday, start, end })));
const MON_SAT = [1, 2, 3, 4, 5, 6];
const TUE_SUN = [2, 3, 4, 5, 6, 7];
const ALL = [1, 2, 3, 4, 5, 6, 7];

const THERAPISTS = Object.freeze([
  { key: 'elif', name: 'Elif Yıldız', title: 'Kıdemli masaj terapisti', gender: 'FEMALE', hours: hours([MON_SAT, '10:00', '19:00']) },
  { key: 'zeynep', name: 'Zeynep Aksoy', title: 'Masaj ve cilt bakım uzmanı', gender: 'FEMALE', hours: hours([TUE_SUN, '11:00', '20:00']) },
  { key: 'burak', name: 'Burak Şahin', title: 'Masaj terapisti', gender: 'MALE', hours: hours([MON_SAT, '12:00', '21:00']) },
  { key: 'onur', name: 'Onur Çelik', title: 'Masaj terapisti', gender: 'MALE', hours: hours([[3, 4, 5, 6, 7], '10:00', '19:00']) },
  { key: 'selin', name: 'Selin Koç', title: 'Estetisyen', gender: 'FEMALE', hours: hours([[1, 2, 3, 4, 5], '09:00', '17:00'], [[6], '10:00', '15:00']) },
  { key: 'hasan', name: 'Hasan Polat', title: 'Hamam ustası (tellak)', gender: 'MALE', hours: hours([TUE_SUN, '10:00', '19:00']) },
  { key: 'gulay', name: 'Gülay Er', title: 'Hamam ustası (natır)', gender: 'FEMALE', hours: hours([[1, 3, 4, 5, 6, 7], '10:00', '19:00']) },
  { key: 'can', name: 'Can Öztürk', title: 'Kişisel antrenör', gender: 'MALE', hours: hours([[1, 2, 3, 4, 5], '07:00', '15:00'], [[6], '09:00', '13:00']) },
  { key: 'deniz', name: 'Deniz Arslan', title: 'Yoga ve pilates eğitmeni', gender: 'FEMALE', hours: hours([MON_SAT, '07:00', '12:00'], [MON_SAT, '17:00', '20:00']) },
]);

const tr = (en, de, ru) => ({ en: { name: en[0], description: en[1] }, de: { name: de[0], description: de[1] }, ru: { name: ru[0], description: ru[1] } });

/** Hizmetler; `weight` geçmiş / gelecek randevularda seçilme sıklığı. */
const SERVICES = Object.freeze([
  {
    key: 'isvec', weight: 14, name: 'Klasik İsveç Masajı', category: 'MASSAGE', durationMinutes: 60, bufferMinutes: 15, price: '3200',
    description: 'Kas gerginliğini alan, kan dolaşımını hızlandıran klasik tam vücut masajı.',
    therapists: ['elif', 'zeynep', 'burak', 'onur'], rooms: ['t1', 't2', 't3', 't4'],
    translations: tr(['Classic Swedish Massage', 'Full-body massage that eases muscle tension and boosts circulation.'], ['Klassische Schwedische Massage', 'Ganzkörpermassage, die Verspannungen löst und die Durchblutung fördert.'], ['Классический шведский массаж', 'Массаж всего тела, снимающий мышечное напряжение.']),
  },
  {
    key: 'aroma', weight: 12, name: 'Aromaterapi Masajı', category: 'MASSAGE', durationMinutes: 60, bufferMinutes: 15, price: '3600',
    description: 'Seçtiğiniz uçucu yağlarla rahatlatıcı, hafif baskılı masaj.',
    therapists: ['elif', 'zeynep', 'burak', 'onur'], rooms: ['t1', 't2', 't3', 't4'],
    translations: tr(['Aromatherapy Massage', 'Relaxing light-pressure massage with essential oils of your choice.'], ['Aromatherapie-Massage', 'Entspannende Massage mit ätherischen Ölen Ihrer Wahl.'], ['Ароматерапевтический массаж', 'Расслабляющий массаж с эфирными маслами на ваш выбор.']),
  },
  {
    key: 'derin', weight: 6, name: 'Derin Doku Masajı', category: 'MASSAGE', durationMinutes: 90, bufferMinutes: 15, price: '4800',
    description: 'Kronik kas ağrıları için derin katmanlara odaklanan yoğun baskılı masaj.',
    therapists: ['elif', 'burak', 'onur'], rooms: ['t1', 't2', 't3', 't4'],
    translations: tr(['Deep Tissue Massage', 'Firm-pressure massage targeting deep muscle layers.'], ['Tiefengewebsmassage', 'Kräftige Massage für tiefe Muskelschichten.'], ['Глубокий массаж тканей', 'Интенсивный массаж глубоких слоёв мышц.']),
  },
  {
    key: 'tas', weight: 5, name: 'Sıcak Taş Masajı', category: 'MASSAGE', durationMinutes: 75, bufferMinutes: 15, price: '4200',
    description: 'Isıtılmış volkanik taşlarla derin rahatlama sağlayan masaj.',
    therapists: ['elif', 'zeynep'], rooms: ['t1', 't2', 't3', 't4'],
    translations: tr(['Hot Stone Massage', 'Deeply relaxing massage with heated volcanic stones.'], ['Hot-Stone-Massage', 'Tief entspannende Massage mit warmen Vulkansteinen.'], ['Массаж горячими камнями', 'Глубоко расслабляющий массаж вулканическими камнями.']),
  },
  {
    key: 'cift', weight: 4, name: 'Çift Masajı', category: 'MASSAGE', durationMinutes: 60, bufferMinutes: 15, price: '3400', therapistCount: 2, guestCount: 2,
    description: 'Aynı odada, iki terapistle eş zamanlı aromaterapi masajı (fiyat kişi başı).',
    therapists: ['elif', 'zeynep', 'burak', 'onur'], rooms: ['cift'],
    translations: tr(['Couples Massage', 'Side-by-side aromatherapy massage with two therapists (price per person).'], ['Paarmassage', 'Gleichzeitige Aromamassage mit zwei Therapeuten (Preis pro Person).'], ['Массаж для двоих', 'Одновременный массаж с двумя терапевтами (цена за человека).']),
  },
  {
    key: 'kese', weight: 8, name: 'Geleneksel Kese Köpük', category: 'HAMMAM', durationMinutes: 45, bufferMinutes: 15, price: '1900',
    description: 'Göbek taşında ısınma, kese ve köpük masajı.',
    therapists: ['hasan', 'gulay'], rooms: ['hamam'],
    translations: tr(['Traditional Scrub & Foam', 'Warm-up on the heated marble, body scrub and foam massage.'], ['Traditionelles Peeling & Schaum', 'Aufwärmen auf dem Marmor, Peeling und Schaummassage.'], ['Традиционный пилинг и пена', 'Прогрев на мраморе, пилинг и пенный массаж.']),
  },
  {
    key: 'rituel', weight: 3, name: 'Osmanlı Hamam Ritüeli', category: 'HAMMAM', durationMinutes: 90, bufferMinutes: 15, price: '3900',
    description: 'Kese köpüğe kil maskesi ve 30 dakikalık yağ masajı eşlik eder.',
    therapists: ['hasan', 'gulay'], rooms: ['hamam'],
    translations: tr(['Ottoman Hammam Ritual', 'Scrub and foam with a clay mask and a 30-minute oil massage.'], ['Osmanisches Hamam-Ritual', 'Peeling und Schaum mit Tonmaske und 30 Minuten Ölmassage.'], ['Османский ритуал хаммама', 'Пилинг и пена, глиняная маска и 30 минут массажа.']),
  },
  {
    key: 'yuz', weight: 5, name: 'Klasik Yüz Bakımı', category: 'SKINCARE', durationMinutes: 60, bufferMinutes: 15, price: '2800',
    description: 'Temizleme, peeling, maske ve nemlendirme.',
    therapists: ['selin', 'zeynep'], rooms: ['t3', 't4'],
    translations: tr(['Classic Facial', 'Cleansing, exfoliation, mask and hydration.'], ['Klassische Gesichtsbehandlung', 'Reinigung, Peeling, Maske und Feuchtigkeit.'], ['Классический уход за лицом', 'Очищение, пилинг, маска и увлажнение.']),
  },
  {
    key: 'antiaging', weight: 2, name: 'Anti-aging Yüz Bakımı', category: 'SKINCARE', durationMinutes: 75, bufferMinutes: 15, price: '4100',
    description: 'Kolajen maskesi ve yüz masajıyla sıkılaştırıcı bakım.',
    therapists: ['selin'], rooms: ['t3', 't4'],
    translations: tr(['Anti-ageing Facial', 'Firming treatment with a collagen mask and facial massage.'], ['Anti-Aging-Gesichtsbehandlung', 'Straffende Behandlung mit Kollagenmaske.'], ['Антивозрастной уход за лицом', 'Подтягивающий уход с коллагеновой маской.']),
  },
  {
    key: 'sargi', weight: 2, name: 'Vücut Peelingi ve Sargı', category: 'BODY', durationMinutes: 60, bufferMinutes: 15, price: '3000',
    description: 'Deniz tuzu peelingi ve besleyici yosun sargısı.',
    therapists: ['selin', 'zeynep'], rooms: ['t1', 't2'],
    translations: tr(['Body Scrub & Wrap', 'Sea-salt scrub followed by a nourishing seaweed wrap.'], ['Körperpeeling & Wickel', 'Meersalzpeeling und nährender Algenwickel.'], ['Пилинг и обёртывание', 'Пилинг морской солью и водорослевое обёртывание.']),
  },
  {
    key: 'pt', weight: 5, name: 'Kişisel Antrenman (PT)', category: 'FITNESS', durationMinutes: 60, bufferMinutes: 0, price: '1500',
    description: 'Hedefinize göre planlanan birebir antrenman.',
    therapists: ['can'], rooms: ['fitness'],
    translations: tr(['Personal Training (PT)', 'One-to-one session tailored to your goals.'], ['Personal Training', 'Individuelles Training nach Ihren Zielen.'], ['Персональная тренировка', 'Индивидуальное занятие под ваши цели.']),
  },
  {
    key: 'yoga', kind: 'GROUP', name: 'Sabah Yogası', category: 'WELLNESS', durationMinutes: 60, bufferMinutes: 0, price: '450', capacity: 12,
    description: 'Her seviyeye uygun hatha yoga; mat ve havlu stüdyoda.',
    therapists: ['deniz'], rooms: ['studyo'],
    translations: tr(['Morning Yoga', 'Hatha yoga for all levels; mats and towels provided.'], ['Morgen-Yoga', 'Hatha-Yoga für alle Niveaus; Matten vorhanden.'], ['Утренняя йога', 'Хатха-йога для всех уровней; коврики предоставляются.']),
  },
  {
    key: 'pilates', kind: 'GROUP', name: 'Mat Pilates', category: 'WELLNESS', durationMinutes: 50, bufferMinutes: 0, price: '500', capacity: 10,
    description: 'Merkez bölgeyi güçlendiren mat pilates dersi.',
    therapists: ['deniz'], rooms: ['studyo'],
    translations: tr(['Mat Pilates', 'Core-strengthening mat pilates class.'], ['Matten-Pilates', 'Pilates-Kurs zur Stärkung der Körpermitte.'], ['Пилатес на коврике', 'Занятие пилатесом для укрепления кора.']),
  },
]);

/** Dışarıdan gelenler (spa üyeleri, şehirden misafirler); kurgusal ad ve 0532… biçiminde numara. */
const WALK_INS = Object.freeze([
  'Aylin Demirtaş', 'Kerem Uysal', 'Nihan Erdem', 'Serkan Avcı', 'Pınar Tunç', 'Levent Karaca', 'Derya Ünal', 'Ozan Kılıç',
  'Melis Güler', 'Tolga Bayram', 'Sevgi Doğan', 'Cem Yalçın', 'İpek Sarı', 'Barış Kaplan', 'Gizem Aydın', 'Hakan Öz',
]);
const phoneOf = (index) => `+90532${String(4_100_000 + index * 7_919).padStart(7, '0')}`;

const REASONS = Object.freeze({
  free: ['Misafir programı değişti', 'Toplantısı uzadı, başka güne alacak', 'Misafir rahatsızlandı'],
  late: ['Son dakika iptal — misafir uçağa yetişecek', 'Misafir son anda vazgeçti'],
  noShow: 'Misafir randevuya gelmedi, odası ve telefonu cevap vermedi',
  discount: 'Sadakat programı üyesi — %20 indirim',
  vip: 'VIP misafir — genel müdür ikramı',
});

/**
 * Otelin bütün spa verisini siler (demo rezervasyonlarından ve misafirlerinden önce: randevu onlara kısıtlı bağlı).
 * @param {any} tx @param {string} hotelId
 */
export async function resetSpaDemo(tx, hotelId) {
  const payments = (await tx.spaPayment.findMany({ where: { hotelId }, select: { id: true } })).map((row) => row.id);
  const approvals = (await tx.approval.findMany({ where: { hotelId, entityType: 'SpaPayment', entityId: { in: payments } }, select: { id: true } })).map((row) => row.id);
  // Spa tahsilatlarının ön muhasebe kasa hareketleri: hesabın tutulan bakiyesinden düşülüp silinir (yalnız spa yeniden
  // kurulduğunda da kasa doğru kalsın; tam yeniden yüklemede ön muhasebe sıfırlaması zaten hepsini siler).
  const moves = await tx.treasuryMovement.groupBy({ by: ['treasuryAccountId'], where: { hotelId, sourceType: 'SPA_PAYMENT' }, _sum: { amount: true } });
  for (const row of moves) {
    await tx.$executeRaw`UPDATE "TreasuryAccount" SET "balance" = "balance" - ${String(row._sum.amount ?? 0)}::numeric WHERE "id" = ${row.treasuryAccountId}`;
  }
  await tx.treasuryMovement.deleteMany({ where: { hotelId, sourceType: 'SPA_PAYMENT', reversalOfId: { not: null } } });
  await tx.treasuryMovement.deleteMany({ where: { hotelId, sourceType: 'SPA_PAYMENT' } });
  // İptal kaydı asıl satıra bağlı: önce iptaller.
  await tx.spaPayment.deleteMany({ where: { hotelId, reversalOfId: { not: null } } });
  await tx.spaPayment.deleteMany({ where: { hotelId } });
  await tx.pendingAction.deleteMany({ where: { approvalId: { in: approvals } } });
  await tx.approval.deleteMany({ where: { id: { in: approvals } } });
  await tx.spaRoomCharge.deleteMany({ where: { hotelId } });
  await tx.spaHold.deleteMany({ where: { hotelId } });
  await tx.spaAppointment.deleteMany({ where: { hotelId } });
  await tx.spaSession.deleteMany({ where: { hotelId } });
  await tx.spaBlock.deleteMany({ where: { hotelId } });
  await tx.spaServiceTherapist.deleteMany({ where: { hotelId } });
  await tx.spaServiceRoom.deleteMany({ where: { hotelId } });
  await tx.spaTherapistHour.deleteMany({ where: { hotelId } });
  await tx.spaService.deleteMany({ where: { hotelId } });
  await tx.spaTherapist.deleteMany({ where: { hotelId } });
  await tx.spaRoom.deleteMany({ where: { hotelId } });
  await tx.spaSequence.deleteMany({ where: { hotelId } });
  await tx.spaSettings.deleteMany({ where: { hotelId } });
  await tx.staffAlert.deleteMany({ where: { hotelId, kind: 'SPA' } });
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string }} input
 * @returns {Promise<{ services: number, therapists: number, appointments: number, completed: number, cancelled: number, noShow: number, sessions: number, enrollments: number, portal: number, roomCharges: number, payments: number, pendingApprovals: number, skipped: number }>}
 */
export async function seedSpaDemo({ prisma, core, contracts, hotelId, today, actor }) {
  const setup = await import('../src/modules/spa/setup.js');
  const appointments = await import('../src/modules/spa/appointments.js');
  const sessions = await import('../src/modules/spa/sessions.js');
  const payments = await import('../src/modules/spa/payments.js');
  const shared = await import('../src/modules/spa/shared.js');
  const folios = await import('../src/modules/folios/service.js');
  const postings = await import('../src/modules/accounting/postings.js');
  const quiet = { error: () => {}, warn: () => {}, info: () => {} };

  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { timezone: true } });
  const zone = hotel.timezone;
  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const parse = (name, value) => contracts[name].parse(value);
  const addDays = (day, n) => core.toIsoDay(core.addDays(new Date(`${day}T00:00:00.000Z`), n));
  const wall = (day, time) => contracts.zonedWallTimeToUtc(`${day}T${time}`, zone);
  const timeOf = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const weekdayOf = (day) => ((new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
  const realNow = new Date();
  const summary = { services: 0, therapists: 0, appointments: 0, completed: 0, cancelled: 0, noShow: 0, sessions: 0, enrollments: 0, portal: 0, roomCharges: 0, payments: 0, pendingApprovals: 0, skipped: 0 };

  // ── Ayar ve tanımlar ──
  await as(actor, () => setup.saveSpaSettings(hotelId, parse('spaSettingsSchema', { expectedUpdatedAt: null, ...SETTINGS })));
  /** @type {Record<string, string>} */
  const room = {};
  for (const [index, row] of ROOMS.entries()) {
    const { key, ...input } = row;
    room[key] = (await as(actor, () => setup.createSpaRoom(hotelId, parse('spaRoomInputSchema', { ...input, sortOrder: index + 1 })))).id;
  }
  /** @type {Record<string, string>} */
  const therapist = {};
  for (const [index, row] of THERAPISTS.entries()) {
    const { key, ...input } = row;
    therapist[key] = (await as(actor, () => setup.createSpaTherapist(hotelId, parse('spaTherapistInputSchema', { ...input, phone: null, sortOrder: index + 1 })))).id;
  }
  summary.therapists = THERAPISTS.length;
  /** @type {Record<string, { id: string, key: string, weight: number, durationMinutes: number, bufferMinutes: number, therapists: string[], kind: string }>} */
  const service = {};
  for (const [index, row] of SERVICES.entries()) {
    const { key, weight = 0, therapists: who, rooms: where, kind = 'PRIVATE', ...input } = row;
    const created = await as(actor, () =>
      setup.createSpaService(hotelId, parse('spaServiceInputSchema', { ...input, kind, sortOrder: index + 1, therapistIds: who.map((name) => therapist[name]), roomIds: where.map((name) => room[name]) })),
    );
    service[key] = { id: created.id, key, weight, durationMinutes: row.durationMinutes, bufferMinutes: row.bufferMinutes, therapists: who, kind };
  }
  summary.services = SERVICES.length;
  const privateServices = Object.values(service).filter((row) => row.kind === 'PRIVATE');
  const totalWeight = privateServices.reduce((sum, row) => sum + row.weight, 0);
  const drawService = () => {
    let roll = rand() * totalWeight;
    for (const row of privateServices) {
      roll -= row.weight;
      if (roll < 0) return row;
    }
    return privateServices[0];
  };

  // ── Konaklamalar: içerideki demo misafirleri (giriş günüyle) ──
  const stays = (
    await prisma.reservation.findMany({
      where: { hotelId, status: 'CHECKED_IN', roomId: { not: null }, confirmationCode: { startsWith: CODE_PREFIX } },
      select: { id: true, checkIn: true, checkOut: true },
      orderBy: { checkIn: 'asc' },
      take: 400,
    })
  ).map((row) => ({ id: row.id, from: core.toIsoDay(core.calendarDateInTimeZone(zone, row.checkIn)), until: core.toIsoDay(core.calendarDateInTimeZone(zone, row.checkOut)) }));
  const stayOn = (day) => {
    const list = stays.filter((stay) => stay.from <= day && stay.until > day);
    return list.length ? pick(list) : null;
  };
  let walkIn = 0;
  const customerFor = (day, share) => {
    const stay = rand() < share ? stayOn(day) : null;
    if (stay) return { reservationId: stay.id };
    const index = walkIn++ % WALK_INS.length;
    return { reservationId: null, customerName: WALK_INS[index], customerPhone: phoneOf(index) };
  };

  // ── Yardımcılar: aç, tamamla, öde (geçmişte o günün saatiyle) ──
  /** Başarısız yerleştirme (saat dolu, terapist çalışmıyor) atlanır. */
  const book = async (input, { now, source = 'STAFF', who = STAFF }) => {
    try {
      const result = await as(who, () => appointments.createSpaAppointment(hotelId, parse('spaAppointmentCreateSchema', { requestId: randomUUID(), ...input }), { source, now, logger: quiet }));
      summary.appointments += 1;
      if (source === 'PORTAL') summary.portal += 1;
      return result.appointment;
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) throw error;
      summary.skipped += 1;
      return null;
    }
  };
  const fresh = async (id) => (await appointments.getSpaAppointment(hotelId, id)).appointment;
  const version = (row) => new Date(row.updatedAt);
  /** Kasada tahsilat; geçmişteyse kayıt o güne taşınır. */
  const pay = async (id, { amount, method, at, note = null }) => {
    const reference = method === 'CARD' ? `SLP${String(Math.floor(rand() * 900_000) + 100_000)}` : null;
    const result = await as(STAFF, () => payments.receiveSpaPayment(hotelId, id, parse('spaPaymentSchema', { requestId: randomUUID(), kind: 'PAYMENT', method, amount, reference, note })));
    summary.payments += 1;
    if (at < realNow) {
      const day = core.toIsoDay(core.calendarDateInTimeZone(zone, at));
      await prisma.spaPayment.update({ where: { id: result.paymentId }, data: { businessDate: new Date(`${day}T00:00:00.000Z`), receivedAt: at, postedAt: at, createdAt: at } });
    }
    return result;
  };
  const settleAtDesk = async (row, at) => {
    const appointment = await fresh(row.id);
    if (Number(appointment.balance) > 0) await pay(row.id, { amount: appointment.balance, method: rand() < 0.7 ? 'CARD' : 'CASH', at });
  };
  /** Randevuyu tamamlar; içerideki misafirin çoğu odaya yazdırır, kalanlar ve dışarıdan gelenler kasada öder. */
  const finish = async (row, at) => {
    const settle = row.reservationId && rand() < 0.78 ? 'ROOM' : 'DESK';
    await as(STAFF, () => appointments.completeSpaAppointment(hotelId, row.id, parse('spaCompleteSchema', { expectedUpdatedAt: version(row), settle }), { now: at }));
    summary.completed += 1;
    if (settle === 'DESK') await settleAtDesk(row, new Date(at.getTime() + 4 * MINUTE_MS));
  };
  const close = async (row, outcome, reason, at) => {
    await as(STAFF, () => appointments.closeSpaAppointment(hotelId, row.id, parse('spaCancelSchema', { expectedUpdatedAt: version(row), reason }), { outcome, now: at, logger: quiet }));
    if (outcome === 'NO_SHOW') summary.noShow += 1;
    else summary.cancelled += 1;
  };
  const discount = async (row, price, reason) => {
    const updated = await as('admin@hotel.local', () => appointments.priceSpaAppointment(hotelId, row.id, parse('spaAppointmentPriceSchema', { expectedUpdatedAt: version(row), price, reason })));
    return updated.appointment;
  };
  /** Gün içinde bir saat (açılış penceresinde, çeyrek saat adımlı). */
  const slotTime = (fromMinute, toMinute) => timeOf(fromMinute + Math.floor(rand() * ((toMinute - fromMinute) / 15 + 1)) * 15);

  // ── Geçmiş 21 gün + bugün: birebir randevular ──
  for (let offset = -HISTORY_DAYS; offset <= 0; offset += 1) {
    const day = addDays(today, offset);
    const weekend = [6, 7].includes(weekdayOf(day));
    const count = 11 + Math.floor(rand() * 7) + (weekend ? 5 : 0);
    for (let index = 0; index < count; index += 1) {
      const chosen = drawService();
      const time = chosen.key === 'pt' ? slotTime(7 * 60, 13 * 60) : slotTime(10 * 60, 19 * 60 + 30);
      const startsAt = wall(day, time);
      const end = new Date(startsAt.getTime() + chosen.durationMinutes * MINUTE_MS);
      // Rezervasyon: aynı gün sabah ya da bir gün önce (gelecekte değil).
      const bookedAt = new Date(Math.min(startsAt.getTime() - (2 + Math.floor(rand() * 28)) * HOUR_MS, realNow.getTime() - MINUTE_MS));
      const customer = customerFor(day, 0.65);
      const row = await book({ serviceId: chosen.id, startsAt: `${day}T${time}`, ...customer, therapistPreference: rand() < 0.15 ? pick(['FEMALE', 'MALE']) : null, note: rand() < 0.1 ? 'Boyun ve omuzlara odaklanılsın' : null }, { now: bookedAt });
      if (!row) continue;
      await prisma.spaAppointment.update({ where: { id: row.id }, data: { createdAt: bookedAt } });
      if (end > realNow) continue; // bugünün süren ve sıradaki randevuları açık kalır
      const roll = rand();
      let current = await fresh(row.id);
      if (roll < 0.04) await close(current, 'CANCELLED', pick(REASONS.free), new Date(Math.max(bookedAt.getTime() + MINUTE_MS, startsAt.getTime() - 20 * HOUR_MS)));
      else if (roll < 0.07) await close(current, 'CANCELLED', pick(REASONS.late), new Date(Math.max(bookedAt.getTime() + MINUTE_MS, startsAt.getTime() - 90 * MINUTE_MS)));
      else if (roll < 0.1) await close(current, 'NO_SHOW', REASONS.noShow, new Date(startsAt.getTime() + 25 * MINUTE_MS));
      else if (offset === 0 && roll > 0.93) continue; // saati geçmiş, henüz kapatılmamış (resepsiyon unutmuş)
      else {
        if (roll > 0.955) current = await discount(current, String(Math.round(Number(current.listPrice) * 0.8)), REASONS.discount);
        await finish(current, new Date(Math.min(end.getTime() + 5 * MINUTE_MS, realNow.getTime())));
      }
    }
  }

  // ── Grup dersleri: yoga her sabah (pzt–cmt) 08:00, pilates salı / perşembe 18:30 ve cumartesi 10:30 ──
  const historyStart = addDays(today, -HISTORY_DAYS);
  const sessionsFrom = wall(historyStart, '06:00');
  const until = addDays(today, SESSION_FUTURE_DAYS);
  const plans = [
    { key: 'yoga', time: '08:00', weekdays: MON_SAT },
    { key: 'pilates', time: '18:30', weekdays: [2, 4] },
    { key: 'pilates', time: '10:30', weekdays: [6] },
  ];
  for (const plan of plans) {
    const result = await as(actor, () =>
      sessions.createSpaSessions(hotelId, parse('spaSessionCreateSchema', { serviceId: service[plan.key].id, startsAt: `${historyStart}T${plan.time}`, repeat: { weekdays: plan.weekdays, until } }), { now: sessionsFrom }),
    );
    summary.sessions += result.created.length;
  }
  const allSessions = await prisma.spaSession.findMany({ where: { hotelId }, select: { id: true, startsAt: true, endsAt: true, capacity: true, serviceId: true }, orderBy: { startsAt: 'asc' } });
  const enroll = async (sessionId, input, { now, source = 'STAFF', who = STAFF }) => {
    try {
      const result = await as(who, () => sessions.enrollSpaSession(hotelId, sessionId, parse('spaEnrollSchema', { requestId: randomUUID(), guestCount: 1, ...input }), { source, now, logger: quiet }));
      summary.enrollments += 1;
      if (source === 'PORTAL') summary.portal += 1;
      return result;
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) throw error;
      summary.skipped += 1;
      return null;
    }
  };
  const tomorrow = addDays(today, 1);
  for (const row of allSessions) {
    const day = core.toIsoDay(core.calendarDateInTimeZone(zone, row.startsAt));
    if (day > addDays(today, 6)) continue; // ileri haftalar boş: kayıt yaklaştıkça gelir
    const past = row.endsAt < realNow;
    const fullTomorrow = day === tomorrow && row.serviceId === service.yoga.id;
    const count = fullTomorrow ? row.capacity + 2 : past ? 3 + Math.floor(rand() * 6) : 1 + Math.floor(rand() * 4);
    for (let index = 0; index < count; index += 1) {
      const at = new Date(Math.min(row.startsAt.getTime() - (1 + Math.floor(rand() * 20)) * HOUR_MS, realNow.getTime() - MINUTE_MS));
      if (at < sessionsFrom) continue;
      await enroll(row.id, { ...customerFor(day, 0.7), waitlist: index >= row.capacity }, { now: at });
    }
    if (past) {
      const fresh = await prisma.spaSession.findFirst({ where: { id: row.id }, select: { updatedAt: true } });
      await as(STAFF, () => sessions.completeSpaSession(hotelId, row.id, parse('spaSessionCompleteSchema', { expectedUpdatedAt: fresh.updatedAt }), { now: new Date(Math.min(row.endsAt.getTime() + 5 * MINUTE_MS, realNow.getTime())) }));
      // Odaya yazılamayanlar (dışarıdan gelen) çıkışta kasada öder.
      const open = await prisma.spaAppointment.findMany({ where: { hotelId, sessionId: row.id, status: 'COMPLETED', balance: { gt: 0 } }, select: { id: true } });
      for (const { id } of open) await settleAtDesk({ id }, new Date(row.endsAt.getTime() + 8 * MINUTE_MS));
    }
  }

  // ── Önümüzdeki günler: personelden ve portaldan randevular, ön ödemeli dışarıdan misafir ──
  for (let offset = 1; offset <= 10; offset += 1) {
    const day = addDays(today, offset);
    const count = Math.max(2, 12 - offset + Math.floor(rand() * 3));
    for (let index = 0; index < count; index += 1) {
      const chosen = drawService();
      const time = chosen.key === 'pt' ? slotTime(7 * 60, 13 * 60) : slotTime(10 * 60, 19 * 60 + 30);
      const stay = rand() < 0.3 ? stayOn(day) : null;
      const portal = Boolean(stay) && rand() < 0.6;
      const row = portal
        ? await book({ serviceId: chosen.id, startsAt: `${day}T${time}`, reservationId: stay.id, note: rand() < 0.3 ? 'Mümkünse kadın terapist' : null }, { now: realNow, source: 'PORTAL', who: shared.SPA_GUEST_ACTOR })
        : await book({ serviceId: chosen.id, startsAt: `${day}T${time}`, ...(stay ? { reservationId: stay.id } : customerFor(day, 0.5)) }, { now: realNow });
      if (row && !row.reservationId && offset <= 3 && rand() < 0.35) {
        // Dışarıdan gelen misafir yerini kartla ön ödemeyle tuttu.
        await pay(row.id, { amount: row.priceTotal, method: 'CARD', at: realNow, note: 'Ön ödeme (telefonla rezervasyon)' });
      }
    }
  }
  // Portaldan grup dersi kaydı.
  for (const row of allSessions.filter((item) => item.startsAt > realNow).slice(1, 4)) {
    const day = core.toIsoDay(core.calendarDateInTimeZone(zone, row.startsAt));
    const stay = stayOn(day);
    if (stay) await enroll(row.id, { reservationId: stay.id, guestCount: 2 }, { now: realNow, source: 'PORTAL', who: shared.SPA_GUEST_ACTOR });
  }

  // ── Bloklar: terapist izni, hamam bakımı ──
  const leaveDay = addDays(today, 3);
  try {
    await as(actor, () => setup.createSpaBlock(hotelId, parse('spaBlockInputSchema', { therapistId: therapist.onur, startsAt: `${leaveDay}T00:00`, endsAt: `${addDays(leaveDay, 1)}T00:00`, reason: 'Yıllık izin' })));
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) throw error;
  }
  const maintenanceDay = addDays(today, 5);
  try {
    await as(actor, () => setup.createSpaBlock(hotelId, parse('spaBlockInputSchema', { roomId: room.hamam, startsAt: `${maintenanceDay}T07:00`, endsAt: `${maintenanceDay}T10:00`, reason: 'Göbek taşı ve kurna bakımı' })));
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) throw error;
  }

  // ── Onay bekleyen iade: ön ödemeli randevu süresinde (ücretsiz) iptal edildi, ön ödeme karta iade edilecek ──
  let prepaid = await prisma.spaAppointment.findFirst({
    where: { hotelId, status: 'BOOKED', reservationId: null, sessionId: null, paidTotal: { gt: 0 }, startsAt: { gt: new Date(realNow.getTime() + (SETTINGS.freeCancelHours + 2) * HOUR_MS) } },
    orderBy: { startsAt: 'desc' },
    select: { id: true },
  });
  if (!prepaid) {
    // Rastgele günlerde ön ödemeli randevu çıkmadıysa: telefonla yer ayırtıp kartla ön ödeyen dışarıdan misafir.
    const day = addDays(today, 3);
    for (const time of ['15:00', '16:30', '11:00', '13:30']) {
      const row = await book({ serviceId: service.aroma.id, startsAt: `${day}T${time}`, ...customerFor(day, 0) }, { now: realNow });
      if (!row) continue;
      await pay(row.id, { amount: row.priceTotal, method: 'CARD', at: realNow, note: 'Ön ödeme (telefonla rezervasyon)' });
      prepaid = { id: row.id };
      break;
    }
  }
  if (prepaid) {
    const row = await fresh(prepaid.id);
    await close(row, 'CANCELLED', 'Misafir seyahatini erteledi', realNow);
    const after = await appointments.getSpaAppointment(hotelId, prepaid.id);
    if (Number(after.summary.refundable) > 0) {
      await as(STAFF, () =>
        payments.receiveSpaPayment(hotelId, prepaid.id, parse('spaPaymentSchema', { requestId: randomUUID(), kind: 'REFUND', method: 'CARD', amount: after.summary.refundable, reference: 'IADE-POS-' + String(Math.floor(rand() * 9000) + 1000), note: 'Ücretsiz iptal süresinde iptal; ön ödeme karta iade' })),
      );
      summary.pendingApprovals += 1;
    }
  }

  // ── Odaya yazılanlar folyoya (faturalama işçisinin yaptığı), kalem tarihi randevunun günü ──
  const charges = await prisma.spaRoomCharge.findMany({ where: { hotelId }, select: { id: true, eventId: true, appointment: { select: { completedAt: true, cancelledAt: true } }, businessDate: true } });
  const events = new Map((await prisma.eventLog.findMany({ where: { id: { in: charges.map((row) => row.eventId) } }, select: { id: true, payload: true } })).map((row) => [row.id, row.payload]));
  for (const charge of charges) {
    const payload = events.get(charge.eventId);
    if (!payload) continue;
    try {
      await as('billing-worker', () => folios.postExternalCharge(hotelId, payload, { source: 'SPA', eventId: charge.eventId }));
      summary.roomCharges += 1;
    } catch (error) {
      console.error(`Spa harcaması folyoya işlenemedi: ${error.message}`);
      continue;
    }
    const at = charge.appointment.completedAt ?? charge.appointment.cancelledAt ?? realNow;
    if (at < realNow) {
      await prisma.spaRoomCharge.update({ where: { id: charge.id }, data: { chargedAt: at } });
      await prisma.folioItem.updateMany({ where: { hotelId, sourceKey: { startsWith: `evt:${charge.eventId}:` } }, data: { serviceDate: charge.businessDate, postedAt: at } });
    }
  }

  // ── Spa kasasının muhasebe kayıtları (aktör betikte çalışmaz): eşitleme süre bütçeli, kalan bitene kadar ──
  const accounting = await prisma.accountingSettings.findFirst({ where: { hotelId }, select: { startDate: true } });
  if (accounting) {
    for (let round = 0; round < 20; round += 1) {
      const report = await as(actor, () => postings.syncPeriod(hotelId, { from: core.toIsoDay(accounting.startDate), to: today }));
      if (!report.remaining || report.posted === 0) break;
    }
  }
  return summary;
}

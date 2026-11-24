import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SPA_DEFAULT_SETTINGS,
  addSpaDays,
  pickSpaResources,
  spaAppointmentCreateSchema,
  spaBlockInputSchema,
  spaCancelSchema,
  spaCancellationPct,
  spaEnrollSchema,
  spaMinuteOfDay,
  spaMissingTranslations,
  spaPaymentSchema,
  spaPortalWindow,
  spaRepeatDays,
  spaServiceInputSchema,
  spaServiceText,
  spaSessionCreateSchema,
  spaSettingsSchema,
  spaSlotMinutes,
  spaTherapistCovers,
  spaTherapistInputSchema,
  spaTimeOfMinute,
  spaWeekday,
} from './spa.js';

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIN = 60_000;
/** Günün başı (epoch ms) — testlerde "dakika" ile "an" aynı eksende. */
const DAY0 = Date.parse('2026-11-16T00:00:00.000Z');
const at = (minute) => DAY0 + minute * MIN;
const busy = (from, to) => ({ start: at(from), end: at(to) });
const allWeek = (start, end) => [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: start, endMinute: end }));
const therapist = (id, extra = {}) => ({ id, gender: null, sortOrder: 0, name: id, hours: allWeek(540, 1080), busy: [], load: 0, ...extra });
const room = (id, extra = {}) => ({ id, sortOrder: 0, name: id, busy: [], ...extra });
const massage = { therapistCount: 1, requiresRoom: true, durationMinutes: 60, bufferMinutes: 15 };

describe('saat yardımcıları', () => {
  it('dakika ↔ saat metni', () => {
    assert.equal(spaMinuteOfDay('14:30'), 870);
    assert.equal(spaTimeOfMinute(870), '14:30');
    assert.equal(spaTimeOfMinute(1440), '24:00');
    assert.ok(Number.isNaN(spaMinuteOfDay('25:00')));
    assert.ok(Number.isNaN(spaMinuteOfDay('9:5')));
  });

  it('hafta günü ISO sırasıyla: pazartesi 1, pazar 7', () => {
    assert.equal(spaWeekday('2026-11-16'), 1);
    assert.equal(spaWeekday('2026-11-22'), 7);
    assert.equal(addSpaDays('2026-12-31', 1), '2027-01-01');
  });

  it('başlangıç saatleri: açılıştan itibaren adım adım, hizmet kapanıştan önce biter', () => {
    assert.deepEqual(spaSlotMinutes({ openMinute: 540, closeMinute: 660, slotMinutes: 30, durationMinutes: 60 }), [540, 570, 600]);
    // Tam sığan son saat dahil; sığmayan hizmete saat yok.
    assert.deepEqual(spaSlotMinutes({ openMinute: 540, closeMinute: 600, slotMinutes: 15, durationMinutes: 60 }), [540]);
    assert.deepEqual(spaSlotMinutes({ openMinute: 540, closeMinute: 600, slotMinutes: 15, durationMinutes: 90 }), []);
  });
});

describe('çalışma saati', () => {
  const split = [
    { weekday: 1, startMinute: 540, endMinute: 780 },
    { weekday: 1, startMinute: 840, endMinute: 1080 },
    { weekday: 2, startMinute: 540, endMinute: 780 },
    { weekday: 2, startMinute: 780, endMinute: 1080 },
  ];

  it('hizmetin tamamı dilimin içinde olmalı', () => {
    assert.equal(spaTherapistCovers(split, 1, 540, 600), true);
    assert.equal(spaTherapistCovers(split, 1, 720, 780), true);
    assert.equal(spaTherapistCovers(split, 1, 750, 810), false, 'öğle arasına taşıyor');
    assert.equal(spaTherapistCovers(split, 1, 480, 540), false, 'vardiyadan önce');
    assert.equal(spaTherapistCovers(split, 3, 600, 660), false, 'o gün çalışmıyor');
  });

  it('bitişik dilimler birleşik sayılır; arası boş dilimler sayılmaz', () => {
    assert.equal(spaTherapistCovers(split, 2, 750, 810), true);
    assert.equal(spaTherapistCovers(split, 1, 770, 850), false);
  });
});

describe('terapist ve oda seçimi', () => {
  const pick = (input) => pickSpaResources({ service: massage, weekday: 1, minute: 600, at: at(600), therapists: [], rooms: [], ...input });

  it('boş terapist ve boş oda atanır', () => {
    assert.deepEqual(pick({ therapists: [therapist('t1')], rooms: [room('r1')] }), { therapistIds: ['t1'], roomId: 'r1' });
  });

  it('temizlik arası doluluğa dahildir: 11:00 randevusu 10:00–11:00 + 15 dk arayla çakışır', () => {
    const taken = [therapist('t1', { busy: [busy(660, 735)] })];
    assert.deepEqual(pick({ therapists: taken, rooms: [room('r1')] }), { error: 'NO_THERAPIST' });
    // Bir önceki randevunun arası 10:00'da bitiyorsa 10:00 uygundur (aralık yarı açık).
    assert.deepEqual(pick({ therapists: [therapist('t1', { busy: [busy(525, 600)] })], rooms: [room('r1')] }), { therapistIds: ['t1'], roomId: 'r1' });
    // 10:00–11:00 + ara 11:15'e kadar: 11:15'te başlayan sonraki randevuyla çakışmaz.
    assert.deepEqual(pick({ therapists: [therapist('t1', { busy: [busy(675, 750)] })], rooms: [room('r1')] }), { therapistIds: ['t1'], roomId: 'r1' });
  });

  it('en az yüklü terapist seçilir; eşitlikte sıra, sonra ad', () => {
    const team = [therapist('t1', { load: 240 }), therapist('t2', { load: 60 }), therapist('t3', { load: 60, sortOrder: 5 })];
    assert.deepEqual(pick({ therapists: team, rooms: [room('r1')] }).therapistIds, ['t2']);
    const equal = [therapist('b', { name: 'Zeynep' }), therapist('a', { name: 'Ayşe' })];
    assert.deepEqual(pick({ therapists: equal, rooms: [room('r1')] }).therapistIds, ['a']);
  });

  it('cinsiyet tercihi gözetilir; uygun yoksa atanmaz', () => {
    const team = [therapist('m', { gender: 'MALE' }), therapist('f', { gender: 'FEMALE', load: 300 })];
    assert.deepEqual(pick({ therapists: team, rooms: [room('r1')], gender: 'FEMALE' }).therapistIds, ['f']);
    assert.deepEqual(pick({ therapists: [team[0]], rooms: [room('r1')], gender: 'FEMALE' }), { error: 'NO_THERAPIST' });
  });

  it('çift masajı iki terapist ister; biri eksikse randevu verilmez', () => {
    const couple = { ...massage, therapistCount: 2 };
    const team = [therapist('t1'), therapist('t2', { load: 30 }), therapist('t3', { busy: [busy(570, 700)] })];
    assert.deepEqual(pickSpaResources({ service: couple, weekday: 1, minute: 600, at: at(600), therapists: team, rooms: [room('r1')] }), { therapistIds: ['t1', 't2'], roomId: 'r1' });
    assert.deepEqual(pickSpaResources({ service: couple, weekday: 1, minute: 600, at: at(600), therapists: [team[0], team[2]], rooms: [room('r1')] }), { error: 'NO_THERAPIST' });
  });

  it('personelin seçtiği terapist: çalışmıyorsa, doluysa ya da sayı tutmuyorsa sebebiyle reddedilir', () => {
    const rooms = [room('r1')];
    assert.deepEqual(pick({ therapists: [therapist('t1', { hours: allWeek(720, 1080) })], rooms, therapistIds: ['t1'] }), { error: 'OUTSIDE_HOURS' });
    assert.deepEqual(pick({ therapists: [therapist('t1', { busy: [busy(630, 700)] })], rooms, therapistIds: ['t1'] }), { error: 'THERAPIST_BUSY' });
    assert.deepEqual(pick({ therapists: [therapist('t1')], rooms, therapistIds: ['yok'] }), { error: 'NO_THERAPIST' });
    assert.deepEqual(pick({ therapists: [therapist('t1'), therapist('t2')], rooms, therapistIds: ['t1', 't2'] }), { error: 'NO_THERAPIST' });
    // Seçilen terapist cinsiyet tercihine uymasa da personelin seçimi geçerlidir.
    assert.deepEqual(pick({ therapists: [therapist('t1', { gender: 'MALE' })], rooms, therapistIds: ['t1'], gender: 'FEMALE' }).therapistIds, ['t1']);
  });

  it('oda: sıradaki ilk boş oda; seçilen oda doluysa reddedilir; oda gerekmeyen hizmete oda atanmaz', () => {
    const rooms = [room('r2', { sortOrder: 2 }), room('r1', { sortOrder: 1, busy: [busy(590, 610)] })];
    assert.equal(pick({ therapists: [therapist('t1')], rooms }).roomId, 'r2');
    assert.deepEqual(pick({ therapists: [therapist('t1')], rooms, roomId: 'r1' }), { error: 'ROOM_BUSY' });
    assert.deepEqual(pick({ therapists: [therapist('t1')], rooms: [rooms[1]] }), { error: 'NO_ROOM' });
    const pt = { therapistCount: 1, requiresRoom: false, durationMinutes: 45, bufferMinutes: 0 };
    assert.deepEqual(pickSpaResources({ service: pt, weekday: 1, minute: 600, at: at(600), therapists: [therapist('t1')], rooms: [] }), { therapistIds: ['t1'], roomId: null });
  });

  it('terapist gerektirmeyen hizmette (kendi kendine hamam) yalnız oda tutulur', () => {
    const hammam = { therapistCount: 0, requiresRoom: true, durationMinutes: 45, bufferMinutes: 15 };
    assert.deepEqual(pickSpaResources({ service: hammam, weekday: 1, minute: 600, at: at(600), therapists: [], rooms: [room('h1')] }), { therapistIds: [], roomId: 'h1' });
  });
});

describe('iptal ve gelmedi oranı', () => {
  const settings = { freeCancelHours: 4, lateCancelFeePct: '50.00', noShowFeePct: '100.00' };
  const startsAt = Date.parse('2026-11-16T12:00:00.000Z');

  it('ücretsiz iptal süresi içinde bedel yok; sınır anı ücretsizdir', () => {
    assert.deepEqual(spaCancellationPct({ startsAt, at: startsAt - 5 * 3_600_000, outcome: 'CANCELLED', settings }), { pct: '0', late: false });
    assert.deepEqual(spaCancellationPct({ startsAt, at: startsAt - 4 * 3_600_000, outcome: 'CANCELLED', settings }), { pct: '0', late: false });
  });

  it('süre geçince geç iptal oranı; gelmedi her zaman gelmedi oranı', () => {
    assert.deepEqual(spaCancellationPct({ startsAt, at: startsAt - 4 * 3_600_000 + 1, outcome: 'CANCELLED', settings }), { pct: '50', late: true });
    assert.deepEqual(spaCancellationPct({ startsAt, at: startsAt + 60_000, outcome: 'CANCELLED', settings }), { pct: '50', late: true });
    assert.deepEqual(spaCancellationPct({ startsAt, at: startsAt + 3_600_000, outcome: 'NO_SHOW', settings }), { pct: '100', late: true });
  });

  it('süre 0 ise her iptal ücretsizdir (randevu saatine kadar)', () => {
    assert.equal(spaCancellationPct({ startsAt, at: startsAt - 1, outcome: 'CANCELLED', settings: { ...settings, freeCancelHours: 0 } }).pct, '0');
  });
});

describe('tekrar günleri ve portal penceresi', () => {
  it('seçilen hafta günlerine düşen günler, ilk gün dahil, bitişe kadar', () => {
    assert.deepEqual(spaRepeatDays({ day: '2026-11-16', weekdays: [1, 3], until: '2026-11-30' }), ['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-25', '2026-11-30']);
    // İlk gün seçilen günlerden olmasa da açılır (formda seçilen gün).
    assert.deepEqual(spaRepeatDays({ day: '2026-11-17', weekdays: [1], until: '2026-11-24' }), ['2026-11-17', '2026-11-23']);
    assert.equal(spaRepeatDays({ day: '2026-11-16', weekdays: [1, 2, 3, 4, 5, 6, 7], until: '2027-11-16', max: 10 }).length, 10);
  });

  it('portaldan randevu: konaklama günleri, bugünden önce değil; biten konaklamada kapalı', () => {
    assert.deepEqual(spaPortalWindow({ checkIn: '2026-11-20', checkOut: '2026-11-24', today: '2026-11-16' }), { from: '2026-11-20', to: '2026-11-24' });
    assert.deepEqual(spaPortalWindow({ checkIn: '2026-11-14', checkOut: '2026-11-18', today: '2026-11-16' }), { from: '2026-11-16', to: '2026-11-18' });
    assert.equal(spaPortalWindow({ checkIn: '2026-11-10', checkOut: '2026-11-15', today: '2026-11-16' }), null);
  });
});

describe('çeviri', () => {
  const service = { name: 'Aromaterapi Masajı', description: 'Sıcak yağlarla', translations: { en: { name: 'Aromatherapy Massage', description: '' }, de: { name: '  ', description: 'Mit warmen Ölen' } } };

  it('misafirin dilinde ad; çevirisi olmayan dil Türkçeye düşer (alan alan)', () => {
    assert.deepEqual(spaServiceText(service, 'en'), { name: 'Aromatherapy Massage', description: 'Sıcak yağlarla' });
    assert.deepEqual(spaServiceText(service, 'de'), { name: 'Aromaterapi Masajı', description: 'Mit warmen Ölen' });
    assert.deepEqual(spaServiceText(service, 'ru'), { name: 'Aromaterapi Masajı', description: 'Sıcak yağlarla' });
    assert.deepEqual(spaServiceText(service, 'tr'), { name: 'Aromaterapi Masajı', description: 'Sıcak yağlarla' });
  });

  it('adı çevrilmemiş diller eksik sayılır', () => {
    assert.deepEqual(spaMissingTranslations(service), ['de', 'ru']);
  });
});

describe('şemalar', () => {
  const service = { name: 'İsveç Masajı', category: 'MASSAGE', kind: 'PRIVATE', durationMinutes: 60, bufferMinutes: 15, price: '2500', therapistIds: [UUID(1)], roomIds: [UUID(2)] };

  it('hizmet: terapist ve oda seçimi hizmetin ihtiyacını karşılamalı', () => {
    assert.equal(spaServiceInputSchema.safeParse(service).success, true);
    const noTeam = spaServiceInputSchema.safeParse({ ...service, therapistCount: 2 });
    assert.equal(noTeam.success, false);
    assert.match(noTeam.error.issues[0].message, /en az 2 terapist/);
    assert.equal(spaServiceInputSchema.safeParse({ ...service, roomIds: [] }).success, false);
    assert.equal(spaServiceInputSchema.safeParse({ ...service, requiresRoom: false, roomIds: [] }).success, true);
    assert.equal(spaServiceInputSchema.safeParse({ ...service, therapistCount: 0, therapistIds: [] }).success, true);
  });

  it('hizmet: kontenjan yalnız grup dersinde ve zorunlu', () => {
    assert.equal(spaServiceInputSchema.safeParse({ ...service, capacity: 10 }).success, false);
    const group = { ...service, kind: 'GROUP', capacity: 12 };
    assert.equal(spaServiceInputSchema.safeParse(group).success, true);
    assert.equal(spaServiceInputSchema.safeParse({ ...group, capacity: null }).success, false);
    assert.equal(spaServiceInputSchema.safeParse({ ...group, guestCount: 2 }).success, false);
  });

  it('terapist: aynı günün dilimleri çakışamaz, bitiş başlangıçtan sonra olmalı', () => {
    const base = { name: 'Elif Kaya', hours: [{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 1, start: '14:00', end: '18:00' }] };
    assert.equal(spaTherapistInputSchema.safeParse(base).success, true);
    assert.equal(spaTherapistInputSchema.safeParse({ ...base, hours: [{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 1, start: '12:00', end: '18:00' }] }).success, false);
    assert.equal(spaTherapistInputSchema.safeParse({ ...base, hours: [{ weekday: 1, start: '13:00', end: '09:00' }] }).success, false);
    assert.equal(spaTherapistInputSchema.safeParse({ ...base, hours: [{ weekday: 1, start: '16:00', end: '24:00' }] }).success, true);
  });

  it('ayar: kapanış açılıştan en az bir saat sonra; oranlar %100 üstü olamaz', () => {
    const settings = { expectedUpdatedAt: null, openTime: '09:00', closeTime: '22:00', slotMinutes: 15, freeCancelHours: 4, lateCancelFeePct: '50', noShowFeePct: '100', portalEnabled: true, portalLeadMinutes: 120, portalMaxActive: 4, reminderHours: 2 };
    assert.equal(spaSettingsSchema.safeParse(settings).success, true);
    assert.equal(spaSettingsSchema.safeParse({ ...settings, closeTime: '09:30' }).success, false);
    assert.equal(spaSettingsSchema.safeParse({ ...settings, noShowFeePct: '120' }).success, false);
    assert.equal(spaSettingsSchema.safeParse({ ...settings, slotMinutes: 7 }).success, false);
    assert.equal(spaSettingsSchema.safeParse({ ...settings, closeTime: '24:00' }).success, true);
    assert.equal(SPA_DEFAULT_SETTINGS.portalEnabled, false, 'portal randevusu otel açana kadar kapalı');
  });

  it('randevu: konaklama ya da dışarıdan gelenin adı; takvimde olmayan gün reddedilir', () => {
    const base = { requestId: UUID(9), serviceId: UUID(1), startsAt: '2026-11-20T14:30' };
    assert.equal(spaAppointmentCreateSchema.safeParse({ ...base, reservationId: UUID(3) }).success, true);
    assert.equal(spaAppointmentCreateSchema.safeParse({ ...base, customerName: 'Selin Aksoy', customerPhone: '+90 532 000 00 00' }).success, true);
    assert.equal(spaAppointmentCreateSchema.safeParse(base).success, false);
    assert.equal(spaAppointmentCreateSchema.safeParse({ ...base, customerName: 'A' }).success, false);
    assert.equal(spaAppointmentCreateSchema.safeParse({ ...base, reservationId: UUID(3), startsAt: '2026-02-31T10:00' }).success, false);
    assert.equal(spaAppointmentCreateSchema.safeParse({ ...base, reservationId: UUID(3), therapistIds: [UUID(4), UUID(4)] }).success, false);
  });

  it('iptal: bedeli silmek gerekçe ister', () => {
    const base = { expectedUpdatedAt: '2026-11-16T10:00:00.000Z', reason: 'Misafir rahatsızlandı' };
    assert.equal(spaCancelSchema.safeParse(base).success, true);
    assert.equal(spaCancelSchema.safeParse({ ...base, waiveFee: true }).success, false);
    assert.equal(spaCancelSchema.safeParse({ ...base, waiveFee: true, waiveReason: 'Sağlık sorunu, müdür onayı' }).success, true);
  });

  it('ödeme: kartta slip, iadede sebep zorunlu; kart numarası yazılamaz', () => {
    const base = { requestId: UUID(8), kind: 'PAYMENT', method: 'CASH', amount: '1250,50' };
    const cash = spaPaymentSchema.safeParse(base);
    assert.equal(cash.success, true);
    assert.equal(cash.data.amount, '1250.5');
    assert.equal(spaPaymentSchema.safeParse({ ...base, method: 'CARD' }).success, false);
    assert.equal(spaPaymentSchema.safeParse({ ...base, method: 'CARD', reference: 'SLIP-00412' }).success, true);
    assert.equal(spaPaymentSchema.safeParse({ ...base, method: 'CARD', reference: '4111 1111 1111 1111' }).success, false);
    assert.equal(spaPaymentSchema.safeParse({ ...base, kind: 'REFUND' }).success, false);
    assert.equal(spaPaymentSchema.safeParse({ ...base, kind: 'REFUND', note: 'Ders iptal edildi' }).success, true);
    assert.equal(spaPaymentSchema.safeParse({ ...base, amount: '0' }).success, false);
    assert.equal(spaPaymentSchema.safeParse({ ...base, method: 'TRANSFER' }).success, false);
  });

  it('blok: tek kaynak, geçerli aralık, en fazla 60 gün', () => {
    const base = { therapistId: UUID(1), startsAt: '2026-11-20T09:00', endsAt: '2026-11-20T13:00', reason: 'Yıllık izin' };
    assert.equal(spaBlockInputSchema.safeParse(base).success, true);
    assert.equal(spaBlockInputSchema.safeParse({ ...base, roomId: UUID(2) }).success, false);
    assert.equal(spaBlockInputSchema.safeParse({ ...base, therapistId: null }).success, false);
    assert.equal(spaBlockInputSchema.safeParse({ ...base, endsAt: '2026-11-20T08:00' }).success, false);
    assert.equal(spaBlockInputSchema.safeParse({ ...base, endsAt: '2027-02-01T09:00' }).success, false);
  });

  it('seans ve kayıt: tekrar bitişi ilk dersten önce olamaz; kayıt en fazla 6 kişi', () => {
    const session = { serviceId: UUID(1), startsAt: '2026-11-20T08:00', repeat: { weekdays: [1, 3, 5], until: '2026-12-20' } };
    assert.equal(spaSessionCreateSchema.safeParse(session).success, true);
    assert.equal(spaSessionCreateSchema.safeParse({ ...session, repeat: { weekdays: [1], until: '2026-11-19' } }).success, false);
    assert.equal(spaSessionCreateSchema.safeParse({ ...session, repeat: { weekdays: [], until: '2026-12-20' } }).success, false);
    assert.equal(spaEnrollSchema.safeParse({ requestId: UUID(7), reservationId: UUID(3), guestCount: 6 }).success, true);
    assert.equal(spaEnrollSchema.safeParse({ requestId: UUID(7), reservationId: UUID(3), guestCount: 7 }).success, false);
  });
});

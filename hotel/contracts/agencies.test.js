import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_CONTRACT_DAYS,
  addStopSaleSchema,
  agencyStatusSchema,
  agencySummaryQuerySchema,
  contractRateIssues,
  createAgencySchema,
  createContractSchema,
  createReservationSchema,
  endContractSchema,
  inclusiveDays,
  paymentDueDay,
  saveContractRatesSchema,
  stopSalePeriodError,
  updateReservationSchema,
} from './index.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const VERSION = '2027-06-01T10:00:00.000Z';

const validAgency = { code: 'tui', name: 'TUI Türkiye', phone: '+90 212 555 00 00', email: 'Rezervasyon@TUI.example.com', commissionPct: '12.5', paymentTermDays: 30 };

describe('acente kartı şeması', () => {
  it('kodu büyük harfe çevirir, e-postayı küçültür, boş alanları null yapar', () => {
    const parsed = createAgencySchema.parse({ ...validAgency, contactName: '  ', notes: '' });
    assert.equal(parsed.code, 'TUI');
    assert.equal(parsed.email, 'rezervasyon@tui.example.com');
    assert.equal(parsed.contactName, null);
    assert.equal(parsed.notes, null);
    assert.equal(parsed.commissionPct, '12.5');
  });

  it('komisyon ve vade verilmezse sıfır', () => {
    const parsed = createAgencySchema.parse({ code: 'AB', name: 'Küçük Acente' });
    assert.equal(parsed.commissionPct, '0');
    assert.equal(parsed.paymentTermDays, 0);
  });

  it('geçersiz kod, ad, komisyon, vade ve e-postayı alan alan reddeder', () => {
    const fail = (patch) => createAgencySchema.safeParse({ ...validAgency, ...patch });
    assert.equal(fail({ code: 'A' }).success, false, 'çok kısa kod');
    assert.equal(fail({ code: 'tüi' }).success, false, 'Türkçe karakter');
    assert.equal(fail({ code: 'A'.repeat(21) }).success, false, 'çok uzun kod');
    assert.equal(fail({ name: 'A' }).success, false);
    assert.equal(fail({ commissionPct: '100.01' }).success, false);
    assert.equal(fail({ commissionPct: '-1' }).success, false);
    assert.equal(fail({ commissionPct: '10.123' }).success, false, 'üç ondalık');
    assert.equal(fail({ paymentTermDays: 366 }).success, false);
    assert.equal(fail({ paymentTermDays: -1 }).success, false);
    assert.equal(fail({ paymentTermDays: 1.5 }).success, false);
    assert.equal(fail({ email: 'yanlis' }).success, false);
    assert.equal(fail({ taxNumber: '12' }).success, false, 'çok kısa vergi no');
    assert.equal(fail({ commissionPct: '100' }).success, true, 'sınır dahil');
    assert.equal(fail({ commissionPct: '0' }).success, true);
  });

  it('durum yalnızca aktif / pasif', () => {
    assert.equal(agencyStatusSchema.safeParse({ expectedUpdatedAt: VERSION, status: 'PASSIVE' }).success, true);
    assert.equal(agencyStatusSchema.safeParse({ expectedUpdatedAt: VERSION, status: 'DELETED' }).success, false);
  });
});

describe('kontrat dönemi', () => {
  it('iki uç dahil gün sayısı; bitiş başlangıçtan önce ya da çok uzun dönem reddedilir', () => {
    assert.equal(inclusiveDays('2027-06-01', '2027-06-01'), 1);
    assert.equal(inclusiveDays('2027-06-01', '2027-09-30'), 122);
    assert.equal(createContractSchema.safeParse({ name: 'Yaz 2027', startDate: '2027-06-01', endDate: '2027-09-30' }).success, true);
    assert.equal(createContractSchema.safeParse({ name: 'Yaz 2027', startDate: '2027-06-01', endDate: '2027-06-01' }).success, true, 'tek günlük kontrat');
    assert.equal(createContractSchema.safeParse({ name: 'Yaz 2027', startDate: '2027-06-02', endDate: '2027-06-01' }).success, false);
    const tooLong = new Date(Date.parse('2027-01-01') + MAX_CONTRACT_DAYS * 86_400_000).toISOString().slice(0, 10);
    assert.equal(createContractSchema.safeParse({ name: 'Çok uzun', startDate: '2027-01-01', endDate: tooLong }).success, false);
    assert.equal(createContractSchema.safeParse({ name: 'X', startDate: '2027-01-01', endDate: '2027-02-01' }).success, false, 'kısa ad');
  });

  it('sonlandırma sebebi en az 5 karakter', () => {
    assert.equal(endContractSchema.safeParse({ expectedUpdatedAt: VERSION, reason: 'iptal' }).success, true);
    assert.equal(endContractSchema.safeParse({ expectedUpdatedAt: VERSION, reason: 'yok' }).success, false);
    assert.equal(endContractSchema.safeParse({ expectedUpdatedAt: VERSION, reason: '     ' }).success, false);
  });

  it('vade günü ve cari özeti dönemi', () => {
    assert.equal(paymentDueDay('2027-06-10T09:00:00.000Z', 30), '2027-07-10');
    assert.equal(paymentDueDay('2027-12-20', 15), '2028-01-04', 'yıl sonu');
    assert.equal(paymentDueDay('2027-06-10', 0), '2027-06-10');
    assert.equal(agencySummaryQuerySchema.safeParse({ from: '2027-01-01', to: '2027-12-31' }).success, true);
    assert.equal(agencySummaryQuerySchema.safeParse({ from: '2027-02-01', to: '2027-01-01' }).success, false);
    assert.equal(agencySummaryQuerySchema.safeParse({ from: '2020-01-01', to: '2027-01-01' }).success, false, 'dönem çok uzun');
    assert.equal(agencySummaryQuerySchema.safeParse({}).success, true, 'varsayılan dönemi sunucu belirler');
  });
});

describe('kontrat fiyat satırları', () => {
  const rate = (overrides) => ({ roomTypeId: UUID_A, boardType: 'BB', startDate: '2027-06-01', endDate: '2027-06-30', ...overrides });
  const period = { startDate: '2027-06-01', endDate: '2027-09-30' };

  it('çakışma: aynı tip + pansiyonda ortak gün; bitişik dönem, başka pansiyon ve başka tip çakışmaz', () => {
    assert.deepEqual(contractRateIssues([rate({}), rate({ startDate: '2027-07-01', endDate: '2027-07-31' })], period), [], 'bitişik');
    assert.deepEqual(contractRateIssues([rate({}), rate({ boardType: 'AI' })], period), [], 'başka pansiyon');
    assert.deepEqual(contractRateIssues([rate({}), rate({ roomTypeId: UUID_B })], period), [], 'başka tip');
    const overlap = contractRateIssues([rate({}), rate({ startDate: '2027-06-30', endDate: '2027-07-15' })], period);
    assert.equal(overlap.length, 1);
    assert.equal(overlap[0].index, 1, 'sonraki satır işaretlenir');
    assert.match(overlap[0].message, /01\.06\.2027 – 30\.06\.2027 dönemiyle çakışıyor/);
  });

  it('sıra bağımsız ve iç içe dönemler yakalanır; çoklu çakışma satır başına bir kez', () => {
    const issues = contractRateIssues(
      [
        rate({ startDate: '2027-08-01', endDate: '2027-08-31' }),
        rate({ startDate: '2027-06-01', endDate: '2027-09-30' }),
        rate({ startDate: '2027-07-10', endDate: '2027-07-12' }),
      ],
      period,
    );
    assert.deepEqual(issues.map((issue) => issue.index), [0, 2], 'geniş dönem yüzünden iki satır çakışıyor');
  });

  it('kontrat döneminin dışına taşan satır ve ters aralık', () => {
    const outside = contractRateIssues([rate({ startDate: '2027-05-31' }), rate({ endDate: '2027-10-01', startDate: '2027-09-01' })], period);
    assert.deepEqual(outside.map((issue) => [issue.index, issue.field]), [[0, 'startDate'], [1, 'endDate']]);
    assert.match(outside[0].message, /kontrat başlangıcından \(01\.06\.2027\) önce/);
    const reversed = contractRateIssues([rate({ startDate: '2027-07-10', endDate: '2027-07-01' })], period);
    assert.deepEqual(reversed, [{ index: 0, field: 'endDate', message: 'Bitiş tarihi başlangıçtan önce olamaz' }]);
    // Dönem verilmezse (şema aşaması) yalnızca satırların kendi içi denetlenir.
    assert.deepEqual(contractRateIssues([rate({ startDate: '2020-01-01' })]), []);
  });

  it('şema: virgüllü fiyat kabul, sıfır ve çok yüksek fiyat ret, çakışma yolu satır numarasıyla', () => {
    const ok = saveContractRatesSchema.parse({ expectedUpdatedAt: VERSION, rates: [{ ...rate({}), price: '1250,50' }] });
    assert.equal(Number(ok.rates[0].price), 1250.5);
    const bad = (price) => saveContractRatesSchema.safeParse({ expectedUpdatedAt: VERSION, rates: [{ ...rate({}), price }] });
    assert.equal(bad('0').success, false);
    assert.equal(bad('0,00').success, false);
    assert.equal(bad('abc').success, false);
    assert.equal(bad('1.250').success, false, 'binlik ayırıcı belirsiz');
    assert.equal(bad('999999999').success, false, 'yazım hatası üst sınırı');
    const overlapping = saveContractRatesSchema.safeParse({
      expectedUpdatedAt: VERSION,
      rates: [{ ...rate({}), price: '100' }, { ...rate({ startDate: '2027-06-15', endDate: '2027-07-15' }), price: '110' }],
    });
    assert.equal(overlapping.success, false);
    assert.deepEqual(overlapping.error.issues[0].path, ['rates', 1, 'startDate']);
    assert.equal(saveContractRatesSchema.safeParse({ expectedUpdatedAt: VERSION, rates: [] }).success, true, 'boş tablo (taslak temizleme)');
  });
});

describe('stop-sale', () => {
  const period = { startDate: '2027-06-01', endDate: '2027-09-30' };

  it('kontrat dönemi içinde olmalı; uçlar dahil', () => {
    assert.equal(stopSalePeriodError({ startDate: '2027-06-01', endDate: '2027-06-01' }, period), null);
    assert.equal(stopSalePeriodError({ startDate: '2027-09-30', endDate: '2027-09-30' }, period), null);
    assert.match(stopSalePeriodError({ startDate: '2027-05-31', endDate: '2027-06-02' }, period), /kontrat dönemi içinde/);
    assert.match(stopSalePeriodError({ startDate: '2027-09-29', endDate: '2027-10-01' }, period), /kontrat dönemi içinde/);
    assert.match(stopSalePeriodError({ startDate: '2027-07-02', endDate: '2027-07-01' }, period), /Bitiş tarihi/);
  });

  it('şema: oda tipi boş olabilir (tüm tipler), sebep sınırlı', () => {
    assert.equal(addStopSaleSchema.safeParse({ startDate: '2027-07-01', endDate: '2027-07-05' }).success, true);
    assert.equal(addStopSaleSchema.safeParse({ roomTypeId: UUID_A, startDate: '2027-07-01', endDate: '2027-07-05', reason: 'Bakım' }).success, true);
    assert.equal(addStopSaleSchema.safeParse({ startDate: '2027-07-05', endDate: '2027-07-01' }).success, false);
    assert.equal(addStopSaleSchema.safeParse({ startDate: '2027-07-01', endDate: '2027-07-05', reason: 'x'.repeat(201) }).success, false);
    assert.equal(addStopSaleSchema.safeParse({ roomTypeId: 'tip', startDate: '2027-07-01', endDate: '2027-07-05' }).success, false);
  });
});

describe('rezervasyon formunda acente', () => {
  const base = {
    guestId: UUID_A,
    roomTypeId: UUID_B,
    adults: 2,
    boardType: 'BB',
    checkIn: '2027-07-01',
    checkOut: '2027-07-04',
    requestId: '33333333-3333-4333-8333-333333333333',
  };

  it('kaynak "Acente" ise acente zorunlu; acente verilirse kaynak serbest (sunucu Acente yapar)', () => {
    const missing = createReservationSchema.safeParse({ ...base, source: 'AGENCY' });
    assert.equal(missing.success, false);
    assert.deepEqual(missing.error.issues[0].path, ['agencyId']);
    assert.equal(createReservationSchema.safeParse({ ...base, source: 'AGENCY', agencyId: UUID_A }).success, true);
    assert.equal(createReservationSchema.safeParse({ ...base, source: 'UI', agencyId: UUID_A }).success, true);
    assert.equal(createReservationSchema.safeParse({ ...base, source: 'UI' }).success, true, 'acentesiz eski akış');
    assert.equal(createReservationSchema.safeParse({ ...base, agencyId: 'acente' }).success, false);
  });

  it('düzenlemede acente: verilmezse değişmez, null kaldırır, geçersiz kimlik reddedilir', () => {
    const parsed = (patch) => updateReservationSchema.safeParse({ expectedUpdatedAt: VERSION, ...patch });
    assert.equal(parsed({}).data.agencyId, undefined);
    assert.equal(parsed({ agencyId: null }).data.agencyId, null);
    assert.equal(parsed({ agencyId: UUID_A }).data.agencyId, UUID_A);
    assert.equal(parsed({ agencyId: 'x' }).success, false);
  });
});

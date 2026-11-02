import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Fatura ve e-belge uçlarının büyük veride süresi (modül 16 / 49; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-invoicing.mjs
 *
 * Ölçüm otelinde (perf-folios verisi: ~203.000 konaklama folyosu) 2.500 kişilik otelin üç yıllık faturası kurulur
 * (yoksa; varsa tekrar kurmaz):
 * - Vergiler (KDV %10 + konaklama vergisi %2 dahil oda, KDV %20 dahil diğer) ve fatura ayarı (test ortamı).
 * - 150.000 kapanmış folyo (konaklamaların ikinci penceresi, üç yıla yayılmış), her biri iki gecelik kalemle.
 * - 120.000 kesilmiş fatura (e-Arşiv / e-Fatura, satırı ve zaman çizelgesiyle): çoğu GİB'de tamamlanmış;
 *   2.000'i entegratörde, 500'ü sırada (UBL belgesiyle), 100'ü gönderilemedi, 50'si reddedildi, 1.000'i iptal.
 * - 3.000 taslak; kalan kapanmış folyolar faturalanacaklarda.
 *
 * Ölçülen: fatura listesi (ilk sayfa, numara / alıcı / vergi no araması, GİB durumu süzgeci, ay, derin sayfa),
 * ayrıntı, faturalanacaklar (30 gün, 1 yıl, süresi geçenler, etkinlik), uçtan uca kesim (taslak + alıcı + kesim:
 * mükellef sorgusu, numara, UBL, kuyruk), gönderici turu (400 belge sırada; ilk 200 bağlantıları açar, ikinci 200 ölçülür), durum sorgusu turu (200),
 * PDF; sonunda sorgu planları.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ACTOR = 'perf-invoicing';
const CLOSED_FOLIOS = 150_000;
const ISSUED = 120_000;
const DRAFTS = 3_000;
const QUEUED = 500;
const SENT = 2_000;
const FAILED = 100;
const REJECTED = 50;
const CANCELLED = 1_000;
const ROUNDS = 5;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const invoices = await import('../src/modules/invoicing/invoices.js');
const settingsService = await import('../src/modules/invoicing/settings.js');
const dispatcher = await import('../src/modules/invoicing/dispatcher.js');
const { renderInvoicePdf } = await import('../src/modules/invoicing/pdf.js');
const { buildUblInvoice } = await import('../src/modules/invoicing/ubl.js');

const hotelId = (await prisma.$queryRaw`SELECT "hotelId" FROM "Folio" GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)[0].hotelId;
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);
const exec = (sql) => prisma.$executeRaw(sql);

/* ─────────────── Kurulum ─────────────── */

const ready = (await prisma.invoice.count({ where: { hotelId, createdBy: ACTOR } })) >= ISSUED;
if (!ready) {
  console.log('Ölçüm verisi kuruluyor…');
  const begin = performance.now();
  const taxOf = async (name, rate, appliesTo) =>
    (await prisma.tax.findFirst({ where: { hotelId, name } })) ?? prisma.tax.create({ data: { hotelId, name, rate, isIncluded: true, appliesTo } });
  const kdv10 = await taxOf('KDV %10', '10', ['ROOM', 'FNB']);
  const kv = await taxOf('Konaklama vergisi', '2', ['ROOM']);
  const kdv20 = await taxOf('KDV %20', '20', ['MINIBAR', 'LAUNDRY', 'SPA', 'OTHER']);
  const current = await settingsService.getInvoiceSettings(hotelId);
  await as(() =>
    settingsService.saveInvoiceSettings(
      hotelId,
      contracts.invoiceSettingsSchema.parse({
        expectedUpdatedAt: current.settings?.updatedAt ?? null,
        legalName: 'Ölçüm Oteli Turizm A.Ş.',
        taxNumber: '9876543217',
        taxOffice: 'Çankaya',
        street: 'Atatürk Bulvarı 1',
        district: 'Çankaya',
        city: 'Ankara',
        eFaturaPrefix: 'PFT',
        eArsivPrefix: 'PAR',
        provider: 'TEST',
        environment: 'TEST',
        startDate: core.toIsoDay(core.addDays(new Date(), -1100)),
        autoDraft: false,
        taxCodes: [
          { taxId: kdv10.id, code: '0015' },
          { taxId: kv.id, code: '0059' },
          { taxId: kdv20.id, code: '0015' },
        ],
      }),
    ),
  );

  // Kapanmış folyolar: mevcut konaklamaların ikinci penceresi, kapanışı son üç yıla yayılmış.
  await exec(Prisma.sql`
    INSERT INTO "Folio" ("id", "hotelId", "reservationId", "guestId", "window", "status", "chargesTotal", "paymentsTotal", "balance", "currency", "openedBy", "closedAt", "closedBy", "updatedAt")
    SELECT gen_random_uuid()::text, f."hotelId", f."reservationId", f."guestId", 2, 'CLOSED', 2240, 2240, 0, 'TRY', ${ACTOR},
           now() - (random() * interval '1095 days'), ${ACTOR}, now()
    FROM (SELECT DISTINCT ON ("reservationId") "hotelId", "reservationId", "guestId" FROM "Folio" WHERE "hotelId" = ${hotelId} AND "window" = 1 LIMIT ${CLOSED_FOLIOS}) f
    ON CONFLICT ("reservationId", "window") DO NOTHING`);
  const lines = JSON.stringify([
    { taxId: kdv10.id, name: 'KDV %10', rate: '10', included: true, amount: '100.00' },
    { taxId: kv.id, name: 'Konaklama vergisi', rate: '2', included: true, amount: '20.00' },
  ]);
  for (const night of [2, 1]) {
    await exec(Prisma.sql`
      INSERT INTO "FolioItem" ("id", "hotelId", "folioId", "reservationId", "type", "source", "description", "amount", "quantity", "taxCategory", "netAmount", "taxAmount", "total", "taxLines", "serviceDate", "sourceKey", "postedBy", "updatedAt")
      SELECT gen_random_uuid()::text, f."hotelId", f."id", f."reservationId", 'ROOM', 'ROOM_NIGHT', 'Oda ücreti', 1120, 1, 'ROOM', 1000, 120, 1120, ${lines}::jsonb,
             (f."closedAt" - ${night}::int * interval '1 day')::date, ${`${ACTOR}:`} || f."id" || ':' || ${night}, ${ACTOR}, now()
      FROM "Folio" f WHERE f."hotelId" = ${hotelId} AND f."openedBy" = ${ACTOR}
        AND NOT EXISTS (SELECT 1 FROM "FolioItem" i WHERE i."folioId" = f."id" AND i."sourceKey" = ${`${ACTOR}:`} || f."id" || ':' || ${night})`);
  }

  // Kesilmiş faturalar: en eski 120.000 kapanmış folyo. Seri yıla göre, sıra kapanış sırasıyla; %15'i e-Fatura.
  const taxes = JSON.stringify([
    { code: '0015', name: 'KDV', rate: '10', base: '2000.00', amount: '200.00', exemptionCode: null, exemptionReason: null },
    { code: '0059', name: 'Konaklama vergisi', rate: '2', base: '2000.00', amount: '40.00', exemptionCode: null, exemptionReason: null },
  ]);
  const surnames = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan'];
  const names = ['Ayşe', 'Mehmet', 'Fatma', 'Ahmet', 'Zeynep', 'Mustafa', 'Elif', 'Emre', 'Hans', 'Anna'];
  await exec(Prisma.sql`
    WITH picked AS (
      SELECT f."id", f."hotelId", f."guestId", f."closedAt", row_number() OVER (ORDER BY f."closedAt", f."id") AS "n"
      FROM "Folio" f WHERE f."hotelId" = ${hotelId} AND f."openedBy" = ${ACTOR}
        AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."folioId" = f."id")
      ORDER BY f."closedAt", f."id" LIMIT ${ISSUED}
    ), typed AS (
      SELECT p.*, CASE WHEN p."n" % 7 = 0 THEN 'E_FATURA' ELSE 'E_ARSIV' END AS "doc",
             (${names}::text[])[1 + (p."n" % 10)::int] AS "first", (${surnames}::text[])[1 + ((p."n" / 10) % 10)::int] AS "last"
      FROM picked p
    ), numbered AS (
      SELECT t.*, row_number() OVER (PARTITION BY t."doc", date_part('year', t."closedAt") ORDER BY t."closedAt", t."id") AS "seq" FROM typed t
    )
    INSERT INTO "Invoice" ("id", "hotelId", "source", "status", "uuid", "number", "documentType", "folioId", "guestId", "currency", "issueDate", "issuedAt", "issuedBy",
      "serviceFrom", "serviceTo", "buyerType", "buyerName", "buyerTaxNumber", "buyer", "grossTotal", "discountTotal", "netTotal", "taxTotal", "total", "taxes",
      "edocState", "edocProvider", "edocEnvironment", "edocAttempts", "edocSentAt", "edocCompletedAt", "edocChecks", "edocStatusCode", "createdBy", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, n."hotelId", 'FOLIO', 'ISSUED', gen_random_uuid()::text,
           CASE WHEN n."doc" = 'E_FATURA' THEN 'PFT' ELSE 'PAR' END || date_part('year', n."closedAt")::int || lpad(n."seq"::text, 9, '0'),
           n."doc"::"InvoiceDocumentType", n."id", n."guestId", 'TRY', n."closedAt"::date, n."closedAt" + interval '20 minutes', ${ACTOR},
           (n."closedAt" - interval '2 days')::date, (n."closedAt" - interval '1 day')::date,
           CASE WHEN n."doc" = 'E_FATURA' THEN 'COMPANY' ELSE 'PERSON' END::"InvoiceBuyerType",
           CASE WHEN n."doc" = 'E_FATURA' THEN n."last" || ' Turizm Ltd. Şti.' ELSE n."first" || ' ' || n."last" END,
           CASE WHEN n."doc" = 'E_FATURA' THEN lpad((1000000000 + n."n")::text, 10, '0') ELSE '10000000146' END,
           jsonb_build_object('type', CASE WHEN n."doc" = 'E_FATURA' THEN 'COMPANY' ELSE 'PERSON' END, 'firstName', n."first", 'lastName', n."last", 'district', 'Çankaya', 'city', 'Ankara', 'country', 'Türkiye'),
           2000, 0, 2000, 240, 2240, ${taxes}::jsonb,
           'DELIVERED', 'TEST', 'TEST', 1, n."closedAt" + interval '21 minutes', n."closedAt" + interval '25 minutes', 2, 'T-DELIVERED', ${ACTOR}, n."closedAt", now()
    FROM numbered n`);
  await exec(Prisma.sql`
    INSERT INTO "InvoiceSequence" ("hotelId", "prefix", "year", "last")
    SELECT ${hotelId}, substr("number", 1, 3), substr("number", 4, 4)::int, max(substr("number", 8)::int) FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "createdBy" = ${ACTOR} GROUP BY 2, 3
    ON CONFLICT ("hotelId", "prefix", "year") DO UPDATE SET "last" = GREATEST("InvoiceSequence"."last", EXCLUDED."last")`);
  await exec(Prisma.sql`
    INSERT INTO "InvoiceLine" ("id", "hotelId", "invoiceId", "sortOrder", "description", "quantity", "unitCode", "unitPrice", "grossAmount", "discountAmount", "netAmount", "taxAmount", "total", "taxes", "serviceFrom", "serviceTo")
    SELECT gen_random_uuid()::text, i."hotelId", i."id", 0, 'Konaklama', 1, 'C62', 2000, 2000, 0, 2000, 240, 2240, i."taxes", i."serviceFrom", i."serviceTo"
    FROM "Invoice" i WHERE i."hotelId" = ${hotelId} AND i."createdBy" = ${ACTOR} AND NOT EXISTS (SELECT 1 FROM "InvoiceLine" l WHERE l."invoiceId" = i."id")`);
  await exec(Prisma.sql`
    INSERT INTO "InvoiceLog" ("id", "hotelId", "invoiceId", "kind", "state", "message", "actor", "createdAt")
    SELECT gen_random_uuid()::text, i."hotelId", i."id", k."kind", k."state"::"EDocumentState", NULL, ${ACTOR}, i."issuedAt" + k."offset"
    FROM "Invoice" i CROSS JOIN (VALUES ('ISSUED', NULL, interval '0'), ('SENT', 'SENT', interval '1 minute'), ('DELIVERED', 'DELIVERED', interval '5 minutes')) AS k("kind", "state", "offset")
    WHERE i."hotelId" = ${hotelId} AND i."createdBy" = ${ACTOR}`);

  // Durum dağılımı: en yeniler entegratörde / sırada / hatalı; bir kısmı iptal.
  const newest = (limit, offset) => Prisma.sql`SELECT "id" FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "createdBy" = ${ACTOR} ORDER BY "issuedAt" DESC, "id" LIMIT ${limit} OFFSET ${offset}`;
  await exec(Prisma.sql`UPDATE "Invoice" SET "edocState" = 'SENT', "edocCompletedAt" = NULL, "edocCheckedAt" = NULL, "edocChecks" = 0, "edocStatusCode" = 'T-ACCEPTED' WHERE "id" IN (${newest(SENT, QUEUED)})`);
  await exec(Prisma.sql`UPDATE "Invoice" SET "edocState" = 'FAILED', "edocCompletedAt" = NULL, "edocStatusCode" = 'T-UNAVAILABLE', "edocMessage" = 'Entegratöre ulaşılamadı' WHERE "id" IN (${newest(FAILED, QUEUED + SENT)})`);
  await exec(Prisma.sql`UPDATE "Invoice" SET "edocState" = 'REJECTED', "edocCompletedAt" = NULL, "edocStatusCode" = 'T-SCHEMA', "edocMessage" = 'GİB reddetti' WHERE "id" IN (${newest(REJECTED, QUEUED + SENT + FAILED)})`);
  await exec(Prisma.sql`
    UPDATE "Invoice" SET "status" = 'CANCELLED', "edocState" = 'CANCELLED', "cancelledAt" = "issuedAt" + interval '1 day', "cancelledBy" = ${ACTOR}, "cancelMethod" = 'INTEGRATOR', "cancelReason" = 'Ölçüm'
    WHERE "id" IN (SELECT "id" FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "createdBy" = ${ACTOR} AND "documentType" = 'E_ARSIV' ORDER BY "issuedAt" LIMIT ${CANCELLED})`);
  // Sıradakiler gerçek boyda UBL belgesiyle (gönderici turu entegratöre verir): belge bir kez kurulur, numara ve
  // ETTN satır başına yerleştirilir; e-Fatura alıcısının posta kutusu etiketi vardır.
  const settingsRow = await prisma.invoiceSettings.findUnique({ where: { hotelId } });
  const lineData = [{ description: 'Konaklama', quantity: '1', unitCode: 'C62', unitPrice: '2000.00', gross: '2000.00', discount: '0.00', net: '2000.00', taxAmount: '240.00', total: '2240.00', taxes: JSON.parse(taxes) }];
  const template = buildUblInvoice({
    number: 'NUMARA', uuid: 'ETTN', documentType: 'E_ARSIV', issueDate: core.toIsoDay(new Date()), issueTime: '10:00:00', currency: 'TRY',
    seller: settingsRow, buyer: { type: 'PERSON', firstName: 'Ayşe', lastName: 'Yılmaz', taxNumber: '10000000146', district: 'Çankaya', city: 'Ankara', country: 'Türkiye' },
    lines: lineData, totals: contracts.invoiceTotals(lineData),
  });
  await exec(Prisma.sql`
    INSERT INTO "InvoiceDocument" ("invoiceId", "hotelId", "xml", "sha256")
    SELECT i."id", i."hotelId", replace(replace(${template}, 'NUMARA', i."number"), 'ETTN', i."uuid"), md5(i."id") FROM "Invoice" i WHERE i."id" IN (${newest(QUEUED, 0)})
    ON CONFLICT ("invoiceId") DO NOTHING`);
  await exec(Prisma.sql`
    UPDATE "Invoice" SET "edocState" = 'QUEUED', "edocCompletedAt" = NULL, "edocSentAt" = NULL, "edocAttempts" = 0, "edocNextAttemptAt" = now(),
           "receiverAlias" = CASE WHEN "documentType" = 'E_FATURA' THEN 'urn:mail:defaultpk@olcum' END
    WHERE "id" IN (${newest(QUEUED, 0)})`);

  // Taslaklar: faturası olmayan en yeni kapanmış folyolar.
  await exec(Prisma.sql`
    INSERT INTO "Invoice" ("id", "hotelId", "source", "status", "uuid", "folioId", "guestId", "currency", "serviceFrom", "serviceTo", "buyerType", "buyerName", "buyerTaxNumber", "buyer",
      "grossTotal", "discountTotal", "netTotal", "taxTotal", "total", "taxes", "createdBy", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, f."hotelId", 'FOLIO', 'DRAFT', gen_random_uuid()::text, f."id", f."guestId", 'TRY', (f."closedAt" - interval '2 days')::date, (f."closedAt" - interval '1 day')::date,
           'PERSON', 'Taslak Misafir', '10000000146', '{"type":"PERSON","firstName":"Taslak","lastName":"Misafir","taxNumber":"10000000146"}'::jsonb,
           2000, 0, 2000, 240, 2240, ${taxes}::jsonb, ${ACTOR}, f."closedAt", now()
    FROM "Folio" f WHERE f."hotelId" = ${hotelId} AND f."openedBy" = ${ACTOR} AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."folioId" = f."id")
    ORDER BY f."closedAt" DESC LIMIT ${DRAFTS}`);
  await exec(Prisma.sql`ANALYZE "Invoice"`);
  await exec(Prisma.sql`ANALYZE "InvoiceLine"`);
  await exec(Prisma.sql`ANALYZE "Folio"`);
  await exec(Prisma.sql`ANALYZE "FolioItem"`);
  console.log(`Kuruldu (${((performance.now() - begin) / 1000).toFixed(1)} sn)`);
}
// Faturalama başlangıcı üç yıl önce (önceki kurulumda yoksa migration ayarın gününü yazmıştır): kuyruk ölçümü bütün
// pencereyi tarar.
await exec(Prisma.sql`UPDATE "InvoiceSettings" SET "startDate" = CURRENT_DATE - 1100 WHERE "hotelId" = ${hotelId}`);
// Turlar her çalıştırmada aynı yükle (zamanlar UTC duvar saati): belgesi olan 400 fatura sırada, 400 fatura entegratörde.
await exec(Prisma.sql`
  UPDATE "Invoice" SET "edocState" = 'QUEUED', "edocNextAttemptAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute', "edocAttempts" = 0, "edocLockedAt" = NULL, "edocCompletedAt" = NULL
  WHERE "id" IN (SELECT d."invoiceId" FROM "InvoiceDocument" d JOIN "Invoice" i ON i."id" = d."invoiceId" WHERE i."hotelId" = ${hotelId} AND i."createdBy" = ${ACTOR} AND i."status" = 'ISSUED' LIMIT ${QUEUED - 100})`);
await exec(Prisma.sql`
  UPDATE "Invoice" SET "edocState" = 'SENT', "edocSentAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes', "edocCheckedAt" = NULL, "edocChecks" = 0, "edocCompletedAt" = NULL
  WHERE "id" IN (SELECT "id" FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "createdBy" = ${ACTOR} AND "status" = 'ISSUED' AND "edocState" = 'DELIVERED' ORDER BY "issuedAt" DESC LIMIT 400)`);

/* ─────────────── Ölçüm ─────────────── */

/** @type {Array<{ name: string, best: number, median: number, worst: number }>} */
const results = [];
async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let last;
  for (let round = 0; round < rounds; round += 1) {
    const begin = performance.now();
    last = await fn(round);
    times.push(performance.now() - begin);
  }
  const sorted = (rounds > 1 ? times.slice(1) : times).sort((a, b) => a - b);
  results.push({ name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) });
  return last;
}
const parse = (schema, input) => contracts[schema].parse(input);

const sample = await prisma.invoice.findFirst({ where: { hotelId, createdBy: ACTOR, status: 'ISSUED' }, orderBy: { issuedAt: 'desc' }, select: { id: true, number: true } });
const list = await measure('fatura listesi (ilk sayfa)', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', {})));
await measure('arama: numara başı', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', { search: sample.number.slice(0, 9) })));
await measure('arama: alıcı adı', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', { search: 'Turizm' })));
await measure('arama: vergi no başı', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', { search: '10000012' })));
await measure('GİB durumu: gönderilemedi', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', { edocState: 'FAILED' })));
await measure('bir ay', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', { from: core.toIsoDay(core.addDays(new Date(), -60)), to: core.toIsoDay(core.addDays(new Date(), -30)) })));
await measure('derin sayfa 500', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', { page: 500, pageSize: 25 })));
await measure('taslaklar', () => invoices.listInvoices(hotelId, parse('invoiceListQuerySchema', { status: 'DRAFT' })));
await measure('fatura ayrıntısı', () => invoices.getInvoice(hotelId, sample.id));
const invoiceable = await measure('faturalanacaklar (30 gün)', () => invoices.listInvoiceables(hotelId, parse('invoiceableQuerySchema', { kind: 'FOLIO', days: 30 })));
await measure('faturalanacaklar (1 yıl)', () => invoices.listInvoiceables(hotelId, parse('invoiceableQuerySchema', { kind: 'FOLIO', days: 366 })));
await measure('faturalanacaklar (süresi geçenler, 1 yıl)', () => invoices.listInvoiceables(hotelId, parse('invoiceableQuerySchema', { kind: 'FOLIO', days: 366, overdueOnly: true })));
await measure('faturalanacaklar (1 yıl, arama)', () => invoices.listInvoiceables(hotelId, parse('invoiceableQuerySchema', { kind: 'FOLIO', days: 366, search: 'ka' })));
await measure('faturalanacaklar (etkinlik)', () => invoices.listInvoiceables(hotelId, parse('invoiceableQuerySchema', { kind: 'EVENT', days: 366 })));

// Uçtan uca kesim: faturası olmayan kapanmış folyodan taslak → alıcı → kesim.
const free = await prisma.$queryRaw`
  SELECT f."id" FROM "Folio" f WHERE f."hotelId" = ${hotelId} AND f."openedBy" = ${ACTOR} AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."folioId" = f."id")
  ORDER BY f."closedAt" DESC LIMIT ${ROUNDS * 3}`;
let freeIndex = 0;
const buyer = { type: 'PERSON', firstName: 'Ölçüm', lastName: 'Misafir', taxNumber: '10000000146', district: 'Çankaya', city: 'Ankara', country: 'Türkiye' };
await measure('taslak aç (folyo)', async () => as(() => invoices.createDraft(hotelId, { source: 'FOLIO', folioId: free[freeIndex++].id })));
const drafts = await prisma.invoice.findMany({ where: { hotelId, createdBy: ACTOR, status: 'DRAFT', folioId: { in: free.map((row) => row.id) } }, select: { id: true, updatedAt: true } });
let draftIndex = 0;
await measure('alıcıyı düzenle', async () => {
  const draft = drafts[draftIndex++];
  return as(() => invoices.updateDraft(hotelId, draft.id, parse('invoiceDraftUpdateSchema', { expectedUpdatedAt: draft.updatedAt.toISOString(), buyer })));
}, drafts.length);
const editable = await prisma.invoice.findMany({ where: { id: { in: drafts.map((row) => row.id) } }, select: { id: true, updatedAt: true } });
let issueIndex = 0;
const issuedOne = await measure('kes (mükellef sorgusu + numara + UBL + kuyruk)', async () => {
  const draft = editable[issueIndex++];
  const result = await as(() => invoices.issueInvoice(hotelId, draft.id, { expectedUpdatedAt: draft.updatedAt.toISOString() }));
  dispatcher.stopEdocDispatcher();
  return result;
}, editable.length);
await measure('PDF (karekodlu)', () => renderInvoicePdf(hotelId, issuedOne.invoice.id));

// Turlar ikişer kez: ilki havuzun bağlantılarını açar (yerel Docker'da yeni bağlantı ~2 sn), ikincisi ölçülür.
const sent = await measure('gönderici turu (test entegratörü)', () => dispatcher.dispatchDueEdocs(), 2);
const settled = await measure('durum sorgusu turu (200 belge)', (round) => dispatcher.pollEdocStatuses(undefined, new Date(Date.now() + 120_000 + round * 60_000)), 2);

/* ─────────────── Planlar ─────────────── */

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap|Sort Method/.test(text));
};
await capture('fatura listesi', Prisma.sql`SELECT "id" FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "status" <> 'DRAFT' ORDER BY "issueDate" DESC, "issuedAt" DESC, "id" DESC LIMIT 25`);
await capture('alıcı adı araması', Prisma.sql`SELECT "id" FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "status" <> 'DRAFT' AND "buyerName" ILIKE '%Turizm%' ORDER BY "issueDate" DESC LIMIT 25`);
await capture('kuyruk üstlenme', Prisma.sql`SELECT "id" FROM "Invoice" WHERE "edocState" = 'QUEUED' AND "status" = 'ISSUED' AND "edocNextAttemptAt" <= now() ORDER BY "edocNextAttemptAt" LIMIT 20`);
await capture('durum sorgusu', Prisma.sql`SELECT "id" FROM "Invoice" WHERE "edocState" = 'SENT' ORDER BY "edocCheckedAt" NULLS FIRST, "id" LIMIT 200`);

const pad = (text, width) => String(text).padEnd(width);
const counts = await prisma.$queryRaw`
  SELECT (SELECT count(*) FROM "Invoice" WHERE "hotelId" = ${hotelId})::int AS "invoices", (SELECT count(*) FROM "InvoiceLine" WHERE "hotelId" = ${hotelId})::int AS "lines",
         (SELECT count(*) FROM "InvoiceLog" WHERE "hotelId" = ${hotelId})::int AS "logs", (SELECT count(*) FROM "Folio" WHERE "hotelId" = ${hotelId} AND "status" = 'CLOSED')::int AS "closedFolios"`;
console.log(`\nÖlçüm verisi: ${JSON.stringify(counts[0])}; liste ${list.meta.total}, faturalanacak (30 gün) ${invoiceable.meta.total}; gönderilen ${sent}, sonucu kesinleşen ${settled}`);
console.log(`\n${pad('ölçüm', 52)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) console.log(`${pad(row.name, 52)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
for (const [name, lines] of Object.entries(plans)) {
  console.log(`\nPlan — ${name}:`);
  for (const line of lines) console.log(`  ${line}`);
}
await prisma.$disconnect();
process.exit(0);

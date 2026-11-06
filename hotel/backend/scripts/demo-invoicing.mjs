import { createHash, randomUUID } from 'node:crypto';

/**
 * Demo fatura ve e-belge (modül 16 çekirdeği + 49; `demo-data.mjs` çağırır). Test ortamında (GİB'e hiçbir şey
 * gitmez): satıcı bilgileri ve seriler, faturalama başlangıcı (iki hafta önce; öncesi önceki sistemde), vergi kodu
 * eşlemesi, test mükellef listesi (cari şirketlerin bir kısmı e-Fatura kullanıcısı, biri "posta kutusu yok");
 * başlangıçtan beri kapanan folyoların faturası kapanış gününde kesilmiş ve GİB'de tamamlanmış, son günlerinkiler
 * taslakta, iki folyo yasal süresi geçmiş halde faturalanacaklarda; bir etkinlik ve bir serbest fatura; bir
 * e-Fatura reddi, birkaç sonucu bekleyen e-belge, onay kuyruğunda bir iptal isteği.
 */

/** Faturalama başlangıcı bugünden bu kadar gün önce. */
const START_DAYS = 14;
/** Son bu kadar günde kapanan folyolar taslakta (yasal süre içinde, kesilmeyi bekliyor). */
const RECENT_DAYS = 3;
/** En eski bu kadar folyo bilerek faturalanmamış (yasal süre geçti). */
const OVERDUE_LEFT = 2;
/** En yeni bu kadar fatura bugün kesilip gönderim sırasında kalır. */
const QUEUED_LEFT = 3;
/** Biriken fatura, folyonun kapanışından bu kadar sonra kesilmiş sayılır. */
const ISSUE_AFTER_CLOSE_MS = 20 * 60_000;
/** Folyo aktörünün taslağı, kapanıştan bu kadar sonra açılmış sayılır. */
const DRAFT_AFTER_CLOSE_MS = 5_000;

/** Yurt dışındaki acenteler: ünvandaki ülkeye göre yabancı şirket alıcı (GİB kimliği 2222222222, kendi vergi no notta). */
const FOREIGN_PARTNERS = Object.freeze([
  { match: '(İsveç)', street: 'Kungsgatan 44', district: 'Norrmalm', city: 'Stockholm', country: 'İsveç', foreignTaxId: 'SE556123456701', taxOffice: 'Skatteverket' },
  { match: '(Almanya)', street: 'Hohenzollernring 12', district: 'Innenstadt', city: 'Köln', country: 'Almanya', foreignTaxId: 'DE298765431', taxOffice: 'Finanzamt Köln-Mitte' },
  { match: '(Polonya)', street: 'ul. Marszałkowska 87', district: 'Śródmieście', city: 'Varşova', country: 'Polonya', foreignTaxId: 'PL5260012345', taxOffice: null },
]);

/**
 * Biriken faturaları kapanış gününe taşır (betikte saat ilerletilemez; kesim "bugün" yapılır, sonra geri alınır):
 * fatura günü ve saati, taslak, zaman çizelgesi ve e-belge zamanları aynı farkla kayar, UBL'deki gün ve saat
 * yeniden yazılır (özet yeniden hesaplanır). Yıl dönümünü aşan fatura taşınmaz (numaradaki yıl kesim yılıdır).
 * @param {any} prisma @param {any} core @param {Map<string, Date>} closedOf @param {{ today: string, timezone: string }} at
 */
async function backdateIssued(prisma, core, closedOf, { today, timezone }) {
  const { clockTime } = await import('../src/modules/invoicing/shared.js');
  for (const [invoiceId, closedAt] of closedOf) {
    const row = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { issuedAt: true } });
    const issuedAt = new Date(closedAt.getTime() + ISSUE_AFTER_CLOSE_MS);
    const issueDate = core.toIsoDay(core.calendarDateInTimeZone(timezone, issuedAt));
    if (!row?.issuedAt || issueDate >= today || issueDate.slice(0, 4) !== today.slice(0, 4)) continue;
    const shiftMs = row.issuedAt.getTime() - issuedAt.getTime();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Invoice" SET "issueDate" = ${issueDate}::date,
          "issuedAt" = "issuedAt" - ${shiftMs}::double precision * interval '1 millisecond',
          "createdAt" = "createdAt" - ${shiftMs}::double precision * interval '1 millisecond',
          "edocSentAt" = "edocSentAt" - ${shiftMs}::double precision * interval '1 millisecond',
          "edocCompletedAt" = "edocCompletedAt" - ${shiftMs}::double precision * interval '1 millisecond',
          "edocCheckedAt" = "edocCheckedAt" - ${shiftMs}::double precision * interval '1 millisecond'
        WHERE "id" = ${invoiceId}`;
      await tx.$executeRaw`UPDATE "InvoiceLog" SET "createdAt" = "createdAt" - ${shiftMs}::double precision * interval '1 millisecond' WHERE "invoiceId" = ${invoiceId}`;
      const document = await tx.invoiceDocument.findUnique({ where: { invoiceId }, select: { xml: true } });
      if (!document) return;
      const xml = document.xml
        .replace(/<cbc:IssueDate>[^<]*<\/cbc:IssueDate>/, `<cbc:IssueDate>${issueDate}</cbc:IssueDate>`)
        .replace(/<cbc:IssueTime>[^<]*<\/cbc:IssueTime>/, `<cbc:IssueTime>${clockTime(issuedAt, timezone)}</cbc:IssueTime>`);
      await tx.invoiceDocument.update({ where: { invoiceId }, data: { xml, sha256: createHash('sha256').update(xml).digest('hex') } });
    });
  }
}

const SELLER = Object.freeze({
  legalName: 'Demo Otel Turizm ve Ticaret A.Ş.',
  taxNumber: '9876543217',
  taxOffice: 'Çankaya',
  mersisNo: '0987654321700015',
  tradeRegistryNo: '412345',
  street: 'Atatürk Bulvarı No: 120',
  district: 'Çankaya',
  city: 'Ankara',
  postalCode: '06680',
  country: 'Türkiye',
  phone: '+90 312 000 00 00',
  email: 'muhasebe@demo-otel.test',
  website: 'https://demo-otel.test',
});

/** Türk alıcıların adresi (sırayla). */
const TR_ADDRESSES = Object.freeze([
  { street: 'Tunalı Hilmi Cad. No: 41', district: 'Çankaya', city: 'Ankara' },
  { street: 'Bağdat Cad. No: 210', district: 'Kadıköy', city: 'İstanbul' },
  { street: 'Kıbrıs Şehitleri Cad. No: 12', district: 'Konak', city: 'İzmir' },
  { street: 'FSM Bulvarı No: 88', district: 'Nilüfer', city: 'Bursa' },
  { street: 'Işıklar Cad. No: 7', district: 'Muratpaşa', city: 'Antalya' },
]);
/** Vergi dairesinin ili (şirket alıcının adresi o ilden seçilir). */
const TAX_OFFICE_CITY = Object.freeze({
  Kavaklıdere: 'Ankara', Çankaya: 'Ankara', Ostim: 'Ankara', Maltepe: 'Ankara', Ulus: 'Ankara',
  Beşiktaş: 'İstanbul', Karşıyaka: 'İzmir', Konak: 'İzmir', Muratpaşa: 'Antalya', 'Antalya Kurumlar': 'Antalya',
});
/** Kaydedilen kaçıncı şirketin (0'dan) e-Fatura posta kutusu sorunlu (reddi göstermek için). */
const MAILBOX_PROBLEM_AT = 2;

/** Yabancı alıcının şehri uyruğa göre. */
const FOREIGN_ADDRESSES = Object.freeze({
  DE: { district: 'Mitte', city: 'Berlin', country: 'Almanya' },
  GB: { district: 'Westminster', city: 'Londra', country: 'Birleşik Krallık' },
  NL: { district: 'Centrum', city: 'Amsterdam', country: 'Hollanda' },
  FR: { district: '8e arrondissement', city: 'Paris', country: 'Fransa' },
  RU: { district: 'Tverskoy', city: 'Moskova', country: 'Rusya' },
  US: { district: 'Manhattan', city: 'New York', country: 'ABD' },
});

/** Geçerli denetim haneli demo TC kimlik no (sıradan türetilir). @param {number} seed */
function demoTckn(seed) {
  const digits = [...String(100_000_000 + ((seed * 7_654_321) % 899_999_999)).slice(0, 9)].map(Number);
  if (digits[0] === 0) digits[0] = 1;
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  digits.push((((odd * 7 - even) % 10) + 10) % 10);
  digits.push(digits.reduce((sum, digit) => sum + digit, 0) % 10);
  return digits.join('');
}

/** Geçerli denetim haneli demo vergi no. @param {number} seed */
function demoVkn(seed) {
  const digits = [...String(100_000_000 + ((seed * 3_141_593) % 899_999_999)).slice(0, 9)].map(Number);
  let total = 0;
  for (let index = 0; index < 9; index += 1) {
    const shifted = (digits[index] + 10 - (index + 1)) % 10;
    total += shifted === 9 ? 9 : (shifted * 2 ** (10 - (index + 1))) % 9;
  }
  return [...digits, (10 - (total % 10)) % 10].join('');
}

/**
 * Demo otelinin bütün fatura kayıtları. Folyo / etkinlik / cari / misafir silinmeden ÖNCE çağrılır (fatura onlara
 * kısıtlı bağlı).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 */
export async function resetInvoicingDemo(tx, hotelId) {
  const run = (sql) => tx.$executeRawUnsafe(sql, hotelId);
  const cancelApprovals = `SELECT "id" FROM "Approval" WHERE "hotelId" = $1 AND "entityType" = 'Invoice'`;
  await run(`DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND ("kind" = 'INVOICE' OR ("entityType" = 'Approval' AND "entityId" IN (${cancelApprovals})))`);
  await run(`DELETE FROM "PendingAction" WHERE "approvalId" IN (${cancelApprovals})`);
  await run(`DELETE FROM "Approval" WHERE "id" IN (${cancelApprovals})`);
  await run(`UPDATE "LedgerEntry" SET "invoiceNumber" = NULL WHERE "hotelId" = $1 AND "invoiceNumber" IS NOT NULL`);
  await run(`DELETE FROM "Invoice" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "InvoiceSequence" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "InvoiceTaxCode" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "TestTaxpayer" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "TaxpayerLookup" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "InvoiceSettings" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "ManualTask" WHERE "hotelId" = $1 AND "title" LIKE 'Fatura %'`);
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string }} input
 */
export async function seedInvoicingDemo({ prisma, core, contracts, hotelId, actor }) {
  const settings = await import('../src/modules/invoicing/settings.js');
  const invoices = await import('../src/modules/invoicing/invoices.js');
  const dispatcher = await import('../src/modules/invoicing/dispatcher.js');
  const { calendarToday } = await import('../src/modules/invoicing/shared.js');
  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const summary = { issued: 0, eFatura: 0, eArsiv: 0, drafts: 0, skipped: 0, cancelPending: 0 };
  const { timezone } = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { timezone: true } });
  const today = calendarToday(timezone);
  // Faturalama başlangıcı iki hafta önce: öncesinde kapananlar önceki sistemde faturalanmış sayılır.
  const startDate = core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), -START_DAYS));

  // Ayar: satıcı, seriler, test ortamı; otelin vergileri adlarından GİB koduna.
  const current = await settings.getInvoiceSettings(hotelId);
  const taxCodes = current.taxes.filter((tax) => tax.suggested).map((tax) => ({ taxId: tax.id, code: tax.suggested }));
  await as(() =>
    settings.saveInvoiceSettings(
      hotelId,
      contracts.invoiceSettingsSchema.parse({
        expectedUpdatedAt: current.settings?.updatedAt ?? null,
        ...SELLER,
        eFaturaPrefix: 'DMF',
        eArsivPrefix: 'DMA',
        provider: 'TEST',
        environment: 'TEST',
        startDate,
        autoDraft: true,
        footerNote: 'Konaklama vergisi 7194 sayılı Kanun gereği faturada ayrıca gösterilmiştir.',
        bankInfo: 'Ziraat Bankası Kızılay · TR75 0001 0000 0123 4567 8901 23',
        taxCodes,
      }),
    ),
  );

  // Test mükellefleri: faturası kesilen ilk üç şirket e-Fatura kullanıcısı (ikisi kabul eder, birinin posta kutusu
  // yok — reddi göstermek için); diğer şirketler kayıtlı değil (e-Arşiv).
  const corporate = await prisma.ledgerAccount.findMany({ where: { hotelId, type: { in: ['COMPANY', 'AGENCY'] }, isActive: true }, select: { id: true, name: true, taxNumber: true, taxOffice: true }, orderBy: { code: 'asc' } });
  /** @type {Map<string, string>} vergi no → davranış */
  const registered = new Map();
  async function register(buyer) {
    if (registered.has(buyer.taxNumber)) return;
    const behavior = registered.size === MAILBOX_PROBLEM_AT ? 'NO_MAILBOX' : 'ACCEPT';
    registered.set(buyer.taxNumber, behavior);
    const latin = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
    const slug = buyer.name.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (char) => latin[char]).replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'firma';
    await as(() => settings.createTestTaxpayer(hotelId, contracts.testTaxpayerSchema.parse({ taxNumber: buyer.taxNumber, title: buyer.name, alias: `urn:mail:defaultpk@${slug}.com.tr`, behavior })));
  }

  /**
   * Taslağın alıcısını tamamla — resepsiyonun masada aldığı bilgi: adres, eksikse kimlik (geçerli denetim haneli
   * TCKN / VKN, pasaport no), şirkette vergi dairesi.
   */
  let addressTurn = 0;
  let idTurn = 0;
  async function complete(invoiceId) {
    const detail = await invoices.getInvoice(hotelId, invoiceId);
    const buyer = { ...detail.invoice.buyer };
    idTurn += 1;
    if (buyer.type === 'PERSON' && !contracts.isValidTckn(buyer.taxNumber ?? '')) buyer.taxNumber = demoTckn(idTurn);
    // Yurt dışındaki acente: resepsiyon alıcı türünü "Yabancı şirket" yapar (sonraki faturalarda hatırlanır).
    const abroad = contracts.isCompanyBuyer(buyer) && FOREIGN_PARTNERS.find((partner) => String(buyer.name ?? '').includes(partner.match));
    if (abroad) Object.assign(buyer, { type: 'FOREIGN_COMPANY', taxNumber: null, taxOffice: abroad.taxOffice, foreignTaxId: abroad.foreignTaxId, street: abroad.street, district: abroad.district, city: abroad.city, country: abroad.country });
    // Şirketin vergi no'su ünvandan türetilir: aynı şirketin bütün faturalarında aynı.
    if (buyer.type === 'COMPANY' && !contracts.isValidTaxId(buyer.taxNumber ?? '')) buyer.taxNumber = demoVkn([...String(buyer.name)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 1_000_003, 7));
    if (buyer.type === 'FOREIGN') {
      buyer.nationality ||= 'DE';
      buyer.passportNo ||= `P${String(1_000_000 + idTurn * 7919).slice(-7)}`;
    }
    if (buyer.type === 'FOREIGN') Object.assign(buyer, FOREIGN_ADDRESSES[buyer.nationality] ?? { district: 'Merkez', city: 'Viyana', country: 'Avusturya' });
    else if (!buyer.district) {
      const local = contracts.isCompanyBuyer(buyer) && TR_ADDRESSES.find((address) => address.city === TAX_OFFICE_CITY[buyer.taxOffice ?? '']);
      Object.assign(buyer, local || TR_ADDRESSES[addressTurn++ % TR_ADDRESSES.length], { country: buyer.country || 'Türkiye' });
    } else buyer.country ||= 'Türkiye';
    if (buyer.type === 'COMPANY' && !buyer.taxOffice) buyer.taxOffice = 'Çankaya';
    if (buyer.type === 'COMPANY') await register(buyer);
    await as(() => invoices.updateDraft(hotelId, invoiceId, contracts.invoiceDraftUpdateSchema.parse({ expectedUpdatedAt: detail.invoice.updatedAt, buyer, note: detail.invoice.note })));
  }
  async function issue(invoiceId) {
    try {
      await complete(invoiceId);
      const fresh = await invoices.getInvoice(hotelId, invoiceId);
      const issued = await as(() => invoices.issueInvoice(hotelId, invoiceId, { expectedUpdatedAt: fresh.invoice.updatedAt }));
      dispatcher.stopEdocDispatcher();
      summary.issued += 1;
      if (issued.invoice.documentType === 'E_FATURA') summary.eFatura += 1;
      else summary.eArsiv += 1;
      return issued;
    } catch (error) {
      summary.skipped += 1;
      console.error(`Fatura kesilemedi (${invoiceId}): ${error.message}`);
      return null;
    }
  }

  // Başlangıçtan beri kapanan folyolar (eskiden yeniye). Son üç günden eskilerin faturası kesilmiş (kesim günü
  // sonra kapanış gününe alınır; eskiden yeniye kesildiği için numara sırası tarih sırasıyla aynı); en eski ikisi
  // bilerek faturalanmamış (yasal süre geçti, taslakta bekliyor), en yeni üçü bugün kesilip sırada kalır; son üç
  // günün folyoları otomatik taslakta, yarısının alıcısı tamamlanmış.
  const startsAt = contracts.zonedWallTimeToUtc(`${startDate}T00:00`, timezone);
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const closed = await prisma.folio.findMany({
    where: { hotelId, status: 'CLOSED', chargesTotal: { gt: 0 }, closedAt: { gte: startsAt } },
    orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, closedAt: true },
  });
  const older = closed.filter((folio) => folio.closedAt < recentFrom);
  const recent = closed.filter((folio) => folio.closedAt >= recentFrom);
  const overdue = older.slice(0, OVERDUE_LEFT);
  const issuedToday = older.slice(Math.max(OVERDUE_LEFT, older.length - QUEUED_LEFT));
  const backlog = older.slice(OVERDUE_LEFT, Math.max(OVERDUE_LEFT, older.length - QUEUED_LEFT));
  const issuedIds = [];
  /** @type {Map<string, Date>} fatura → kaynağın kapanışı */
  const closedOf = new Map();
  for (const folio of backlog) {
    const draft = await as(() => invoices.createDraft(hotelId, { source: 'FOLIO', folioId: folio.id }));
    const issued = await issue(draft.invoiceId);
    if (!issued) continue;
    issuedIds.push(issued.invoice.id);
    closedOf.set(issued.invoice.id, folio.closedAt);
  }
  // Folyo aktörünün açtığı taslaklar (kapanışta): gecikmiş ikisi ve son günlerinkiler.
  for (const [index, folio] of [...overdue, ...recent.reverse()].entries()) {
    const draft = await as(() => invoices.createFolioInvoiceDraft(hotelId, folio.id));
    if (!draft.invoiceId) continue;
    // Taslak kapanışta açılmıştır: taslağın ve "taslak açıldı" satırının zamanı kapanışa alınır.
    const openedAt = new Date(folio.closedAt.getTime() + DRAFT_AFTER_CLOSE_MS);
    await prisma.invoice.update({ where: { id: draft.invoiceId }, data: { createdAt: openedAt } });
    await prisma.invoiceLog.updateMany({ where: { invoiceId: draft.invoiceId, kind: 'CREATED' }, data: { createdAt: openedAt } });
    if (index >= overdue.length && index % 2 === 0) await complete(draft.invoiceId);
    summary.drafts += 1;
  }

  // Etkinlik: gerçekleşmiş ilk etkinliğin faturası.
  const event = await prisma.event.findFirst({ where: { hotelId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, select: { id: true } });
  if (event) {
    try {
      const draft = await as(() => invoices.createDraft(hotelId, { source: 'EVENT', eventId: event.id }));
      const issued = await issue(draft.invoiceId);
      if (issued) issuedIds.push(issued.invoice.id);
    } catch (error) {
      console.error(`Etkinlik faturası açılamadı: ${error.message}`);
    }
  }

  // Serbest fatura: şirket carisine toplantı salonu kirası.
  const company = corporate.find((account) => account.taxNumber?.length === 10 && contracts.isValidVkn(account.taxNumber)) ?? corporate[0];
  if (company) {
    const draft = await as(() =>
      invoices.createDraft(
        hotelId,
        contracts.invoiceDraftCreateSchema.parse({
          source: 'MANUAL',
          ledgerAccountId: company.id,
          lines: [
            { description: 'Toplantı salonu kirası (yarım gün)', quantity: '2', unitCode: 'DAY', unitAmount: '6000', taxCategory: 'OTHER' },
            { description: 'Teknik ekipman (projeksiyon, ses)', quantity: '1', unitCode: 'C62', unitAmount: '2400', taxCategory: 'OTHER' },
          ],
          note: 'Sözleşme no: TS-2026-118',
        }),
      ),
    );
    await issue(draft.invoiceId);
  }

  // Gönderim ve GİB sonucu (test ortamı): ilk sorgu "işleniyor", ikincisi sonuç.
  await dispatcher.dispatchDueEdocs();
  await dispatcher.pollEdocStatuses(undefined, new Date(Date.now() + 60_000));
  await dispatcher.pollEdocStatuses(undefined, new Date(Date.now() + 180_000));

  await backdateIssued(prisma, core, closedOf, { today, timezone });

  // Birkaç fatura bugün kesilmiş, sırada (GİB sonucu bekleniyor).
  for (const folio of issuedToday) {
    const draft = await as(() => invoices.createDraft(hotelId, { source: 'FOLIO', folioId: folio.id }));
    await issue(draft.invoiceId);
  }

  // Ön muhasebe bağı (betikte muhasebe aktörü çalışmaz; aktörün yaptığını açıkça): numara cari harekete, serbest
  // fatura cariye alacak. İdempotent.
  const postings = await import('../src/modules/accounting/postings.js');
  for (const row of await prisma.invoice.findMany({ where: { hotelId, status: { not: 'DRAFT' } }, select: { id: true } })) {
    await as(() => postings.syncInvoice(hotelId, row.id)).catch((error) => console.error(`Fatura cariye bağlanamadı (${row.id}): ${error.message}`));
  }

  // Onay kuyruğunda bir iptal isteği (e-Arşiv, misafir şirket adına istedi).
  const cancelTarget = await prisma.invoice.findFirst({ where: { hotelId, id: { in: issuedIds }, documentType: 'E_ARSIV', edocState: 'DELIVERED', source: 'FOLIO' }, orderBy: { issuedAt: 'desc' }, select: { id: true } });
  if (cancelTarget) {
    await core.runWithContext({ correlationId: randomUUID(), actor }, () => invoices.requestCancel(hotelId, cancelTarget.id, { reason: 'Misafir faturayı şirketi adına istedi; şirket faturası kesilecek' }));
    summary.cancelPending += 1;
  }
  dispatcher.stopEdocDispatcher();
  return summary;
}

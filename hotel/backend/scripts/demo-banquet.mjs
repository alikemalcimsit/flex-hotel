import { randomUUID } from 'node:crypto';

/**
 * Banket / etkinlik demo verisi (modül 37): `demo-data.mjs` çağırır.
 *
 * Kayıtlar **servislerle** üretilir (kurallar, tutmalar, toplamlar, belgeler gerçek):
 * salonlar (bölünebilir balo salonu, teras, iki toplantı odası, pasif havuz başı),
 * stoklu ekipman, kurumsal / bireysel müşteriler, banket politikası ve her durumda
 * etkinlik — gerçekleşmiş (proformalı, biri borçlu), iptal (bedel + onay bekleyen
 * iade), iki günlük kongre, kesin düğün, sıralı opsiyonlar (1. ve 2. opsiyon, son günü
 * bugün olan), gecikmiş taksitli kesin etkinlik, teklif aşamasında talepler, kaybedilen.
 *
 * Geçmiş etkinlik servis kuralı gereği geçmişe açılamaz: ileri tarihte açılıp
 * kesinleştirilir, sonra oturum / tutma / aralık aynı kaymayla geçmişe taşınıp
 * "gerçekleşti" yapılır.
 */

const POLICY = Object.freeze({
  optionDays: 7,
  offerValidityDays: 14,
  depositPct: '30',
  requireSignedContract: true,
  cancellationTiers: [
    { daysBefore: 90, feePct: '10' },
    { daysBefore: 30, feePct: '50' },
    { daysBefore: 0, feePct: '100' },
  ],
  contractTerms: [
    'Ödemeler ödeme planındaki vadelerde banka havalesi ya da kredi kartıyla yapılır; kalan tutar etkinlikten 7 gün önce ödenir.',
    'Kesin kişi sayısı etkinlikten 72 saat önce bildirilir; bildirilen sayı faturalanacak en az kişidir.',
    'Salon süslemesi ve teknik kurulum otelin belirlediği kurulum süresi içinde yapılır.',
    'Dışarıdan yiyecek / içecek getirilemez; pasta ve çiçek otel onayıyla kabul edilir.',
  ].join('\n'),
});

const VENUES = Object.freeze([
  { code: 'BALO', name: 'Büyük Balo Salonu', areaSqm: '980', halfDayRate: '70000', dayRate: '120000', setupMinutes: 120, teardownMinutes: 90, capacities: [['BANQUET', 400], ['THEATER', 650], ['CABARET', 300], ['COCKTAIL', 800], ['CLASSROOM', 380]] },
  { code: 'BALO-A', name: 'Balo Salonu A', parent: 'BALO', halfDayRate: '38000', dayRate: '65000', setupMinutes: 90, teardownMinutes: 60, capacities: [['BANQUET', 200], ['THEATER', 320], ['CLASSROOM', 180], ['COCKTAIL', 400]] },
  { code: 'BALO-B', name: 'Balo Salonu B', parent: 'BALO', halfDayRate: '38000', dayRate: '65000', setupMinutes: 90, teardownMinutes: 60, capacities: [['BANQUET', 200], ['THEATER', 320], ['CLASSROOM', 180], ['COCKTAIL', 400]] },
  { code: 'TERAS', name: 'Panorama Teras', dayRate: '60000', setupMinutes: 90, teardownMinutes: 60, capacities: [['COCKTAIL', 250], ['BANQUET', 160]] },
  { code: 'TOPL-1', name: 'Ankara Toplantı Odası', hourlyRate: '2500', halfDayRate: '8000', dayRate: '14000', setupMinutes: 30, teardownMinutes: 30, capacities: [['BOARDROOM', 20], ['U_SHAPE', 24], ['THEATER', 50], ['CLASSROOM', 30]] },
  { code: 'TOPL-2', name: 'Kızılay Toplantı Odası', hourlyRate: '1800', halfDayRate: '6000', dayRate: '10000', setupMinutes: 30, teardownMinutes: 30, capacities: [['BOARDROOM', 12], ['U_SHAPE', 14]] },
  { code: 'HAVUZ', name: 'Havuz Başı', dayRate: '45000', setupMinutes: 60, teardownMinutes: 60, capacities: [['COCKTAIL', 120]], passive: true },
]);

const EQUIPMENT = Object.freeze([
  { code: 'PROJ', name: 'Projeksiyon + perde', unitPrice: '1500', stockQuantity: 4 },
  { code: 'MIK', name: 'Telsiz mikrofon', unitPrice: '400', stockQuantity: 12 },
  { code: 'LED', name: 'LED ekran (4×3 m)', unitPrice: '25000', stockQuantity: 1 },
  { code: 'SAHNE', name: 'Sahne platformu', unitPrice: '12000', stockQuantity: 2 },
  { code: 'KURSU', name: 'Kürsü', unitPrice: '500', stockQuantity: 3 },
]);

const CLIENTS = Object.freeze([
  { type: 'COMPANY', name: 'Anadolu Sigorta A.Ş.', contactName: 'Gökhan Ersoy', phone: '+90 312 555 01 10', email: 'etkinlik@anadolusigorta.demo', taxOffice: 'Çankaya', taxNumber: '0680012345' },
  { type: 'COMPANY', name: 'Öztürk İnşaat A.Ş.', contactName: 'Şule Çağlar', phone: '+90 312 555 02 20', email: 'sule@ozturkinsaat.demo', taxOffice: 'Kavaklıdere', taxNumber: '6640098765' },
  { type: 'COMPANY', name: 'Başkent Tıp Derneği', contactName: 'Dr. Ayten Kılıç', phone: '+90 312 555 03 30', email: 'kongre@baskenttip.demo', taxOffice: 'Maltepe', taxNumber: '1230045678' },
  { type: 'COMPANY', name: 'Yeşilırmak Enerji', contactName: 'Murat Doğan', phone: '+90 312 555 04 40', email: 'murat@yesilirmak.demo', taxOffice: 'Ulus', taxNumber: '9450011223' },
  { type: 'PERSON', name: 'Elif Yılmaz', contactName: 'Elif Yılmaz', phone: '+90 532 555 05 50', email: 'elif.yilmaz@demo.local' },
  { type: 'PERSON', name: 'Can Aydın', contactName: 'Can Aydın', phone: '+90 533 555 06 60', email: 'can.aydin@demo.local' },
  { type: 'PERSON', name: 'Zeynep Arslan', contactName: 'Zeynep Arslan', phone: '+90 535 555 07 70', email: 'zeynep.arslan@demo.local' },
  { type: 'COMPANY', name: 'Polat Otomotiv', contactName: 'Kerem Polat', phone: '+90 312 555 08 80', email: 'kerem@polatoto.demo', taxOffice: 'Ostim', taxNumber: '7310055667' },
]);

/**
 * Demo banket verisini siler (`--reset`). Demo salon / müşterisine bağlı bütün etkinlikler
 * (personelin demo salona açtığı da — salon silinecek) ödemeleri, onay istekleri, belgeleri
 * ve uyarılarıyla. Belge dosyalarının anahtarları döner (diskten transaction dışında silinir).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} actor
 * @returns {Promise<string[]>}
 */
export async function resetBanquetDemo(tx, hotelId, actor) {
  const eventIds = (
    await tx.$queryRawUnsafe(
      `SELECT e."id" FROM "Event" e WHERE e."hotelId" = $1 AND (
         e."createdBy" = $2
         OR e."clientId" IN (SELECT "id" FROM "EventClient" WHERE "hotelId" = $1 AND "createdBy" = $2)
         OR EXISTS (SELECT 1 FROM "EventSession" s JOIN "Venue" v ON v."id" = s."venueId" WHERE s."eventId" = e."id" AND v."createdBy" = $2))`,
      hotelId,
      actor,
    )
  ).map((row) => row.id);
  if (eventIds.length) {
    const paymentIds = (await tx.$queryRawUnsafe(`SELECT "id" FROM "EventPayment" WHERE "eventId" = ANY($1::text[])`, eventIds)).map((row) => row.id);
    const approvalIds = (
      await tx.$queryRawUnsafe(`SELECT "id" FROM "Approval" WHERE "hotelId" = $1 AND "entityType" = 'EventPayment' AND "entityId" = ANY($2::text[])`, hotelId, paymentIds)
    ).map((row) => row.id);
    // İptal kaydı asıl satıra bağlı (kendi kendine yabancı anahtar): önce iptal kayıtları.
    await tx.$executeRawUnsafe(`DELETE FROM "EventPayment" WHERE "eventId" = ANY($1::text[]) AND "reversalOfId" IS NOT NULL`, eventIds);
    await tx.$executeRawUnsafe(`DELETE FROM "EventPayment" WHERE "eventId" = ANY($1::text[])`, eventIds);
    await tx.$executeRawUnsafe(`DELETE FROM "PendingAction" WHERE "approvalId" = ANY($1::text[])`, approvalIds);
    await tx.$executeRawUnsafe(`DELETE FROM "Approval" WHERE "id" = ANY($1::text[])`, approvalIds);
    await tx.$executeRawUnsafe(`DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND "entityId" = ANY($2::text[])`, hotelId, [...eventIds, ...approvalIds]);
  }
  const fileKeys = eventIds.length ? (await tx.$queryRawUnsafe(`SELECT "fileKey" FROM "EventDocument" WHERE "eventId" = ANY($1::text[])`, eventIds)).map((row) => row.fileKey) : [];
  await tx.$executeRawUnsafe(`DELETE FROM "EventDocument" WHERE "eventId" = ANY($1::text[])`, eventIds);
  // Oturum, tutma, kalem ve taksit etkinlikle gider.
  await tx.$executeRawUnsafe(`DELETE FROM "Event" WHERE "id" = ANY($1::text[])`, eventIds);
  await tx.$executeRawUnsafe(`DELETE FROM "EventEquipment" WHERE "hotelId" = $1 AND "createdBy" = $2`, hotelId, actor);
  await tx.$executeRawUnsafe(`DELETE FROM "EventClient" e WHERE e."hotelId" = $1 AND e."createdBy" = $2 AND NOT EXISTS (SELECT 1 FROM "Event" v WHERE v."clientId" = e."id")`, hotelId, actor);
  // Parçalar bütünden önce (bütün → parça yabancı anahtarı).
  await tx.$executeRawUnsafe(`DELETE FROM "Venue" WHERE "hotelId" = $1 AND "createdBy" = $2 AND "parentId" IS NOT NULL`, hotelId, actor);
  await tx.$executeRawUnsafe(`DELETE FROM "Venue" WHERE "hotelId" = $1 AND "createdBy" = $2`, hotelId, actor);
  // Otelde etkinlik kalmadıysa numara serisi baştan başlar (ETK-…-0001); kalan varsa seri sürer.
  await tx.$executeRawUnsafe(`DELETE FROM "EventSequence" s WHERE s."hotelId" = $1 AND NOT EXISTS (SELECT 1 FROM "Event" e WHERE e."hotelId" = $1)`, hotelId);
  return fileKeys;
}

/**
 * @param {{
 *   prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string,
 *   approver: string, desk: string, addDays: (iso: string, n: number) => string,
 * }} context
 */
export async function seedBanquetDemo({ prisma, core, contracts, hotelId, today, actor, approver, desk, addDays }) {
  const setup = await import('../src/modules/banquet/setup.js');
  const events = await import('../src/modules/banquet/events.js');
  const payments = await import('../src/modules/banquet/payments.js');
  const documents = await import('../src/modules/banquet/documents.js');
  const approvals = await import('../src/modules/approvals/service.js');
  // Ödeme onayının kararı dinleyiciyle işlenir; betik uygulamayı başlatmadığı için burada kaydedilir.
  const { registerBanquetSubscribers } = await import('../src/modules/banquet/subscribers.js');
  registerBanquetSubscribers();

  const as = (who, fn) => core.runWithContext({ correlationId: randomUUID(), actor: who }, fn);
  const sales = (fn) => as(actor, fn);
  const wall = (offset, time) => `${addDays(today, offset)}T${time}`;
  const version = (dto) => new Date(dto.updatedAt);

  // ── Politika, salon, ekipman, müşteri ──
  const current = await setup.getSettings(hotelId);
  await sales(() => setup.updateSettings(hotelId, contracts.updateEventSettingsSchema.parse({ ...POLICY, expectedUpdatedAt: current.updatedAt })));
  const venue = {};
  for (const seed of VENUES) {
    const created = await sales(() =>
      setup.createVenue(
        hotelId,
        contracts.createVenueSchema.parse({
          code: seed.code,
          name: seed.name,
          areaSqm: seed.areaSqm,
          hourlyRate: seed.hourlyRate,
          halfDayRate: seed.halfDayRate,
          dayRate: seed.dayRate,
          setupMinutes: seed.setupMinutes,
          teardownMinutes: seed.teardownMinutes,
          parentId: seed.parent ? venue[seed.parent].id : null,
          capacities: seed.capacities.map(([layout, capacity]) => ({ layout, capacity })),
        }),
      ),
    );
    venue[seed.code] = seed.passive
      ? await sales(() => setup.updateVenue(hotelId, created.id, contracts.updateVenueSchema.parse({ ...created, expectedUpdatedAt: created.updatedAt, status: 'PASSIVE', parentId: null })))
      : created;
  }
  const equipment = {};
  for (const seed of EQUIPMENT) equipment[seed.code] = await sales(() => setup.createEquipment(hotelId, contracts.createEquipmentSchema.parse(seed)));
  const client = {};
  for (const seed of CLIENTS) client[seed.name] = await sales(() => setup.createClient(hotelId, contracts.createEventClientSchema.parse(seed)));

  // ── Yardımcılar ──
  const open = (input) => sales(() => events.createEvent(hotelId, contracts.createEventSchema.parse(input)));
  const session = (event, { code, layout, pax, day, start, end, title }) =>
    sales(() =>
      events.saveSession(
        hotelId,
        event.id,
        null,
        contracts.createSessionSchema.parse({ expectedUpdatedAt: event.updatedAt, title, venueId: venue[code].id, layout, pax, startAt: wall(day, start), endAt: wall(day, end) }),
      ),
    );
  const items = (event, rows) =>
    sales(() =>
      events.saveItems(
        hotelId,
        event.id,
        contracts.saveEventItemsSchema.parse({
          expectedUpdatedAt: event.updatedAt,
          items: rows.map((row) => {
            // Oturum adıyla bağlanır (ekran oturumları saate göre sıralı döndürür; sıra numarası kayardı).
            const sessionId = row.session ? event.sessions.find((entry) => entry.title === row.session).id : null;
            if (row.equipment) {
              return { category: 'EQUIPMENT', description: equipment[row.equipment].name, perPerson: false, quantity: String(row.quantity), unit: 'PIECE', unitPrice: equipment[row.equipment].unitPrice, taxCategory: 'OTHER', equipmentId: equipment[row.equipment].id, sessionId };
            }
            return { discountPct: '0', sessionId, ...row, session: undefined };
          }),
        }),
      ),
    );
  const plan = async (event) => {
    const suggestion = await events.suggestPlan(hotelId, event.id);
    return sales(() => events.saveInstallments(hotelId, event.id, contracts.saveInstallmentsSchema.parse({ expectedUpdatedAt: event.updatedAt, installments: suggestion.installments })));
  };
  const issue = (event, kind, note = null) => sales(() => documents.issueDocument(hotelId, event.id, { expectedUpdatedAt: version(event), kind, note }));
  const decide = (event, document, decision) => sales(() => documents.decideDocument(hotelId, event.id, document.id, { decision }));
  const tentative = (event, optionUntil) => sales(() => events.setTentative(hotelId, event.id, contracts.tentativeEventSchema.parse({ expectedUpdatedAt: event.updatedAt, optionUntil })));
  const signAndConfirm = async (event) => {
    const contract = await issue(event, 'CONTRACT');
    await decide(event, contract, 'SIGNED');
    return sales(() => events.confirmEvent(hotelId, event.id, { expectedUpdatedAt: version(event) }));
  };
  const pay = async (event, amount, method, reference, who = desk) => {
    const result = await as(who, () =>
      payments.receiveEventPayment(hotelId, event.id, contracts.receiveEventPaymentSchema.parse({ requestId: randomUUID(), kind: 'PAYMENT', method, amount: Number(amount).toFixed(2), reference })),
    );
    if (result.payment.status === 'PENDING') await as(approver, () => approvals.decideApproval(hotelId, result.payment.approvalId, 'GRANTED', { note: 'Dekont görüldü' }));
    return result.payment;
  };
  /** Geçmişe taşır: oturum, tutma ve aralık aynı kaymayla (servis geçmişe oturum açtırmaz). */
  const shiftToPast = async (event, days) => {
    const shift = `${days} days`;
    await prisma.$executeRawUnsafe(`UPDATE "EventSession" SET "startAt" = "startAt" - $2::interval, "endAt" = "endAt" - $2::interval WHERE "eventId" = $1`, event.id, shift);
    await prisma.$executeRawUnsafe(`UPDATE "EventVenueHold" SET "startAt" = "startAt" - $2::interval, "endAt" = "endAt" - $2::interval WHERE "eventId" = $1`, event.id, shift);
    await prisma.$executeRawUnsafe(`UPDATE "Event" SET "firstStartAt" = "firstStartAt" - $2::interval, "lastEndAt" = "lastEndAt" - $2::interval WHERE "id" = $1`, event.id, shift);
    // Ödemeler de etkinlik öncesine (kasa günleri geçmişte).
    await prisma.$executeRawUnsafe(
      `UPDATE "EventPayment" SET "businessDate" = "businessDate" - $2::interval, "receivedAt" = "receivedAt" - $2::interval, "postedAt" = "postedAt" - $2::interval WHERE "eventId" = $1`,
      event.id,
      shift,
    );
    return events.getEvent(hotelId, event.id);
  };

  const menu = (description, unitPrice) => ({ category: 'FNB', description, perPerson: true, quantity: '1', unit: 'PERSON', unitPrice, taxCategory: 'FNB' });
  const drinks = (unitPrice) => ({ category: 'BEVERAGE', description: 'Sınırsız meşrubat paketi', perPerson: true, quantity: '1', unit: 'PERSON', unitPrice, taxCategory: 'FNB' });
  const rental = (description, unitPrice, unit = 'DAY', quantity = '1') => ({ category: 'VENUE', description, perPerson: false, quantity, unit, unitPrice, taxCategory: 'OTHER' });
  const service = (description, unitPrice) => ({ category: 'SERVICE', description, perPerson: false, quantity: '1', unit: 'PACKAGE', unitPrice, taxCategory: 'OTHER' });

  const counts = { events: 0, documents: 0, payments: 0 };
  const done = (event) => {
    counts.events += 1;
    return event;
  };

  // 1) Gerçekleşmiş bayi toplantısı: garanti tutarı ödendi, gerçekleşen 8 kişi fazlası borç kaldı; proformalı.
  {
    let event = await open({ name: 'Ekim bayi toplantısı', type: 'MEETING', clientId: client['Öztürk İnşaat A.Ş.'].id, expectedPax: 110, guaranteedPax: 110 });
    event = await session(event, { code: 'BALO-A', layout: 'CLASSROOM', pax: 110, day: 3, start: '09:30', end: '17:00', title: 'Bayi toplantısı' });
    event = await items(event, [menu('Tam gün toplantı paketi (2 kahve arası + öğle)', '1450'), rental('Balo Salonu A kirası', '65000'), { equipment: 'PROJ', quantity: 2, session: 'Bayi toplantısı' }, { equipment: 'MIK', quantity: 4, session: 'Bayi toplantısı' }]);
    event = await plan(event);
    event = await signAndConfirm(event);
    await pay(event, Math.round(Number(event.grandTotal) * 0.3), 'CARD', 'SLIP-48211');
    await pay(event, Number(event.grandTotal) - Math.round(Number(event.grandTotal) * 0.3), 'TRANSFER', 'DEKONT-77120');
    event = await shiftToPast(event, 23);
    event = await sales(() => events.completeEvent(hotelId, event.id, { expectedUpdatedAt: version(event), actualPax: 118 }));
    await issue(event, 'PROFORMA', 'Gerçekleşen 118 kişi üzerinden.');
    counts.payments += 2;
    done(event);
  }

  // 2) Gerçekleşmiş düğün (bütün balo salonu): kalan borcu var, faturaya hazır.
  {
    let event = await open({ name: 'Yılmaz – Kaya düğünü', type: 'WEDDING', clientId: client['Elif Yılmaz'].id, expectedPax: 380, guaranteedPax: 350, notes: 'Gelin odası 14:00\'te hazır; pasta müşteriden.' });
    event = await session(event, { code: 'BALO', layout: 'BANQUET', pax: 380, day: 4, start: '19:00', end: '23:59', title: 'Düğün yemeği' });
    event = await items(event, [menu('Düğün menüsü (4 çeşit + pasta servisi)', '2100'), drinks('450'), rental('Büyük Balo Salonu kirası', '120000'), service('Çiçek ve masa süslemesi', '45000'), { equipment: 'SAHNE', quantity: 1, session: 'Düğün yemeği' }, { equipment: 'LED', quantity: 1, session: 'Düğün yemeği' }]);
    event = await plan(event);
    event = await signAndConfirm(event);
    await pay(event, 300000, 'TRANSFER', 'DEKONT-88213');
    event = await shiftToPast(event, 12);
    event = await sales(() => events.completeEvent(hotelId, event.id, { expectedUpdatedAt: version(event), actualPax: 372 }));
    await issue(event, 'PROFORMA');
    counts.payments += 1;
    done(event);
  }

  // 3) Kongre (iki gün, birden çok salon): kesin, depozitolu.
  {
    let event = await open({ name: 'Başkent Kardiyoloji Günleri', type: 'CONFERENCE', clientId: client['Başkent Tıp Derneği'].id, expectedPax: 520, guaranteedPax: 480 });
    event = await session(event, { code: 'BALO', layout: 'THEATER', pax: 520, day: 12, start: '09:00', end: '13:00', title: '1. gün — açılış ve oturumlar' });
    event = await session(event, { code: 'BALO', layout: 'THEATER', pax: 520, day: 12, start: '14:00', end: '18:00', title: '1. gün — öğleden sonra' });
    event = await session(event, { code: 'TOPL-1', layout: 'U_SHAPE', pax: 24, day: 12, start: '14:00', end: '17:00', title: 'Uydu toplantı: genç araştırmacılar' });
    event = await session(event, { code: 'BALO-A', layout: 'CLASSROOM', pax: 180, day: 13, start: '09:00', end: '12:30', title: '2. gün — kurs A' });
    event = await session(event, { code: 'BALO-B', layout: 'CLASSROOM', pax: 180, day: 13, start: '09:00', end: '12:30', title: '2. gün — kurs B' });
    event = await session(event, { code: 'TERAS', layout: 'COCKTAIL', pax: 250, day: 12, start: '19:30', end: '22:30', title: 'Karşılama kokteyli' });
    event = await items(event, [
      menu('Kongre paketi (2 gün, kahve arası + öğle)', '2400'),
      rental('Büyük Balo Salonu (1. gün)', '120000'),
      rental('Balo A + B (2. gün yarım gün)', '76000'),
      rental('Ankara Toplantı Odası', '2500', 'HOUR', '3'),
      { ...menu('Kokteyl (kanepe + içecek)', '850'), perPerson: false, unit: 'PERSON', quantity: '250', description: 'Karşılama kokteyli (250 kişi)', session: 'Karşılama kokteyli' },
      { equipment: 'PROJ', quantity: 3, session: '1. gün — açılış ve oturumlar' },
      { equipment: 'MIK', quantity: 8, session: '1. gün — açılış ve oturumlar' },
      { equipment: 'LED', quantity: 1, session: '1. gün — açılış ve oturumlar' },
      { equipment: 'KURSU', quantity: 1, session: '1. gün — açılış ve oturumlar' },
    ]);
    event = await plan(event);
    const offer = await issue(event, 'OFFER', 'Kongre öncesi garanti sayısı 15 gün önce kesinleşir.');
    await decide(event, offer, 'ACCEPTED');
    event = await signAndConfirm(event);
    await pay(event, event.installments[0].amount, 'TRANSFER', 'DEKONT-90455', desk);
    counts.payments += 1;
    done(event);
  }

  // 4) Kesin, depozitosu gecikmiş toplantı (vade geçti, kısmen ödendi).
  {
    let event = await open({ name: 'Yeşilırmak Enerji yönetim kurulu', type: 'MEETING', clientId: client['Yeşilırmak Enerji'].id, expectedPax: 14, guaranteedPax: 14 });
    event = await session(event, { code: 'TOPL-2', layout: 'BOARDROOM', pax: 12, day: 6, start: '10:00', end: '16:00', title: 'Yönetim kurulu' });
    event = await items(event, [menu('Toplantı paketi', '1250'), rental('Kızılay Toplantı Odası', '10000')]);
    event = await sales(() =>
      events.saveInstallments(
        hotelId,
        event.id,
        contracts.saveInstallmentsSchema.parse({
          expectedUpdatedAt: event.updatedAt,
          installments: [
            { label: 'Depozito', dueDate: addDays(today, -3), amount: '12000' },
            { label: 'Kalan ödeme', dueDate: addDays(today, 5), amount: (Number(event.grandTotal) - 12000).toFixed(2) },
          ],
        }),
      ),
    );
    event = await signAndConfirm(event);
    await pay(event, 5000, 'CASH', null);
    counts.payments += 1;
    done(event);
  }

  // 5) Kesinleşip iptal edilen gala: bedel kademeden, fazla ödeme için onay bekleyen iade.
  {
    let event = await open({ name: 'Polat Otomotiv bahar galası', type: 'GALA', clientId: client['Polat Otomotiv'].id, expectedPax: 180, guaranteedPax: 180 });
    event = await session(event, { code: 'BALO-B', layout: 'BANQUET', pax: 180, day: 45, start: '19:30', end: '23:30', title: 'Gala yemeği' });
    event = await items(event, [menu('Gala menüsü', '1900'), drinks('500'), rental('Balo Salonu B kirası', '65000')]);
    event = await plan(event);
    event = await signAndConfirm(event);
    await pay(event, 300000, 'TRANSFER', 'DEKONT-60321');
    event = await sales(() => events.cancelEvent(hotelId, event.id, { expectedUpdatedAt: version(event), reason: 'Lansman ertelendi; müşteri yazılı bildirdi.' }));
    const refund = Number(event.paidTotal) - Number(event.cancellationFee);
    if (refund > 0) {
      await as(desk, () =>
        payments.receiveEventPayment(
          hotelId,
          event.id,
          contracts.receiveEventPaymentSchema.parse({ requestId: randomUUID(), kind: 'REFUND', method: 'TRANSFER', amount: String(refund.toFixed(2)), reference: 'IADE-60321', note: 'İptal bedeli düşüldü' }),
        ),
      );
    }
    await issue(event, 'PROFORMA', 'İptal bedeli.');
    counts.payments += 2;
    done(event);
  }

  // 6) Düğün: 1. opsiyon (teklif kabul), aynı akşam aynı salona 2. opsiyon (sırada).
  {
    let first = await open({ name: 'Aydın – Demir nişanı', type: 'ENGAGEMENT', clientId: client['Can Aydın'].id, expectedPax: 220 });
    first = await session(first, { code: 'BALO-A', layout: 'BANQUET', pax: 200, day: 28, start: '19:00', end: '23:30', title: 'Nişan yemeği' });
    first = await items(first, [menu('Nişan menüsü', '1650'), rental('Balo Salonu A kirası', '65000')]);
    first = await tentative(first, addDays(today, 5));
    const offer = await issue(first, 'OFFER');
    await decide(first, offer, 'ACCEPTED');
    done(first);
    let second = await open({ name: 'Arslan mezuniyet yemeği', type: 'OTHER', clientId: client['Zeynep Arslan'].id, expectedPax: 150 });
    second = await session(second, { code: 'BALO', layout: 'BANQUET', pax: 150, day: 28, start: '20:00', end: '23:30', title: 'Mezuniyet yemeği' });
    second = await items(second, [menu('Akşam yemeği menüsü', '1400'), rental('Büyük Balo Salonu kirası', '120000')]);
    second = await tentative(second, addDays(today, 6));
    await issue(second, 'OFFER');
    done(second);
  }

  // 7) Son günü bugün olan opsiyon (zil hatırlatır) ve teklif bekleyen talepler.
  {
    let event = await open({ name: 'Anadolu Sigorta çeyrek değerlendirme', type: 'MEETING', clientId: client['Anadolu Sigorta A.Ş.'].id, expectedPax: 45 });
    event = await session(event, { code: 'TOPL-1', layout: 'THEATER', pax: 45, day: 9, start: '09:30', end: '12:30', title: 'Değerlendirme' });
    event = await items(event, [menu('Yarım gün toplantı paketi', '850'), rental('Ankara Toplantı Odası (yarım gün)', '8000')]);
    event = await tentative(event, today);
    await issue(event, 'OFFER');
    done(event);

    let inquiry = await open({ name: 'Yıl sonu personel partisi', type: 'GALA', clientId: client['Anadolu Sigorta A.Ş.'].id, expectedPax: 300, notes: 'Müşteri iki tarih soruyor; DJ ve sahne isteniyor.' });
    inquiry = await session(inquiry, { code: 'BALO', layout: 'CABARET', pax: 280, day: 60, start: '20:00', end: '23:59', title: 'Parti' });
    inquiry = await items(inquiry, [menu('Kokteyl + akşam yemeği', '1750'), drinks('600'), rental('Büyük Balo Salonu kirası', '120000'), service('DJ ve ses sistemi', '35000')]);
    await issue(inquiry, 'OFFER', 'Fiyatlar 2 hafta geçerlidir.');
    done(inquiry);

    done(await open({ name: 'Doğum günü kokteyli', type: 'BIRTHDAY', clientId: client['Zeynep Arslan'].id, expectedPax: 60, notes: 'Teras isteniyor; tarih netleşmedi.' }));
  }

  // 8) Kaybedilen teklif.
  {
    let event = await open({ name: 'Ürün tanıtım lansmanı', type: 'COCKTAIL', clientId: client['Polat Otomotiv'].id, expectedPax: 200 });
    event = await session(event, { code: 'TERAS', layout: 'COCKTAIL', pax: 200, day: 35, start: '18:00', end: '21:00', title: 'Lansman' });
    event = await items(event, [menu('Kokteyl menüsü', '900'), rental('Teras kirası', '60000')]);
    await issue(event, 'OFFER');
    await sales(() => events.loseEvent(hotelId, event.id, { expectedUpdatedAt: version(event), reason: 'Müşteri rakip otelin bahçesini seçti (fiyat).' }));
    done(event);
  }

  counts.documents = await prisma.eventDocument.count({ where: { hotelId, event: { createdBy: actor } } });
  return { ...counts, venues: VENUES.length, equipment: EQUIPMENT.length, clients: CLIENTS.length };
}

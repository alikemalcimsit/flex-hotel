/**
 * Zincir konsolu (modül 63) demo verisi.
 *
 *   DATABASE_URL=postgresql://... DEMO_CONFIRM=DEMO node scripts/demo-chain.mjs [--reset]
 *
 * `demo-data.mjs` (DEMO oteli) çalıştıktan SONRA çalışır:
 * - "Flex Otelleri (örnek)" zinciri: DEMO oteli ilk oteli.
 * - İkinci örnek otel "Flex Bodrum Marina (örnek)" (`DEMO-BDR`): yeni otel sihirbazının servis fonksiyonuyla DEMO'dan
 *   kopyalanır (genel parametreler, oda tipleri, vergiler, sezonlar, rol matrisi) ve aynı demo betikleriyle doldurulur
 *   (`DEMO_HOTEL_CODE=DEMO-BDR DEMO_CODE_PREFIX=DMB-`, farklı tohum: misafirleri, doluluğu DEMO'nun kopyası değil).
 * - DEMO'nun yöneticileri ve müdürleri ikinci otele aynı rolle erişir (üst bardaki otel seçici görünür).
 *
 * Otel silinmez (yüzlerce tabloya bağlı); `--reset` ikinci otelin demo verisini `demo-data.mjs --reset` ile yeniler,
 * zinciri ve erişimleri yeniden kurar. Gerçek kişiye ait veri yok.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.DEMO_CONFIRM !== 'DEMO') {
  console.error('Güvenlik: DEMO_CONFIRM=DEMO verilmeden çalışmaz.');
  process.exit(1);
}

const { prisma } = await import('../src/db.js');
const { HOTEL_COPY_GROUPS } = await import('@hotelos/hotel-contracts');
const { createHotelFromTemplate } = await import('../src/modules/chain/hotels.js');
const { recordAudit } = await import('../src/lib/audit.js');
const { writeWithEvents } = await import('../src/lib/write.js');

const ACTOR = 'demo@hotel.local';
const GROUP_NAME = 'Flex Otelleri (örnek)';
const SECOND = Object.freeze({
  code: 'DEMO-BDR',
  prefix: 'DMB-',
  name: 'Flex Bodrum Marina (örnek)',
  address: 'Neyzen Tevfik Cad. No: 48, 48400 Bodrum / Muğla',
  phone: '+90 252 555 48 48',
  email: 'bodrum@flexotelleri.example',
});
/** DEMO'da bu rollerdeki kişiler ikinci otele aynı rolle erişir. */
const SHARED_ROLES = Object.freeze(['ADMIN', 'MANAGER']);

const demo = await prisma.hotel.findFirst({ where: { code: 'DEMO' } });
if (!demo) {
  console.error('DEMO oteli yok; önce `npm run seed` ve `demo-data.mjs`.');
  process.exit(1);
}

const summary = await writeWithEvents(async (tx) => {
  // Zincir: DEMO'nun zinciri yoksa kurulur (başka adla kurulmuşsa ona dokunulmaz).
  let groupId = demo.groupId;
  if (!groupId) {
    const group = await tx.hotelGroup.create({ data: { name: GROUP_NAME, createdBy: ACTOR } });
    await tx.hotel.update({ where: { id: demo.id }, data: { groupId: group.id } });
    await recordAudit(tx, { hotelId: demo.id, entity: 'HotelGroup', entityId: group.id, action: 'CREATE', after: { name: GROUP_NAME, hotelIds: [demo.id] } });
    groupId = group.id;
  }

  // İkinci otel: yoksa sihirbazın servis fonksiyonuyla DEMO'dan kurulur.
  let second = await tx.hotel.findFirst({ where: { code: SECOND.code } });
  let created = false;
  if (!second) {
    const result = await createHotelFromTemplate(tx, {
      identity: { name: SECOND.name, code: SECOND.code, timezone: demo.timezone, currency: demo.currency, address: SECOND.address, phone: SECOND.phone, email: SECOND.email },
      source: demo,
      copy: [...HOTEL_COPY_GROUPS],
      groupId,
    });
    second = result.hotel;
    created = true;
    await recordAudit(tx, { hotelId: second.id, entity: 'Hotel', entityId: second.id, action: 'CREATE', after: { name: second.name, code: second.code, sourceHotelId: demo.id, copied: result.copied } });
  } else if (second.groupId !== groupId) {
    await tx.hotel.update({ where: { id: second.id }, data: { groupId } });
  }

  // Erişimler: DEMO'nun yöneticileri / müdürleri ikinci otelde aynı rolle.
  const people = await tx.user.findMany({ where: { hotelId: demo.id, isActive: true, role: { in: SHARED_ROLES } }, select: { id: true, role: true } });
  for (const person of people) {
    await tx.userHotel.upsert({
      where: { userId_hotelId: { userId: person.id, hotelId: second.id } },
      create: { userId: person.id, hotelId: second.id, role: person.role, createdBy: ACTOR },
      update: { role: person.role, updatedBy: ACTOR },
    });
  }
  return { groupId, secondId: second.id, created, memberships: people.length };
});

console.log(`Zincir: ${GROUP_NAME} · ikinci otel ${SECOND.code} ${summary.created ? 'kuruldu' : 'vardı'} · ${summary.memberships} kişiye erişim.`);
await prisma.$disconnect();

// İkinci otelin demo verisi: aynı betik, başka otel ve önek.
const script = fileURLToPath(new URL('./demo-data.mjs', import.meta.url));
const args = [script, ...(process.argv.includes('--reset') || !summary.created ? ['--reset'] : [])];
const run = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, DEMO_HOTEL_CODE: SECOND.code, DEMO_CODE_PREFIX: SECOND.prefix },
});
process.exit(run.status ?? 1);

import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { fullName } from './shared.js';

/**
 * Randevunun misafiri ve grup dersinin kontenjanı (modül 57) — randevu ve seans servislerinin ortak parçaları.
 */

/** Spa randevusu alabilen konaklama durumları (gelecek ya da içerideki misafir). */
export const SPA_STAY_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

/**
 * Randevunun kime ait olduğunu çözer: konaklama verildiyse misafirin adı, telefonu ve (içerideyse) odası
 * rezervasyondan okunur; verilmediyse dışarıdan gelenin yazılan adı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | any} client @param {string} hotelId
 * @param {{ reservationId: string | null, customerName?: string | null, customerPhone?: string | null }} input
 */
export async function resolveSpaCustomer(client, hotelId, input) {
  if (!input.reservationId) {
    return { reservationId: null, guestId: null, customerName: /** @type {string} */ (input.customerName), customerPhone: input.customerPhone ?? null, roomNumber: null };
  }
  const stay = await client.reservation.findFirst({
    where: { id: input.reservationId, hotelId },
    select: { id: true, status: true, guestId: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true, phone: true } } },
  });
  if (!stay) throw new ValidationError('Konaklama bulunamadı', { field: 'reservationId' });
  if (!SPA_STAY_STATUSES.includes(stay.status)) {
    throw new ValidationError('Bu konaklama kapanmış (çıkış yapmış ya da iptal); misafiri dışarıdan gelen olarak adıyla kaydedin.', { field: 'reservationId' });
  }
  return {
    reservationId: stay.id,
    guestId: stay.guestId,
    customerName: fullName(stay.guest) ?? 'Misafir',
    customerPhone: stay.guest?.phone ?? null,
    roomNumber: stay.status === 'CHECKED_IN' ? (stay.room?.number ?? null) : null,
  };
}

/**
 * Seansın sayaçlarını değiştirir (seans satırı kilitliyken). Asıl liste kontenjanı aşarsa veritabanı kısıtı reddeder.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} sessionId @param {{ booked?: number, waitlisted?: number }} delta
 */
export async function adjustSeats(tx, sessionId, { booked = 0, waitlisted = 0 }) {
  if (!booked && !waitlisted) return;
  await tx.spaSession.update({ where: { id: sessionId }, data: { bookedCount: { increment: booked }, waitlistCount: { increment: waitlisted } } });
}

/** Bir seferde yedekten asıla geçirilen en fazla kayıt. */
const PROMOTE_LIMIT = 50;

/**
 * Yer açılınca yedek listeyi sırayla asıla geçirir (seans satırı kilitliyken). Sıra kayıt anına göredir; açılan yere
 * sığmayan kalabalık kayıt atlanır, arkasındaki sığan geçer (tek kişilik yer üç kişilik kaydı beklemez). Geçen her
 * kayıt için spa'ya zil düşer; misafire onay bildirimini çağıran commit'ten sonra gönderir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, sessionId: string }} input
 * @returns {Promise<string[]>} asıla geçen kayıtlar
 */
export async function promoteWaitlist(tx, stage, { hotelId, sessionId }) {
  const session = await tx.spaSession.findFirst({ where: { id: sessionId, hotelId }, select: { id: true, status: true, capacity: true, bookedCount: true, waitlistCount: true, serviceName: true, startsAt: true } });
  if (!session) throw new NotFoundError('Seans bulunamadı');
  if (session.status !== 'SCHEDULED' || !session.waitlistCount) return [];
  let free = session.capacity - session.bookedCount;
  if (free <= 0) return [];
  const waiting = await tx.spaAppointment.findMany({
    where: { sessionId, status: 'WAITLISTED' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: PROMOTE_LIMIT,
    select: { id: true, code: true, guestCount: true, customerName: true, source: true },
  });
  const promoted = [];
  for (const row of waiting) {
    if (free <= 0) break;
    if (row.guestCount > free) continue;
    free -= row.guestCount;
    await tx.spaAppointment.update({ where: { id: row.id }, data: { status: 'BOOKED' } });
    await adjustSeats(tx, sessionId, { booked: row.guestCount, waitlisted: -row.guestCount });
    await recordAudit(tx, { hotelId, entity: 'SpaAppointment', entityId: row.id, action: 'UPDATE', before: { status: 'WAITLISTED' }, after: { status: 'BOOKED', promoted: true } });
    await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId, change: 'PROMOTED', source: row.source });
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'SPA',
      severity: 'INFO',
      title: `Yedekten asıla geçti: ${row.customerName} · ${session.serviceName}`.slice(0, 200),
      body: `${row.code} · ${row.guestCount} kişi. Misafire onay bildirimi gönderildi (iletişimi ve açık kanal varsa); yoksa arayıp haber verin.`,
      link: `/spa/dersler/${sessionId}`,
      permission: PERMISSIONS.SPA_BOOK,
      entityType: 'SpaAppointment',
      entityId: row.id,
      dedupeKey: `spa-promoted:${row.id}`,
    });
    promoted.push(row.id);
  }
  return promoted;
}

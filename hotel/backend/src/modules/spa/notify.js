import { enqueueTriggerNotifications, ensureTriggerTemplates } from '../notifications/service.js';
import { prisma, spaContext, wallParts } from './shared.js';

/**
 * Spa bildirimleri (modül 57): misafire randevu onayı ve hatırlatma, modül 9'un kanalları ve şablonlarıyla
 * (`SPA_BOOKED`, `SPA_REMINDER`; değişkenler `{hizmetAdi}`, `{randevuTarihi}`, `{randevuSaati}`).
 *
 * Yalnız **konaklamaya bağlı** randevuya gider (bildirim altyapısı misafir kartının iletişimini ve dilini
 * rezervasyondan okur); dışarıdan gelen misafire gitmez. Bildirim randevunun yan işidir: gönderilemezse randevu
 * bozulmaz, hata günlüğe düşer. Aynı randevunun aynı saati için ikinci kez gitmez; saat değişince yenisi gider.
 */

/** "2026-11-20" → "20.11.2026" */
const dotted = (day) => day.split('-').reverse().join('.');

/**
 * @param {string} hotelId @param {string} appointmentId @param {'SPA_BOOKED' | 'SPA_REMINDER'} trigger
 * @param {{ error?: Function }} [logger]
 * @returns {Promise<boolean>} kuyruğa yazıldı mı
 */
export async function sendSpaNotification(hotelId, appointmentId, trigger, logger = console) {
  try {
    const appointment = await prisma.spaAppointment.findFirst({ where: { id: appointmentId, hotelId }, select: { id: true, status: true, reservationId: true, serviceName: true, startsAt: true } });
    if (!appointment?.reservationId || appointment.status !== 'BOOKED') return false;
    const { timezone } = await spaContext(hotelId);
    const local = wallParts(appointment.startsAt, timezone);
    await ensureTriggerTemplates(hotelId, trigger);
    const result = await enqueueTriggerNotifications(hotelId, trigger, {
      reservationId: appointment.reservationId,
      extraValues: { hizmetAdi: appointment.serviceName, randevuTarihi: dotted(local.day), randevuSaati: local.time },
      // Randevu ve saati anahtarda: aynı konaklamanın ikinci randevusu ve saati değişen randevu ayrıca bildirilir.
      dedupeSuffix: `${appointment.id}:${appointment.startsAt.getTime()}`,
    });
    return result.queued.length > 0;
  } catch (error) {
    logger.error?.({ err: error, hotelId, appointmentId, trigger }, 'Spa bildirimi kuyruğa yazılamadı');
    return false;
  }
}

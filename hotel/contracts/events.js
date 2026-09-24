/**
 * Olayların ekranda görünen Türkçe adları (modül 12).
 *
 * Olay adı (`reservation.created`) modüller arası sözleşmedir, değişmez;
 * aktör panelinde ve Activity Feed'de yöneticiye "ne oldu" diye okunur.
 * Katalogdaki her olayın burada adı olmalı — backend birim testi
 * (`modules/actors/rules.test.js`) eksik adı yakalar.
 */
export const EVENT_LABELS = Object.freeze({
  'settings.hotel.updated': 'Otel bilgileri değişti',
  'settings.roomType.created': 'Oda tipi eklendi',
  'settings.roomType.updated': 'Oda tipi değişti',
  'settings.roomType.deleted': 'Oda tipi silindi',
  'settings.tax.created': 'Vergi eklendi',
  'settings.tax.updated': 'Vergi değişti',
  'settings.tax.deleted': 'Vergi silindi',
  'settings.season.created': 'Sezon eklendi',
  'settings.season.updated': 'Sezon değişti',
  'settings.season.deleted': 'Sezon silindi',

  'inventory.room.created': 'Oda eklendi',
  'inventory.room.updated': 'Oda bilgisi değişti',
  'inventory.room.deleted': 'Oda silindi',
  'room.assigned': 'Odaya misafir atandı',
  'room.unassigned': 'Oda ataması kaldırıldı',
  'room.status.changed': 'Oda durumu değişti',
  'room.blocked': 'Oda arızaya / bloğa alındı',
  'room.unblocked': 'Oda bloğu kalktı',

  'reservation.created': 'Rezervasyon açıldı',
  'reservation.updated': 'Rezervasyon değişti',
  'reservation.confirmed': 'Rezervasyon kesinleşti',
  'reservation.cancelled': 'Rezervasyon iptal edildi',
  'reservation.no_show': 'Misafir gelmedi (no-show)',
  'reservation.reinstated': 'Rezervasyon geri alındı',
  'reservation.requested': 'Kanaldan rezervasyon isteği geldi',
  'reservation.rejected': 'Rezervasyon isteği reddedildi',
  'waitlist.changed': 'Bekleme listesi değişti',

  'guest.checked_in': 'Misafir giriş yaptı',
  'guest.checked_out': 'Misafir çıkış yaptı',
  'guest.check_in_reverted': 'Giriş geri alındı',
  'guest.check_out_reverted': 'Çıkış geri alındı',

  'guest.message.received': 'Misafirden mesaj geldi',
  'guest.message.reply': 'Misafire cevap yazıldı',
  'guest.intent.detected': 'Mesajın niyeti belirlendi',
  'guest.message.delivery': 'Mesajın teslim durumu değişti',
  'conversation.updated': 'Konuşma değişti',
  'conversation.read': 'Konuşma okundu',
  'guest.request.created': 'Misafir isteği açıldı',
  'guest.request.updated': 'Misafir isteği değişti',

  'notification.send.requested': 'Bildirim gönderim sırasına girdi',
  'notification.sent': 'Bildirim gönderildi',
  'notification.delivered': 'Bildirim teslim edildi',
  'notification.failed': 'Bildirim gönderilemedi',
  'notification.cancelled': 'Bildirim iptal edildi',
  'notification.template.saved': 'Bildirim şablonu kaydedildi',
  'notification.channel.updated': 'Bildirim kanalı ayarı değişti',

  'staff.alert.raised': 'Personele uyarı düştü',

  'approval.requested': 'Onay istendi',
  'approval.granted': 'Onay verildi',
  'approval.denied': 'Onay reddedildi',
  'approval.expired': 'Onayın süresi doldu',

  'actor.setting.changed': 'Aktör açıldı / kapatıldı',
  'manual_task.created': 'Manuel görev açıldı',
  'manual_task.updated': 'Manuel görev güncellendi',
});

/**
 * Olayın Türkçe adı; bilinmiyorsa teknik adı.
 * @param {string | null | undefined} name
 */
export function eventLabel(name) {
  if (!name) return '';
  return EVENT_LABELS[name] ?? name;
}

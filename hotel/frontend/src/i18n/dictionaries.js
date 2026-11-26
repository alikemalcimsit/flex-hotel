import { mergeAreas } from './keys.js';
import trAuth from './tr/auth.js';
import trCash from './tr/cash.js';
import trCommon from './tr/common.js';
import trInvoices from './tr/invoices.js';
import trLayout from './tr/layout.js';
import trNav from './tr/nav.js';
import trPayments from './tr/payments.js';
import trFrontDesk from './tr/frontDesk.js';
import trReservations from './tr/reservations.js';
import trRoomPlan from './tr/roomPlan.js';
import trFolio from './tr/folio.js';
import enAuth from './en/auth.js';
import enCash from './en/cash.js';
import enCommon from './en/common.js';
import enInvoices from './en/invoices.js';
import enLayout from './en/layout.js';
import enNav from './en/nav.js';
import enPayments from './en/payments.js';
import enFrontDesk from './en/frontDesk.js';
import enReservations from './en/reservations.js';
import enRoomPlan from './en/roomPlan.js';
import enFolio from './en/folio.js';

/**
 * Alan dosyaları. Yeni alan: `tr/<alan>.js` + `en/<alan>.js` yazın, ikisini de buraya ekleyin (aynı adla).
 * Alan adı anahtarın ilk parçasıdır (`frontDesk.arrivals.title` → `frontDesk`); test bunu ve TR = EN anahtar
 * kümesini denetler.
 */
export const AREAS = Object.freeze({
  tr: Object.freeze({ common: trCommon, nav: trNav, auth: trAuth, layout: trLayout, payments: trPayments, cash: trCash, invoices: trInvoices, frontDesk: trFrontDesk, reservations: trReservations, roomPlan: trRoomPlan, folio: trFolio }),
  en: Object.freeze({ common: enCommon, nav: enNav, auth: enAuth, layout: enLayout, payments: enPayments, cash: enCash, invoices: enInvoices, frontDesk: enFrontDesk, reservations: enReservations, roomPlan: enRoomPlan, folio: enFolio }),
});

/** Dil → düz sözlük (anahtar → metin). */
export const DICTIONARIES = Object.freeze({
  tr: mergeAreas(AREAS.tr),
  en: mergeAreas(AREAS.en),
});

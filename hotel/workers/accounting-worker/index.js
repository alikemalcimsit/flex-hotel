import { BaseWorker } from '@hotelos/actor-kit';
import { accountingWorkerManifest } from './manifest.js';

/**
 * Hata iş kuralından mı geliyor? Servisin tipli hataları HTTP durumu taşır; 4xx olanlar ("eşleme yok", "cari
 * seçilmemiş") tekrar denemekle düzelmez — beklemeden personelin önüne düşmeli.
 * @param {unknown} error
 */
function markBusinessErrorsFinal(error) {
  const status = /** @type {{ statusCode?: number }} */ (error)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    /** @type {{ retryable?: boolean }} */ (error).retryable = false;
  }
  return error;
}

/** @param {() => Promise<any>} work */
async function run(work) {
  try {
    return await work();
  } catch (error) {
    throw markBusinessErrorsFinal(error);
  }
}

/** Ödeme satırını muhasebe açısından değiştiren etkinlik / restoran ödeme haberleri. */
const POSTED_PAYMENT_CHANGES = Object.freeze(['RECEIVED', 'POSTED', 'VOIDED']);
/** Etkinlik bedelini değiştiren haberler: gerçekleşti, iptal edildi (iptal bedeli), kaybedildi (yazılmışsa geri alınır). */
const EVENT_CHARGE_CHANGES = Object.freeze(['COMPLETED', 'CANCELLED', 'LOST']);
/** Prim hak edişinin cari etkisini değiştiren haberler. */
const BONUS_CHANGES = Object.freeze(['APPROVED', 'PAID', 'PAYMENT_REVERTED', 'REOPENED']);

/** @param {{ posted?: boolean, skipped?: string, message?: string | null }} result @param {string} fallback */
const said = (result, fallback) => ({ message: result.message ?? result.skipped ?? fallback, meta: { posted: Boolean(result.posted) } });

/**
 * Muhasebe aktörü.
 *
 * Servisi dışarıdan alır: paket ne Prisma ne HTTP bilir, sahte servisle veritabanısız test edilir. Kararlar
 * (hangi hesap, hangi tutar, başlangıç gününden önce mi) serviste; aktör olayı doğru işe çevirir ve sonucu
 * okunur yazar. Servis kaynak belgeden okur ve idempotenttir: aynı olay iki kez gelse de kayıt bir kez yazılır.
 */
class AccountingWorker extends BaseWorker {
  /**
   * @param {{
   *   syncFolioPayment: (hotelId: string, paymentId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   *   syncEventPayment: (hotelId: string, paymentId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   *   syncPosPayment: (hotelId: string, paymentId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   *   syncGoodsReceipt: (hotelId: string, receiptId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   *   syncAgencyBonus: (hotelId: string, bonusId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   *   syncEventCharge: (hotelId: string, eventId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    super(
      accountingWorkerManifest,
      {
        /** Folyo tahsilatı işlendi (doğrudan ya da onaylanınca): kasaya / bankaya ya da cariye. */
        'payment.received': async (payload) => said(await run(() => service.syncFolioPayment(payload.hotelId, payload.paymentId)), 'Folyo tahsilatı işlendi'),
        /** İade işlendi: kasadan / bankadan çıkış ya da carinin alacağı. */
        'payment.refunded': async (payload) => said(await run(() => service.syncFolioPayment(payload.hotelId, payload.paymentId)), 'Folyo iadesi işlendi'),
        /** Hatalı ödeme iptal edildi: iptal kaydı ters hareketle düşer. */
        'payment.voided': async (payload) => said(await run(() => service.syncFolioPayment(payload.hotelId, payload.reversalId)), 'Ödeme iptali ters kayıtla düşüldü'),
        'banquet.payment.changed': async (payload) => {
          if (!POSTED_PAYMENT_CHANGES.includes(payload.change)) return { message: 'Muhasebe etkisi yok (onay bekliyor / reddedildi)' };
          return said(await run(() => service.syncEventPayment(payload.hotelId, payload.paymentId)), 'Etkinlik tahsilatı işlendi');
        },
        'pos.payment.changed': async (payload) => {
          if (!POSTED_PAYMENT_CHANGES.includes(payload.change)) return { message: 'Muhasebe etkisi yok (onay bekliyor / reddedildi)' };
          return said(await run(() => service.syncPosPayment(payload.hotelId, payload.paymentId)), 'Restoran tahsilatı işlendi');
        },
        /** Mal kabul: tedarikçi carisine vadeli borcumuz. */
        'purchase.goods.received': async (payload) => said(await run(() => service.syncGoodsReceipt(payload.hotelId, payload.receiptId)), 'Mal kabul cariye işlendi'),
        /** Prim hak edişi onaylandı / ödendi / yeniden açıldı: acente carisi hedefe eşitlenir. */
        'agency.bonus.changed': async (payload) => {
          if (!BONUS_CHANGES.includes(payload.change)) return { message: 'Muhasebe etkisi yok' };
          return said(await run(() => service.syncAgencyBonus(payload.hotelId, payload.bonusId)), 'Prim hak edişi cariye işlendi');
        },
        /** Etkinlik gerçekleşti / iptal edildi / kaybedildi: müşteri carisi bedele eşitlenir. */
        'banquet.event.changed': async (payload) => {
          if (!EVENT_CHARGE_CHANGES.includes(payload.change)) return { message: 'Muhasebe etkisi yok' };
          return said(await run(() => service.syncEventCharge(payload.hotelId, payload.eventId)), 'Etkinlik bedeli cariye işlendi');
        },
      },
      deps,
    );
  }

  /**
   * Manuel görevin başlığı: hangi belge muhasebeye işlenecek. Muhasebeci sorunu (eşleme, cari) düzeltip
   * Muhasebe → Eşitle ile dönemi tamamlar.
   * @param {string} eventName @param {any} payload
   */
  describeFallback(eventName, payload) {
    switch (eventName) {
      case 'payment.received':
        return 'Folyo tahsilatı muhasebeye işlenecek (kasa / banka ya da cari)';
      case 'payment.refunded':
        return 'Folyo iadesi muhasebeye işlenecek';
      case 'payment.voided':
        return 'Ödeme iptali muhasebeye ters kayıtla işlenecek';
      case 'banquet.payment.changed':
        return 'Etkinlik tahsilatı kasaya / bankaya ve müşteri carisine işlenecek';
      case 'pos.payment.changed':
        return 'Restoran tahsilatı kasaya / bankaya işlenecek';
      case 'purchase.goods.received':
        return 'Mal kabul tedarikçi carisine işlenecek';
      case 'agency.bonus.changed':
        return 'Acente prim hak edişi acente carisine işlenecek';
      case 'banquet.event.changed':
        return 'Etkinlik bedeli müşteri carisine işlenecek';
      default:
        return super.describeFallback(eventName, payload);
    }
  }
}

export { accountingWorkerManifest };

/**
 * @param {ConstructorParameters<typeof AccountingWorker>[0]} service
 * @param {ConstructorParameters<typeof AccountingWorker>[1]} deps
 */
export function createAccountingWorker(service, deps) {
  return new AccountingWorker(service, deps);
}

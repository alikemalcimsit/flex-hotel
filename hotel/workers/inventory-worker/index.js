import { BaseWorker } from '@hotelos/actor-kit';
import { inventoryWorkerManifest } from './manifest.js';

/**
 * Hata iş kuralından mı geliyor? Servisin tipli hataları HTTP durumu taşır; 4xx olanlar ("depo yok", "depo pasif")
 * tekrar denemekle düzelmez — beklemeden personelin önüne düşmeli.
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

/** Miktarı düşüren stok haberleri: minimum altına inen malzeme bunlardan sonra aranır (mal kabul miktarı artırır). */
const CONSUMING_CHANGES = Object.freeze(['SALE', 'MOVEMENT', 'COUNT']);

/**
 * Stok aktörü.
 *
 * Servisi dışarıdan alır: paket ne Prisma ne HTTP bilir, sahte servisle veritabanısız test edilir. Kararlar
 * (hangi depo, reçete açılımı, hareketli ortalama, öneri miktarı) serviste; aktör olayı doğru işe çevirir ve
 * sonucu okunur yazar.
 */
class InventoryWorker extends BaseWorker {
  /**
   * @param {{
   *   consumeSale: (hotelId: string, payload: object) => Promise<{ posted: boolean, skipped?: string, message: string, movements: number, skippedItems: string[] }>,
   *   suggestPurchases: (hotelId: string, stockItemIds: string[]) => Promise<{ created: boolean, message: string, requestId?: string, number?: string }>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    super(
      inventoryWorkerManifest,
      {
        /** Adisyon kapandı: reçeteden stok düşümü (yeniden yayında düzeltme). */
        'fnb.order.paid': async (payload) => {
          const result = await run(() => service.consumeSale(payload.hotelId, payload));
          return { message: result.message, meta: { posted: result.posted, movements: result.movements, skippedItems: result.skippedItems ?? [], checkId: payload.checkId } };
        },
        /** Miktar düştü: minimumun altına inen malzeme için talep. */
        'stock.changed': async (payload) => {
          const result = await run(() => service.suggestPurchases(payload.hotelId, payload.stockItemIds ?? []));
          return { message: result.message, meta: { created: result.created, requestId: result.requestId ?? null, number: result.number ?? null } };
        },
      },
      deps,
    );
  }

  /** Yalnız miktarı düşüren stok haberleri işe girer; depo / minimum / ayar değişikliği ve mal kabul iz bırakmaz. */
  accepts(eventName, payload) {
    if (eventName !== 'stock.changed') return true;
    return CONSUMING_CHANGES.includes(payload.change) && Array.isArray(payload.stockItemIds) && payload.stockItemIds.length > 0;
  }

  /** Öneri kapalıyken atlanır: satın alma ekranı aynı listeyi her an gösterir. Satış düşümü ise personele düşer. */
  skipWhenDisabled(eventName) {
    return eventName === 'stock.changed';
  }

  /**
   * Manuel görevin başlığı: hangi adisyonun stoğu düşülecek (stok yetkilisi elle çıkış hareketiyle tamamlar).
   * @param {string} eventName @param {any} payload
   */
  describeFallback(eventName, payload) {
    switch (eventName) {
      case 'fnb.order.paid':
        return `Adisyon ${payload.number ?? ''} stoktan düşülecek (${(payload.items ?? []).length} ürün)`.replace('  ', ' ');
      case 'stock.changed':
        return 'Minimum altına düşen malzeme için satın alma önerisi';
      default:
        return super.describeFallback(eventName, payload);
    }
  }
}

/**
 * @param {ConstructorParameters<typeof InventoryWorker>[0]} service
 * @param {ConstructorParameters<typeof InventoryWorker>[1]} deps
 */
export function createInventoryWorker(service, deps) {
  return new InventoryWorker(service, deps);
}

export { inventoryWorkerManifest };

import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Şemadaki her tabloda `deletedAt` var ama hiçbir şey onu zorunlu kılmıyordu:
 * her modülün her sorgusuna elle `deletedAt: null` yazmak, er ya da geç birinin
 * unutup silinmiş kaydı listelemesi demek. Bu yüzden filtre tek yerde,
 * Prisma extension'ı olarak uygulanıyor.
 *
 * KURAL: `findUnique` kullanmayın, `findFirst` kullanın.
 * Prisma `findUnique`'in where'inde yalnızca unique alanlara izin verdiği için
 * bu extension oraya `deletedAt: null` ekleyemez — yani `findUnique` silinmiş
 * kaydı da döndürür. Servis katmanı bu yüzden hep `findFirst` çağırır.
 */

/** `deletedAt` alanı olan modeller (şema değişince otomatik güncellenir). */
const SOFT_DELETE_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'deletedAt'))
    .map((model) => model.name),
);

/**
 * @param {unknown} args
 * @param {string | undefined} model
 */
function withNotDeleted(args, model) {
  if (!model || !SOFT_DELETE_MODELS.has(model)) return args;
  const typedArgs = /** @type {{ where?: Record<string, unknown> }} */ (args ?? {});
  // Çağıran açıkça deletedAt filtresi verdiyse ona dokunma (arşiv/geri yükleme ekranları).
  if (typedArgs.where && 'deletedAt' in typedArgs.where) return typedArgs;
  return { ...typedArgs, where: { ...typedArgs.where, deletedAt: null } };
}

const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete-filter',
  query: {
    $allModels: {
      findMany: ({ args, query, model }) => query(withNotDeleted(args, model)),
      findFirst: ({ args, query, model }) => query(withNotDeleted(args, model)),
      findFirstOrThrow: ({ args, query, model }) => query(withNotDeleted(args, model)),
      count: ({ args, query, model }) => query(withNotDeleted(args, model)),
      aggregate: ({ args, query, model }) => query(withNotDeleted(args, model)),
      groupBy: ({ args, query, model }) => query(withNotDeleted(args, model)),
      updateMany: ({ args, query, model }) => query(withNotDeleted(args, model)),
      deleteMany: ({ args, query, model }) => query(withNotDeleted(args, model)),
    },
  },
});

/**
 * Etkileşimli transaction süreleri.
 *
 * Prisma'nın varsayılanı havuzdan bağlantı için 2 sn, işin tamamı için 5 sn.
 * Yoğun saatte (2500 personel) havuz kısa süre dolabilir ve satır kilidi
 * bekleyen iş 5 sn'yi aşabilir; varsayılanlarla bu anlar kullanıcıya
 * "beklenmeyen hata" olarak dönüyordu. Süreler ortamdan ayarlanabilir.
 */
const TRANSACTION_MAX_WAIT_MS = Number(process.env.DB_TRANSACTION_MAX_WAIT_MS ?? 8_000);
const TRANSACTION_TIMEOUT_MS = Number(process.env.DB_TRANSACTION_TIMEOUT_MS ?? 15_000);

/**
 * Filtresiz istemci. Yalnızca silinmiş kayıtları da görmesi gereken yerler
 * (audit, geri yükleme, veri taşıma) bunu kullanır.
 */
export const prismaUnfiltered = new PrismaClient({
  log: ['warn', 'error'],
  transactionOptions: { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS },
});

/** Tüm servislerin kullandığı istemci: soft-delete edilmiş kayıtlar görünmez. */
export const prisma = prismaUnfiltered.$extends(softDeleteExtension);

/**
 * Veritabanı bağlantısını test eder.
 * @returns {Promise<'ok' | 'error'>}
 */
export async function checkDb() {
  try {
    await prismaUnfiltered.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

/** Sunucu kapanırken bağlantı havuzunu temiz bırakır. */
export async function disconnectDb() {
  await prismaUnfiltered.$disconnect();
}

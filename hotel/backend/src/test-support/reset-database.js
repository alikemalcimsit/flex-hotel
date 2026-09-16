import { Prisma } from '@prisma/client';

/**
 * Entegrasyon testleri için veritabanını boşaltır.
 *
 * Her test dosyası kendi tablolarını tek tek silseydi, yeni bir modül yeni bir
 * tablo (ve yabancı anahtar) eklediğinde eski dosyalar "User_hotelId_fkey
 * ihlali" ile kırılırdı — dosyalar sırayla aynı veritabanını kullanıyor.
 * Şemadaki bütün tablolar tek `TRUNCATE ... CASCADE` ile boşaltılır; migration
 * kaydı (`_prisma_migrations`) şemada olmadığı için korunur.
 *
 * ⚠️ Yalnızca test veritabanında çağrılır: adres `TEST_DATABASE_URL`'den gelir.
 *
 * @param {import('@prisma/client').PrismaClient} client
 */
export async function resetDatabase(client) {
  const tables = Prisma.dmmf.datamodel.models.map((model) => `"${model.dbName ?? model.name}"`);
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

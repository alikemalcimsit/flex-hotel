import { PrismaClient } from '@prisma/client';

/** Tek Prisma istemcisi. Tüm servisler bunu kullanır. */
export const prisma = new PrismaClient();

/**
 * Veritabanı bağlantısını test eder.
 * @returns {Promise<'ok' | 'error'>}
 */
export async function checkDb() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

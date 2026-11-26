/**
 * Demo betiklerinin ortak ayarı: hangi otel, rezervasyon kodunun öneki, rastgele üretecin kayması.
 *
 * Varsayılan: seed'in DEMO oteli, `DMO-` öneki. Zincir demosu (modül 63) ikinci örnek oteli aynı betiklerle doldurur:
 * `DEMO_HOTEL_CODE=DEMO-BDR DEMO_CODE_PREFIX=DMB-` (bkz. `demo-chain.mjs`). Önek otel başına farklı olmalı: onay kodu
 * bütün sistemde tekildir.
 */

export const DEMO_HOTEL_CODE = process.env.DEMO_HOTEL_CODE ?? 'DEMO';
export const CODE_PREFIX = process.env.DEMO_CODE_PREFIX ?? 'DMO-';

if (!/^[A-Z]{2,5}-$/.test(CODE_PREFIX)) throw new Error(`DEMO_CODE_PREFIX geçersiz: ${CODE_PREFIX} (ör. DMB-)`);

/**
 * Rastgele üretecin tohumuna eklenen kayma: ikinci otelin misafirleri, fiyatları ve doluluğu ilkinin kopyası olmasın.
 * DEMO için 0 (var olan demo aynı kalsın).
 */
export const SEED_OFFSET = DEMO_HOTEL_CODE === 'DEMO' ? 0 : [...DEMO_HOTEL_CODE].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 1_000_003, 7);

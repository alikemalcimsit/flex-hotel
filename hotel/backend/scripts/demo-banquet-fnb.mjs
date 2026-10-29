import { randomUUID } from 'node:crypto';

/**
 * Banket F&B planlaması demo verisi (modül 43): `demo-data.mjs` banket ve restoran adımlarından
 * sonra çağırır.
 *
 * Kayıtlar **servislerle** üretilir (maliyet, porsiyon, kalem, talep gerçek): gerçekçi malzeme
 * kartları (2026 alış maliyeti, alerjenler), ara ürünler (fond, demi-glace, beşamel, mantı
 * hamuru…), yemekler (bir kısmı restoran ürününe bağlı — kâr marjı tablosu), set menü kataloğu
 * (düğün, gala, toplantı öğle büfesi, kahve arası, kokteyl) ve etkinlik menüleri: yarınki ödül
 * gecesi ile 3 gün sonraki düğün (mutfağa kesin, açık satın alma talebi), kongrenin kahve arası /
 * öğle / kokteyl menüleri (taslak), yönetim kurulunun öğle büfesi (kesin), opsiyonlu nişan (olası).
 * Var olan dosyalarda serbest yiyecek kalemi menüyle değiştirilir (çift fiyat olmaz).
 */

/** [kod, ad, grup, birim, birim maliyet (KDV hariç), alerjenler] */
const STOCK = Object.freeze([
  ['ET-01', 'Kuzu incik', 'MEAT', 'KG', '620', []],
  ['ET-02', 'Kuzu kuşbaşı', 'MEAT', 'KG', '650', []],
  ['ET-03', 'Dana kıyma', 'MEAT', 'KG', '560', []],
  ['ET-04', 'Dana kemik', 'MEAT', 'KG', '45', []],
  ['BE-01', 'Tavuk göğüs', 'POULTRY', 'KG', '210', []],
  ['BE-02', 'Tavuk kemik', 'POULTRY', 'KG', '35', []],
  ['DE-01', 'Levrek (bütün)', 'SEAFOOD', 'KG', '540', ['FISH']],
  ['DE-02', 'Somon fileto', 'SEAFOOD', 'KG', '980', ['FISH']],
  ['DE-03', 'Karides (ayıklanmamış)', 'SEAFOOD', 'KG', '900', ['CRUSTACEANS']],
  ['SU-01', 'Tereyağı', 'DAIRY', 'KG', '410', ['MILK']],
  ['SU-02', 'Süt', 'DAIRY', 'L', '38', ['MILK']],
  ['SU-03', 'Krema', 'DAIRY', 'L', '160', ['MILK']],
  ['SU-04', 'Yoğurt', 'DAIRY', 'KG', '70', ['MILK']],
  ['SU-05', 'Beyaz peynir', 'DAIRY', 'KG', '320', ['MILK']],
  ['SU-06', 'Kaşar', 'DAIRY', 'KG', '380', ['MILK']],
  ['SU-07', 'Labne', 'DAIRY', 'KG', '260', ['MILK']],
  ['SU-08', 'Yumurta', 'DAIRY', 'PIECE', '4.25', ['EGGS']],
  ['SB-01', 'Kuru soğan', 'PRODUCE', 'KG', '18.5', []],
  ['SB-02', 'Sarımsak', 'PRODUCE', 'KG', '160', []],
  ['SB-03', 'Domates', 'PRODUCE', 'KG', '45', []],
  ['SB-04', 'Salatalık', 'PRODUCE', 'KG', '35', []],
  ['SB-05', 'Patlıcan', 'PRODUCE', 'KG', '50', []],
  ['SB-06', 'Patates', 'PRODUCE', 'KG', '22', []],
  ['SB-07', 'Havuç', 'PRODUCE', 'KG', '25', []],
  ['SB-08', 'Kereviz (kök)', 'PRODUCE', 'KG', '40', ['CELERY']],
  ['SB-09', 'Maydanoz (demet)', 'PRODUCE', 'PIECE', '12', []],
  ['SB-10', 'Dereotu (demet)', 'PRODUCE', 'PIECE', '12', []],
  ['SB-11', 'Roka', 'PRODUCE', 'KG', '120', []],
  ['SB-12', 'Göbek marul', 'PRODUCE', 'PIECE', '25', []],
  ['SB-13', 'Limon', 'PRODUCE', 'KG', '40', []],
  ['SB-14', 'Kültür mantarı', 'PRODUCE', 'KG', '140', []],
  ['SB-15', 'Kabak', 'PRODUCE', 'KG', '35', []],
  ['SB-16', 'Sivri biber', 'PRODUCE', 'KG', '60', []],
  ['KG-01', 'Baldo pirinç', 'DRY_GOODS', 'KG', '78', []],
  ['KG-02', 'Kırmızı mercimek', 'DRY_GOODS', 'KG', '62', []],
  ['KG-03', 'Bulgur', 'DRY_GOODS', 'KG', '35', []],
  ['KG-04', 'Un', 'DRY_GOODS', 'KG', '24', ['GLUTEN']],
  ['KG-05', 'Nohut', 'DRY_GOODS', 'KG', '65', []],
  ['KG-06', 'Toz şeker', 'DRY_GOODS', 'KG', '40', []],
  ['KG-07', 'Nişasta', 'DRY_GOODS', 'KG', '70', []],
  ['KG-08', 'Galeta unu', 'DRY_GOODS', 'KG', '60', ['GLUTEN']],
  ['KG-09', 'Antep fıstığı', 'DRY_GOODS', 'KG', '1650', ['NUTS']],
  ['UN-01', 'Yufka (sac)', 'BAKERY', 'PIECE', '18', ['GLUTEN']],
  ['UN-02', 'Baklavalık yufka (paket)', 'BAKERY', 'PIECE', '95', ['GLUTEN']],
  ['UN-03', 'Ekmek (somun)', 'BAKERY', 'PIECE', '15', ['GLUTEN']],
  ['DN-01', 'Mini kruvasan', 'FROZEN', 'PIECE', '9', ['GLUTEN', 'MILK', 'EGGS']],
  ['YS-01', 'Zeytinyağı', 'PANTRY', 'L', '420', []],
  ['YS-02', 'Ayçiçek yağı', 'PANTRY', 'L', '85', []],
  ['YS-03', 'Tahin', 'PANTRY', 'KG', '280', ['SESAME']],
  ['YS-04', 'Domates salçası', 'PANTRY', 'KG', '110', []],
  ['YS-05', 'Biber salçası', 'PANTRY', 'KG', '130', []],
  ['YS-06', 'Tuz', 'PANTRY', 'KG', '12', []],
  ['YS-07', 'Karabiber', 'PANTRY', 'KG', '600', []],
  ['YS-08', 'Pul biber', 'PANTRY', 'KG', '380', []],
  ['YS-09', 'Kuru nane', 'PANTRY', 'KG', '400', []],
  ['YS-10', 'Bitter çikolata', 'PANTRY', 'KG', '620', ['MILK', 'SOY']],
  ['IC-01', 'Kırmızı şarap (mutfak)', 'BEVERAGE', 'L', '260', ['SULPHITES']],
  ['IC-02', 'Filtre kahve', 'BEVERAGE', 'KG', '900', []],
]);

/**
 * Reçeteler (sırayla: ara ürünler önce). Satır: [malzeme ya da reçete adı, miktar, birim, fire %].
 * Yemek: { menu: restoran ürün kodu } kâr marjı için bağlanır.
 */
const RECIPES = Object.freeze([
  { name: 'Esmer fond', kind: 'PREP', station: 'HOT', yield: ['10', 'L'], lead: 720, method: 'Kemikler fırında karartılır, sebzeyle 10–12 saat kaynatılır, süzülür.', lines: [['Dana kemik', '6', 'KG'], ['Kuru soğan', '1', 'KG', '10'], ['Havuç', '500', 'G', '10'], ['Kereviz (kök)', '400', 'G', '20'], ['Domates salçası', '200', 'G']] },
  { name: 'Demi-glace', kind: 'PREP', station: 'HOT', yield: ['5', 'L'], lead: 360, method: 'Fond şarapla yarıya indirilir, tereyağıyla bağlanır.', lines: [['Esmer fond', '8', 'L'], ['Kırmızı şarap (mutfak)', '750', 'ML'], ['Tereyağı', '100', 'G']] },
  { name: 'Tavuk suyu', kind: 'PREP', station: 'HOT', yield: ['10', 'L'], lead: 240, lines: [['Tavuk kemik', '4', 'KG'], ['Kuru soğan', '500', 'G', '10'], ['Havuç', '400', 'G', '10'], ['Kereviz (kök)', '300', 'G', '20']] },
  { name: 'Beşamel', kind: 'PREP', station: 'HOT', yield: ['5', 'L'], lead: 60, lines: [['Süt', '4.5', 'L'], ['Tereyağı', '300', 'G'], ['Un', '300', 'G']] },
  { name: 'Beğendi', kind: 'PREP', station: 'HOT', yield: ['5', 'KG'], lead: 90, method: 'Patlıcan közlenir, beşamel ve kaşarla çırpılır.', lines: [['Patlıcan', '6', 'KG', '45'], ['Beşamel', '2.5', 'L'], ['Kaşar', '400', 'G']] },
  { name: 'Domates sosu', kind: 'PREP', station: 'HOT', yield: ['5', 'L'], lead: 120, lines: [['Domates', '6', 'KG', '10'], ['Zeytinyağı', '200', 'ML'], ['Sarımsak', '80', 'G', '15'], ['Kuru soğan', '500', 'G', '10']] },
  { name: 'Mantı hamuru', kind: 'PREP', station: 'PASTRY', yield: ['5', 'KG'], lead: 180, lines: [['Un', '3.2', 'KG'], ['Yumurta', '10', 'PIECE'], ['Tuz', '40', 'G']] },
  { name: 'Mercimek çorbası', kind: 'DISH', station: 'HOT', yield: ['50'], lead: 120, menu: 'MERCI', lines: [['Kırmızı mercimek', '3', 'KG'], ['Kuru soğan', '800', 'G', '10'], ['Havuç', '500', 'G', '10'], ['Tereyağı', '250', 'G'], ['Tavuk suyu', '8', 'L'], ['Un', '100', 'G']] },
  { name: 'Ezogelin çorbası', kind: 'DISH', station: 'HOT', yield: ['50'], lead: 120, lines: [['Kırmızı mercimek', '2', 'KG'], ['Bulgur', '600', 'G'], ['Baldo pirinç', '400', 'G'], ['Domates salçası', '300', 'G'], ['Biber salçası', '150', 'G'], ['Kuru nane', '30', 'G'], ['Tavuk suyu', '8', 'L']] },
  { name: 'Mevsim salatası', kind: 'DISH', station: 'COLD', yield: ['10'], lead: 90, lines: [['Göbek marul', '3', 'PIECE'], ['Domates', '1', 'KG', '5'], ['Salatalık', '800', 'G', '5'], ['Roka', '300', 'G', '15'], ['Zeytinyağı', '150', 'ML'], ['Limon', '300', 'G', '50']] },
  { name: 'Çoban salata', kind: 'DISH', station: 'COLD', yield: ['10'], lead: 60, menu: 'COBAN', lines: [['Domates', '1.5', 'KG', '5'], ['Salatalık', '1', 'KG', '5'], ['Sivri biber', '300', 'G', '10'], ['Kuru soğan', '300', 'G', '10'], ['Maydanoz (demet)', '1', 'PIECE'], ['Zeytinyağı', '100', 'ML']] },
  { name: 'Humus', kind: 'DISH', station: 'COLD', yield: ['20'], lead: 1440, method: 'Nohut bir gün önceden ıslatılır.', menu: 'HUMUS', lines: [['Nohut', '1.2', 'KG'], ['Tahin', '400', 'G'], ['Limon', '400', 'G', '50'], ['Sarımsak', '50', 'G', '15'], ['Zeytinyağı', '150', 'ML']] },
  { name: 'Haydari', kind: 'DISH', station: 'COLD', yield: ['20'], lead: 120, lines: [['Labne', '1.5', 'KG'], ['Yoğurt', '800', 'G'], ['Sarımsak', '40', 'G', '15'], ['Dereotu (demet)', '2', 'PIECE'], ['Kuru nane', '20', 'G']] },
  { name: 'Paçanga böreği', kind: 'DISH', station: 'HOT', yield: ['20'], lead: 90, lines: [['Yufka (sac)', '6', 'PIECE'], ['Kaşar', '600', 'G'], ['Beyaz peynir', '400', 'G'], ['Sivri biber', '300', 'G', '10'], ['Yumurta', '4', 'PIECE'], ['Ayçiçek yağı', '1', 'L']] },
  { name: 'Fırında kuzu incik', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 180, lines: [['Kuzu incik', '3.5', 'KG', '10'], ['Demi-glace', '1', 'L'], ['Tereyağı', '150', 'G'], ['Kuru soğan', '400', 'G', '20'], ['Sarımsak', '50', 'G', '15']] },
  { name: 'Hünkar beğendi', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 150, lines: [['Kuzu kuşbaşı', '1.6', 'KG', '8'], ['Beğendi', '1.8', 'KG'], ['Domates sosu', '800', 'ML'], ['Kuru soğan', '300', 'G', '10']] },
  { name: 'Izgara levrek', kind: 'DISH', station: 'HOT', yield: ['1'], lead: 30, menu: 'LEVREK', lines: [['Levrek (bütün)', '180', 'G', '50'], ['Limon', '50', 'G', '50'], ['Zeytinyağı', '20', 'ML'], ['Roka', '30', 'G']] },
  { name: 'Fırında somon', kind: 'DISH', station: 'HOT', yield: ['1'], lead: 40, lines: [['Somon fileto', '180', 'G', '5'], ['Tereyağı', '20', 'G'], ['Limon', '40', 'G', '50'], ['Dereotu (demet)', '0.1', 'PIECE']] },
  { name: 'Karides tava', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 45, lines: [['Karides (ayıklanmamış)', '1.2', 'KG', '35'], ['Tereyağı', '100', 'G'], ['Sarımsak', '50', 'G', '15'], ['Pul biber', '10', 'G']] },
  { name: 'Tavuk şiş', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 1440, method: 'Bir gün önceden yoğurtlu marine.', lines: [['Tavuk göğüs', '1.8', 'KG', '5'], ['Yoğurt', '300', 'G'], ['Domates salçası', '50', 'G'], ['Zeytinyağı', '100', 'ML'], ['Pul biber', '10', 'G']] },
  { name: 'Sebzeli mantı', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 240, lines: [['Mantı hamuru', '1.2', 'KG'], ['Kültür mantarı', '600', 'G', '10'], ['Kabak', '400', 'G', '5'], ['Yoğurt', '1', 'KG'], ['Tereyağı', '100', 'G'], ['Domates sosu', '300', 'ML']] },
  { name: 'Kayseri mantısı', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 240, menu: 'MANTI', lines: [['Mantı hamuru', '1.2', 'KG'], ['Dana kıyma', '600', 'G'], ['Kuru soğan', '200', 'G', '10'], ['Yoğurt', '1', 'KG'], ['Tereyağı', '120', 'G'], ['Domates salçası', '50', 'G']] },
  { name: 'Izgara köfte', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 120, menu: 'KOFTE', lines: [['Dana kıyma', '1.6', 'KG'], ['Kuru soğan', '300', 'G', '10'], ['Galeta unu', '100', 'G'], ['Yumurta', '2', 'PIECE'], ['Karabiber', '5', 'G']] },
  { name: 'Tereyağlı pilav', kind: 'DISH', station: 'HOT', yield: ['20'], lead: 60, lines: [['Baldo pirinç', '1.6', 'KG'], ['Tereyağı', '200', 'G'], ['Tavuk suyu', '2.4', 'L']] },
  { name: 'Fırın sebze', kind: 'DISH', station: 'HOT', yield: ['10'], lead: 90, lines: [['Patates', '1.2', 'KG', '15'], ['Kabak', '800', 'G', '5'], ['Havuç', '500', 'G', '10'], ['Sivri biber', '400', 'G', '10'], ['Zeytinyağı', '120', 'ML']] },
  { name: 'Fıstıklı baklava', kind: 'DISH', station: 'PASTRY', yield: ['40'], lead: 2880, method: 'İki gün önceden pişirilir, şerbet çekmesi beklenir.', lines: [['Baklavalık yufka (paket)', '3', 'PIECE'], ['Antep fıstığı', '1.2', 'KG'], ['Tereyağı', '1.2', 'KG'], ['Toz şeker', '2', 'KG'], ['Limon', '100', 'G', '50']] },
  { name: 'Fırın sütlaç', kind: 'DISH', station: 'PASTRY', yield: ['20'], lead: 360, menu: 'SUTLAC', lines: [['Süt', '4', 'L'], ['Baldo pirinç', '250', 'G'], ['Toz şeker', '600', 'G'], ['Nişasta', '80', 'G']] },
  { name: 'Profiterol', kind: 'DISH', station: 'PASTRY', yield: ['20'], lead: 240, lines: [['Un', '350', 'G'], ['Tereyağı', '250', 'G'], ['Yumurta', '8', 'PIECE'], ['Krema', '1', 'L'], ['Bitter çikolata', '400', 'G'], ['Süt', '500', 'ML']] },
  { name: 'Tuzlu kurabiye', kind: 'DISH', station: 'PASTRY', yield: ['30'], lead: 300, lines: [['Un', '1', 'KG'], ['Tereyağı', '500', 'G'], ['Yumurta', '3', 'PIECE'], ['Beyaz peynir', '200', 'G']] },
  { name: 'Mini kruvasan sandviç', kind: 'DISH', station: 'COLD', yield: ['10'], lead: 90, lines: [['Mini kruvasan', '10', 'PIECE'], ['Kaşar', '300', 'G'], ['Domates', '400', 'G', '5'], ['Roka', '100', 'G']] },
  { name: 'Filtre kahve servisi', kind: 'DISH', station: 'BAR', yield: ['50'], lead: 30, lines: [['Filtre kahve', '400', 'G'], ['Süt', '1', 'L']] },
  { name: 'Somonlu kanepe', kind: 'DISH', station: 'COLD', yield: ['20'], lead: 120, lines: [['Ekmek (somun)', '2', 'PIECE'], ['Somon fileto', '300', 'G', '5'], ['Labne', '300', 'G'], ['Dereotu (demet)', '1', 'PIECE']] },
]);

/** Set menüler: kurslar [ad, tür, [[yemek, kişi başı porsiyon]]]. */
const MENUS = Object.freeze([
  {
    code: 'DUGUN-K',
    name: 'Düğün menüsü — klasik',
    price: '1650',
    minGuests: 150,
    courses: [
      ['Çorba', 'ALL', [['Ezogelin çorbası', '1']]],
      ['Ara sıcak', 'ALL', [['Paçanga böreği', '1']]],
      ['Ana yemek', 'CHOICE', [['Fırında kuzu incik', '1'], ['Izgara levrek', '1'], ['Sebzeli mantı', '1']]],
      ['Garnitür', 'ALL', [['Tereyağlı pilav', '1'], ['Fırın sebze', '0.6']]],
      ['Tatlı', 'ALL', [['Fıstıklı baklava', '1']]],
    ],
  },
  {
    code: 'GALA',
    name: 'Gala menüsü',
    price: '1950',
    minGuests: 80,
    courses: [
      ['Başlangıç', 'ALL', [['Humus', '0.5'], ['Haydari', '0.5'], ['Mevsim salatası', '1']]],
      ['Ara sıcak', 'ALL', [['Karides tava', '1']]],
      ['Ana yemek', 'CHOICE', [['Hünkar beğendi', '1'], ['Fırında somon', '1']]],
      ['Tatlı', 'ALL', [['Profiterol', '1']]],
    ],
  },
  {
    code: 'TOPL-OGLE',
    name: 'Toplantı öğle büfesi',
    price: '850',
    minGuests: 20,
    courses: [
      ['Çorba', 'ALL', [['Mercimek çorbası', '1']]],
      ['Soğuk büfe', 'ALL', [['Çoban salata', '0.5'], ['Mevsim salatası', '0.5'], ['Haydari', '0.3']]],
      ['Sıcak büfe', 'ALL', [['Tavuk şiş', '0.6'], ['Izgara köfte', '0.5'], ['Sebzeli mantı', '0.3']]],
      ['Garnitür', 'ALL', [['Tereyağlı pilav', '0.8']]],
      ['Tatlı', 'ALL', [['Fırın sütlaç', '0.6']]],
    ],
  },
  {
    code: 'KAHVE',
    name: 'Kahve arası',
    price: '280',
    courses: [['İkram', 'ALL', [['Filtre kahve servisi', '1.5'], ['Tuzlu kurabiye', '1'], ['Mini kruvasan sandviç', '0.5']]]],
  },
  {
    code: 'KOKTEYL',
    name: 'Kokteyl kanepe',
    price: '650',
    minGuests: 50,
    courses: [['Kanepe ve atıştırmalık', 'ALL', [['Somonlu kanepe', '3'], ['Humus', '0.3'], ['Paçanga böreği', '0.5'], ['Karides tava', '0.3']]]],
  },
]);

/**
 * Demo F&B verisini siler (`--reset`): banket demo etkinlikleri (menüleriyle) silindikten sonra
 * çağrılır. Demo talepler; başka kayıtların kullanmadığı demo set menü, reçete ve malzemeler.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} actor
 */
export async function resetBanquetFnbDemo(tx, hotelId, actor) {
  await tx.$executeRawUnsafe(`DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND "entityType" = 'PurchaseRequest' AND "entityId" IN (SELECT "id" FROM "PurchaseRequest" WHERE "hotelId" = $1 AND "requestedBy" = $2)`, hotelId, actor);
  await tx.$executeRawUnsafe(`DELETE FROM "PurchaseRequest" WHERE "hotelId" = $1 AND "requestedBy" = $2`, hotelId, actor);
  await tx.$executeRawUnsafe(`DELETE FROM "PurchaseSequence" s WHERE s."hotelId" = $1 AND NOT EXISTS (SELECT 1 FROM "PurchaseRequest" r WHERE r."hotelId" = $1)`, hotelId);
  await tx.$executeRawUnsafe(`DELETE FROM "BanquetMenu" WHERE "hotelId" = $1 AND "createdBy" = $2`, hotelId, actor);
  // Demo reçetelerin satırları önce (ara reçete bağları demo kümesinin içinde kalır); personelin menüsü ya da
  // reçetesi bir demo reçeteyi kullanıyorsa o reçete (ve malzemeleri) kalır.
  const keep = `EXISTS (SELECT 1 FROM "EventMenuDish" d WHERE d."recipeId" = r."id")
    OR EXISTS (SELECT 1 FROM "BanquetMenuDish" d WHERE d."recipeId" = r."id")
    OR EXISTS (SELECT 1 FROM "RecipeLine" l JOIN "Recipe" p ON p."id" = l."recipeId" WHERE l."subRecipeId" = r."id" AND p."createdBy" <> $2)`;
  const removable = `SELECT r."id" FROM "Recipe" r WHERE r."hotelId" = $1 AND r."createdBy" = $2 AND NOT (${keep})`;
  await tx.$executeRawUnsafe(`DELETE FROM "RecipeLine" WHERE "recipeId" IN (${removable})`, hotelId, actor);
  await tx.$executeRawUnsafe(`DELETE FROM "Recipe" r WHERE r."hotelId" = $1 AND r."createdBy" = $2 AND NOT (${keep})`, hotelId, actor);
  await tx.$executeRawUnsafe(
    `DELETE FROM "StockItem" s WHERE s."hotelId" = $1 AND s."createdBy" = $2
       AND NOT EXISTS (SELECT 1 FROM "RecipeLine" l WHERE l."stockItemId" = s."id")
       AND NOT EXISTS (SELECT 1 FROM "PurchaseRequestLine" l WHERE l."stockItemId" = s."id")
       AND NOT EXISTS (SELECT 1 FROM "PurchaseRoundLine" l WHERE l."stockItemId" = s."id")
       AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderLine" l WHERE l."stockItemId" = s."id")
       AND NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."stockItemId" = s."id")
       AND NOT EXISTS (SELECT 1 FROM "StockLevel" v WHERE v."stockItemId" = s."id")`,
    hotelId,
    actor,
  );
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string, addDays: (iso: string, n: number) => string }} context
 */
export async function seedBanquetFnbDemo({ prisma, core, contracts, hotelId, today, actor, addDays }) {
  const stock = await import('../src/modules/recipes/stock-items.js');
  const recipes = await import('../src/modules/recipes/recipes.js');
  const menus = await import('../src/modules/banquet/menus.js');
  const events = await import('../src/modules/banquet/events.js');
  const documents = await import('../src/modules/banquet/documents.js');
  const setup = await import('../src/modules/banquet/setup.js');
  const eventMenus = await import('../src/modules/banquet/event-menus.js');
  const fnb = await import('../src/modules/banquet/fnb-read.js');
  const purchasing = await import('../src/modules/purchasing/service.js');

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const wall = (offset, time) => `${addDays(today, offset)}T${time}`;
  const options = { withCost: true };
  const counts = { stockItems: 0, recipes: 0, menus: 0, eventMenus: 0, requests: 0 };

  // ── Politika: fazla hazırlık %5, menü 7 gün önce kesinleşir ──
  const policy = await setup.getSettings(hotelId);
  await as(() =>
    setup.updateSettings(
      hotelId,
      contracts.updateEventSettingsSchema.parse({ ...policy, expectedUpdatedAt: policy.updatedAt, overproductionPct: '5', menuFinalizeDays: 7 }),
    ),
  );

  // ── Malzeme kartları ──
  const item = new Map();
  for (const [code, name, group, unit, unitCost, allergens] of STOCK) {
    item.set(name, await as(() => stock.createStockItem(hotelId, contracts.createStockItemSchema.parse({ code, name, group, unit, unitCost, allergens }))));
    counts.stockItems += 1;
  }

  // ── Reçeteler (ara ürünler önce); restoran ürününe bağlananlar kâr marjı tablosunda ──
  const menuItems = new Map((await prisma.menuItem.findMany({ where: { hotelId, code: { in: RECIPES.map((seed) => seed.menu).filter(Boolean) } }, select: { id: true, code: true } })).map((row) => [row.code, row.id]));
  const recipe = new Map();
  for (const seed of RECIPES) {
    const lines = seed.lines.map(([source, quantity, unit, wastePct = '0']) =>
      item.has(source) ? { stockItemId: item.get(source).id, quantity, unit, wastePct } : { subRecipeId: recipe.get(source).id, quantity, unit, wastePct },
    );
    const created = await as(() =>
      recipes.createRecipe(
        hotelId,
        contracts.createRecipeSchema.parse({
          name: seed.name,
          kind: seed.kind,
          station: seed.station,
          menuItemId: seed.menu ? menuItems.get(seed.menu) ?? null : null,
          yieldQuantity: seed.yield[0],
          yieldUnit: seed.kind === 'DISH' ? 'PORTION' : seed.yield[1],
          leadMinutes: seed.lead,
          method: seed.method ?? null,
          lines,
        }),
      ),
    );
    recipe.set(seed.name, created);
    counts.recipes += 1;
  }

  // ── Set menü kataloğu ──
  const catalog = new Map();
  for (const seed of MENUS) {
    const created = await as(() =>
      menus.createMenu(
        hotelId,
        contracts.createBanquetMenuSchema.parse({
          code: seed.code,
          name: seed.name,
          pricePerPerson: seed.price,
          minGuests: seed.minGuests ?? null,
          courses: seed.courses.map(([name, mode, dishes]) => ({ name, mode, dishes: dishes.map(([dish, portionsPerGuest]) => ({ recipeId: recipe.get(dish).id, portionsPerGuest })) })),
        }),
        options,
      ),
    );
    catalog.set(seed.code, created);
    counts.menus += 1;
  }

  /** Katalog menüsünü oturuma koyar (seçmeli kursta sabit kişiler: `counts` yemek adı → kişi). */
  async function addMenu(event, { code, session, time, day, guests = null, counts: choice = {}, name, price, notes = null }) {
    const current = await events.getEvent(hotelId, event.id);
    const target = current.sessions.find((entry) => entry.title === session);
    const source = catalog.get(code);
    const view = await as(() =>
      eventMenus.saveEventMenu(
        hotelId,
        event.id,
        null,
        contracts.saveEventMenuSchema.parse({
          expectedUpdatedAt: current.updatedAt,
          sessionId: target.id,
          sourceMenuId: source.id,
          name: name ?? source.name,
          serveAt: `${day !== undefined ? addDays(today, day) : target.startLocal.slice(0, 10)}T${time}`,
          guests,
          pricePerPerson: price ?? source.pricePerPerson,
          notes,
          courses: source.courses.map((course) => ({
            name: course.name,
            mode: course.mode,
            dishes: course.dishes.map((dish) => ({ recipeId: dish.recipeId, portionsPerGuest: dish.portionsPerGuest, guestCount: choice[dish.recipe.name] ?? null })),
          })),
        }),
        options,
      ),
    );
    counts.eventMenus += 1;
    return view.menus.at(-1);
  }

  const finalize = async (event, menu) => {
    const current = await events.getEvent(hotelId, event.id);
    return as(() => eventMenus.finalizeEventMenu(hotelId, event.id, menu.id, { expectedUpdatedAt: new Date(current.updatedAt) }, options));
  };

  /** Var olan dosyada serbest yiyecek kalemini kaldırır (menü kalemi yerine geçecek). */
  const dropFreeFood = async (event) => {
    const current = await events.getEvent(hotelId, event.id);
    const rows = current.items
      .filter((row) => !row.eventMenuId && row.category !== 'FNB')
      .map((row) => ({
        category: row.category,
        description: row.description,
        sessionId: row.sessionId,
        equipmentId: row.equipmentId,
        perPerson: row.perPerson,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unitPrice,
        discountPct: row.discountPct,
        taxCategory: row.taxCategory,
      }));
    return as(() => events.saveItems(hotelId, event.id, contracts.saveEventItemsSchema.parse({ expectedUpdatedAt: current.updatedAt, items: rows })));
  };

  /** Yeni kesin etkinlik: oturum, salon kirası, menü, imzalı sözleşme, kesin. */
  async function newDefinite({ name, type, clientName, pax, venueCode, day, start, end, title, rent, menu }) {
    const client =
      (await prisma.eventClient.findFirst({ where: { hotelId, name: clientName }, select: { id: true } })) ??
      (await as(() => setup.createClient(hotelId, contracts.createEventClientSchema.parse({ type: 'PERSON', name: clientName, contactName: clientName }))));
    const venue = await prisma.venue.findFirst({ where: { hotelId, code: venueCode }, select: { id: true } });
    let event = await as(() => events.createEvent(hotelId, contracts.createEventSchema.parse({ name, type, clientId: client.id, expectedPax: pax + 20, guaranteedPax: pax })));
    event = await as(() =>
      events.saveSession(hotelId, event.id, null, contracts.createSessionSchema.parse({ expectedUpdatedAt: event.updatedAt, title, venueId: venue.id, layout: 'BANQUET', pax: pax + 20, startAt: wall(day, start), endAt: wall(day, end) })),
    );
    event = await as(() =>
      events.saveItems(
        hotelId,
        event.id,
        contracts.saveEventItemsSchema.parse({ expectedUpdatedAt: event.updatedAt, items: [{ category: 'VENUE', description: `${title} — salon kirası`, quantity: '1', unit: 'DAY', unitPrice: rent, taxCategory: 'OTHER' }] }),
      ),
    );
    const added = await addMenu(event, menu);
    event = await events.getEvent(hotelId, event.id);
    const contract = await as(() => documents.issueDocument(hotelId, event.id, { expectedUpdatedAt: new Date(event.updatedAt), kind: 'CONTRACT', note: null }));
    await as(() => documents.decideDocument(hotelId, event.id, contract.id, { decision: 'SIGNED' }));
    event = await events.getEvent(hotelId, event.id);
    event = await as(() => events.confirmEvent(hotelId, event.id, { expectedUpdatedAt: new Date(event.updatedAt) }));
    await finalize(event, added);
    return event;
  }

  // 1) Yarınki ödül gecesi (teras): gala menüsü, 40 somon, kalanı beğendi; mutfağa kesin.
  const gala = await newDefinite({
    name: 'Anadolu Sigorta ödül gecesi',
    type: 'GALA',
    clientName: 'Anadolu Sigorta A.Ş.',
    pax: 140,
    venueCode: 'TERAS',
    day: 1,
    start: '19:30',
    end: '23:30',
    title: 'Ödül gecesi yemeği',
    rent: '60000',
    menu: { code: 'GALA', session: 'Ödül gecesi yemeği', time: '20:30', counts: { 'Fırında somon': 40 }, notes: '6 vejetaryen tabak (somon yerine sebzeli mantı); 2 glutensiz.' },
  });

  // 2) Üç gün sonraki düğün (bütün balo salonu): klasik menü, 70 levrek, 18 mantı, kalanı incik; mutfağa kesin.
  const wedding = await newDefinite({
    name: 'Şahin – Öztürk düğünü',
    type: 'WEDDING',
    clientName: 'Mert Şahin',
    pax: 320,
    venueCode: 'BALO',
    day: 3,
    start: '19:00',
    end: '23:59',
    title: 'Düğün yemeği',
    rent: '120000',
    menu: { code: 'DUGUN-K', session: 'Düğün yemeği', time: '20:00', counts: { 'Izgara levrek': 70, 'Sebzeli mantı': 18 }, notes: 'Gelin masası 12 kişi, servis önce gelin masasına.' },
  });

  // 3) Kongre (kesin, 12–13. gün): kahve araları, öğle büfesi, kokteyl — taslak (kesinleştirme günü yaklaşıyor).
  const congress = await prisma.event.findFirst({ where: { hotelId, name: 'Başkent Kardiyoloji Günleri', createdBy: actor }, select: { id: true } });
  if (congress) {
    await dropFreeFood(congress);
    await addMenu(congress, { code: 'KAHVE', session: '1. gün — açılış ve oturumlar', time: '10:30', name: 'Sabah kahve arası (1. gün)' });
    await addMenu(congress, { code: 'TOPL-OGLE', session: '1. gün — açılış ve oturumlar', time: '12:45', name: 'Öğle büfesi (1. gün)', price: '950' });
    await addMenu(congress, { code: 'KAHVE', session: '1. gün — öğleden sonra', time: '15:45', name: 'Öğleden sonra kahve arası (1. gün)' });
    await addMenu(congress, { code: 'KOKTEYL', session: 'Karşılama kokteyli', time: '19:45', guests: 250, price: '850' });
    await addMenu(congress, { code: 'KAHVE', session: '2. gün — kurs A', time: '10:30', guests: 180, name: 'Kahve arası (kurs A)' });
    await addMenu(congress, { code: 'KAHVE', session: '2. gün — kurs B', time: '10:30', guests: 180, name: 'Kahve arası (kurs B)' });
  }

  // 4) Yönetim kurulu (kesin, 6. gün): kahve arası + öğle büfesi; öğle mutfağa kesin.
  const board = await prisma.event.findFirst({ where: { hotelId, name: 'Yeşilırmak Enerji yönetim kurulu', createdBy: actor }, select: { id: true } });
  if (board) {
    await dropFreeFood(board);
    await addMenu(board, { code: 'KAHVE', session: 'Yönetim kurulu', time: '10:30', price: '320' });
    const lunch = await addMenu(board, { code: 'TOPL-OGLE', session: 'Yönetim kurulu', time: '12:30', price: '930', notes: 'Masaya servis (büfe değil).' });
    await finalize(board, lunch);
  }

  // 5) Opsiyonlu nişan (28. gün): klasik menü — ihtiyaç "olası".
  const engagement = await prisma.event.findFirst({ where: { hotelId, name: 'Aydın – Demir nişanı', createdBy: actor }, select: { id: true } });
  if (engagement) {
    await dropFreeFood(engagement);
    await addMenu(engagement, { code: 'DUGUN-K', session: 'Nişan yemeği', time: '20:00', counts: { 'Izgara levrek': 40, 'Sebzeli mantı': 10 } });
  }

  // ── Satın alma: düğünün et / balık / süt ürünü eksikleri talep edildi (kalan eksikler listede görünür) ──
  const weddingView = await fnb.getEventFnb(hotelId, wedding.id, options);
  const ordered = weddingView.needs.filter((row) => ['MEAT', 'SEAFOOD', 'DAIRY'].includes(row.group) && Number(row.shortfall) > 0);
  if (ordered.length) {
    await as(() =>
      purchasing.createFromBanquet(
        hotelId,
        contracts.createBanquetPurchaseRequestSchema.parse({
          eventId: wedding.id,
          note: 'Kasap ve balıkçı siparişi; levrek sabah 08:00 teslim.',
          lines: ordered.map((row) => ({ stockItemId: row.stockItemId, quantity: row.unit === 'PIECE' ? row.shortfall : String(Math.ceil(Number(row.shortfall))), expectedShortfall: row.shortfall })),
        }),
      ),
    );
    counts.requests += 1;
  }
  const galaView = await fnb.getEventFnb(hotelId, gala.id, options);
  const galaShort = galaView.needs.filter((row) => Number(row.shortfall) > 0);
  if (galaShort.length) {
    await as(() =>
      purchasing.createFromBanquet(
        hotelId,
        contracts.createBanquetPurchaseRequestSchema.parse({ eventId: gala.id, note: 'Yarınki ödül gecesinin tamamı.', lines: galaShort.map((row) => ({ stockItemId: row.stockItemId, quantity: row.shortfall, expectedShortfall: row.shortfall })) }),
      ),
    );
    counts.requests += 1;
  }
  return counts;
}

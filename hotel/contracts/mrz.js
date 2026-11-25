import { isValidTurkishIdNumber, normalizeIdNumber } from './front-desk.js';

/**
 * Kimlik / pasaport makine okunur satırı (MRZ, ICAO 9303) — modül 59.
 *
 * Saf kod: tarayıcıdaki okuyucu (OCR sonrası) ve sunucu aynı ayrıştırıcıyı kullanır. Sunucu, istemcinin
 * gönderdiği MRZ metnini **kendisi yeniden ayrıştırıp sağlar**; "kimlikten okundu" işareti istemcinin sözüne
 * değil sağlama hanelerine dayanır. Görüntü hiçbir yere gitmez; MRZ metni de saklanmaz (yalnız doğrulanır).
 *
 * Biçimler:
 * - TD3 (pasaport): 2 × 44
 * - TD2 (bazı kimlik / vize belgeleri): 2 × 36
 * - TD1 (kimlik kartı — yeni TC kimlik kartının arka yüzü dahil): 3 × 30
 *
 * OCR hatalarına karşı: alan türüne göre karakter düzeltmesi (rakam alanında O→0, I→1…; harf alanında tersi),
 * belge numarasında sağlama tutana kadar belirsiz karakterlerin (O/0, I/1, B/8…) denenmesi. Ad alanlarının
 * sağlaması yoktur — personel okunanı onaylar (karar: farklar gösterilir, personel seçer).
 */

/** Biçim → satır sayısı × uzunluk. */
export const MRZ_FORMATS = Object.freeze({
  TD1: { lines: 3, length: 30 },
  TD2: { lines: 2, length: 36 },
  TD3: { lines: 2, length: 44 },
});

/** OCR'ın fazladan okuduğu dolgu payı (karakter): dolgu geri kurulup en uzun dizi kısaltılır. */
const LENGTH_TOLERANCE = 10;
/** Belge numarasında denenecek en fazla belirsiz karakter (2^n deneme). */
const MAX_AMBIGUOUS_POSITIONS = 8;

/** ICAO 3 harfli devlet kodu → ISO 3166 alfa-2 (otelin uyruk listesi). */
const ALPHA3_TO_ALPHA2 = Object.freeze(
  Object.fromEntries(
    (
      'AND:AD ARE:AE AFG:AF ATG:AG AIA:AI ALB:AL ARM:AM AGO:AO ATA:AQ ARG:AR ASM:AS AUT:AT AUS:AU ABW:AW ALA:AX ' +
      'AZE:AZ BIH:BA BRB:BB BGD:BD BEL:BE BFA:BF BGR:BG BHR:BH BDI:BI BEN:BJ BLM:BL BMU:BM BRN:BN BOL:BO BES:BQ ' +
      'BRA:BR BHS:BS BTN:BT BVT:BV BWA:BW BLR:BY BLZ:BZ CAN:CA CCK:CC COD:CD CAF:CF COG:CG CHE:CH CIV:CI COK:CK ' +
      'CHL:CL CMR:CM CHN:CN COL:CO CRI:CR CUB:CU CPV:CV CUW:CW CXR:CX CYP:CY CZE:CZ DEU:DE DJI:DJ DNK:DK DMA:DM ' +
      'DOM:DO DZA:DZ ECU:EC EST:EE EGY:EG ESH:EH ERI:ER ESP:ES ETH:ET FIN:FI FJI:FJ FLK:FK FSM:FM FRO:FO FRA:FR ' +
      'GAB:GA GBR:GB GRD:GD GEO:GE GUF:GF GGY:GG GHA:GH GIB:GI GRL:GL GMB:GM GIN:GN GLP:GP GNQ:GQ GRC:GR SGS:GS ' +
      'GTM:GT GUM:GU GNB:GW GUY:GY HKG:HK HMD:HM HND:HN HRV:HR HTI:HT HUN:HU IDN:ID IRL:IE ISR:IL IMN:IM IND:IN ' +
      'IOT:IO IRQ:IQ IRN:IR ISL:IS ITA:IT JEY:JE JAM:JM JOR:JO JPN:JP KEN:KE KGZ:KG KHM:KH KIR:KI COM:KM KNA:KN ' +
      'PRK:KP KOR:KR KWT:KW CYM:KY KAZ:KZ LAO:LA LBN:LB LCA:LC LIE:LI LKA:LK LBR:LR LSO:LS LTU:LT LUX:LU LVA:LV ' +
      'LBY:LY MAR:MA MCO:MC MDA:MD MNE:ME MAF:MF MDG:MG MHL:MH MKD:MK MLI:ML MMR:MM MNG:MN MAC:MO MNP:MP MTQ:MQ ' +
      'MRT:MR MSR:MS MLT:MT MUS:MU MDV:MV MWI:MW MEX:MX MYS:MY MOZ:MZ NAM:NA NCL:NC NER:NE NFK:NF NGA:NG NIC:NI ' +
      'NLD:NL NOR:NO NPL:NP NRU:NR NIU:NU NZL:NZ OMN:OM PAN:PA PER:PE PYF:PF PNG:PG PHL:PH PAK:PK POL:PL SPM:PM ' +
      'PCN:PN PRI:PR PSE:PS PRT:PT PLW:PW PRY:PY QAT:QA REU:RE ROU:RO SRB:RS RUS:RU RWA:RW SAU:SA SLB:SB SYC:SC ' +
      'SDN:SD SWE:SE SGP:SG SHN:SH SVN:SI SJM:SJ SVK:SK SLE:SL SMR:SM SEN:SN SOM:SO SUR:SR SSD:SS STP:ST SLV:SV ' +
      'SXM:SX SYR:SY SWZ:SZ TCA:TC TCD:TD ATF:TF TGO:TG THA:TH TJK:TJ TKL:TK TLS:TL TKM:TM TUN:TN TON:TO TUR:TR ' +
      'TTO:TT TUV:TV TWN:TW TZA:TZ UKR:UA UGA:UG UMI:UM USA:US URY:UY UZB:UZ VAT:VA VCT:VC VEN:VE VGB:VG VIR:VI ' +
      'VNM:VN VUT:VU WLF:WF WSM:WS YEM:YE MYT:YT ZAF:ZA ZMB:ZM ZWE:ZW ' +
      // ICAO'ya özgü kodlar: Almanya "D", İngiliz uyrukluk türleri, Kosova.
      'D:DE GBD:GB GBN:GB GBO:GB GBP:GB GBS:GB RKS:XK UNK:XK'
    )
      .split(' ')
      .map((pair) => pair.split(':')),
  ),
);

/** Haritada olan kodlar (test: otelin uyruk listesiyle karşılaştırılır). */
export const MRZ_COUNTRY_CODES = Object.freeze(Object.keys(ALPHA3_TO_ALPHA2));

/**
 * Devlet kodunu ISO alfa-2'ye çevirir; vatansız (XXA…), BM, AB gibi kodlar `null`.
 * @param {string} code dolgulu olabilir ("D<<")
 */
export function mrzCountryToIso(code) {
  return ALPHA3_TO_ALPHA2[String(code ?? '').replace(/</g, '')] ?? null;
}

const charValue = (char) => {
  if (char === '<') return 0;
  if (char >= '0' && char <= '9') return char.charCodeAt(0) - 48;
  if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 55;
  return NaN;
};

/**
 * ICAO sağlama hanesi (ağırlık 7-3-1, '<' = 0, A = 10 … Z = 35).
 * @param {string} text
 * @returns {number}
 */
export function mrzCheckDigit(text) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let index = 0; index < text.length; index += 1) {
    const value = charValue(text[index]);
    if (Number.isNaN(value)) return NaN;
    sum += value * weights[index % 3];
  }
  return sum % 10;
}

/** Alan sağlaması: hane '<' ise alan boş olmalı. */
const checks = (field, digit) => (digit === '<' ? /^<*$/.test(field) : mrzCheckDigit(field) === Number(digit));

const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', G: '6', B: '8' };
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 8: 'B', 4: 'A', 7: 'T' };
/** Belge numarasında karıştırılan çiftler (iki yönlü). */
const AMBIGUOUS = { O: '0', 0: 'O', D: '0', Q: '0', I: '1', 1: 'I', B: '8', 8: 'B', S: '5', 5: 'S', Z: '2', 2: 'Z', G: '6', 6: 'G' };

const digits = (text) => text.replace(/[A-Z]/g, (char) => TO_DIGIT[char] ?? char);
const letters = (text) => text.replace(/[0-9]/g, (char) => TO_LETTER[char] ?? char);
/** Sağlama hanesi: rakam ya da (boş alan için) '<'. */
const checkChar = (char) => (char === '<' ? '<' : digits(char));

/**
 * OCR metnini MRZ alfabesine indirir: büyük harf, '<' benzerleri, boşluksuz.
 * @param {string} line
 */
export function normalizeMrzLine(line) {
  return String(line ?? '')
    .toUpperCase()
    .replace(/«/g, '<<')
    .replace(/[‹(\[{]/g, '<')
    .replace(/[^A-Z0-9<]/g, '');
}

/** Ad satırı mı (biçime göre)? Ad satırında K / L harf olabilir; dolgu yalnız sondaki '<' ile başlayan dizidir. */
const NAME_LINE = { TD1: 2, TD2: 0, TD3: 0 };

/**
 * OCR dolguyu ('<') sıkça K ya da L okur ve dizinin bir kısmını yutar. Veri satırında: '<' ile başlayan, en az
 * iki '<' içeren [<KL] dizileri ve 4+ uzunluktaki [<KL] dizileri dolgudur (belge / kişisel numarada art arda dört
 * K/L olmaz). Ad satırında yalnız sondaki '<' ile başlayan dizi — "MARIE<<KLEIN"deki KL ad harfidir.
 * @param {string} line @param {boolean} names
 */
export function restoreMrzFillers(line, names) {
  const fill = (run) => '<'.repeat(run.length);
  if (names) return line.replace(/<[<KL]*$/, fill);
  return line
    .replace(/<[<KL]{2,}/g, (run) => ((run.match(/</g) ?? []).length >= 2 ? fill(run) : run))
    .replace(/[<KL]{4,}/g, fill);
}

/**
 * Satırı biçim uzunluğuna getirir. Eksik ya da fazla karakter dolgudan gelmiştir: en uzun '<' dizisi uzatılır /
 * kısaltılır (sağlama haneleri yerinde kalır); dizi yoksa sondan tamamlanır / kırpılır.
 * @param {string} line @param {number} length
 */
export function fitMrzLine(line, length) {
  const delta = length - line.length;
  if (delta === 0) return line;
  let best = null;
  for (const match of line.matchAll(/<+/g)) if (!best || match[0].length > best[0].length) best = match;
  if (best && (delta > 0 || best[0].length + delta >= 1)) {
    const run = '<'.repeat(best[0].length + delta);
    return line.slice(0, best.index) + run + line.slice(best.index + best[0].length);
  }
  return delta > 0 ? line.padEnd(length, '<') : line.slice(0, length);
}

/** OCR'ın yuttuğu / eklediği dolgu payı (karakter). */
const SHORT_TOLERANCE = 10;

/**
 * Serbest OCR metninden MRZ satırlarını bulur. Satırlar alttan yukarı aranır (MRZ belgenin altındadır). OCR
 * dolguyu K / L okur ve kısaltır: dolgu geri kurulur, uzunluk en uzun dolgu dizisinden düzeltilir.
 *
 * @param {string} text OCR çıktısı (çok satırlı)
 * @returns {{ format: keyof typeof MRZ_FORMATS, lines: string[] } | null}
 */
export function findMrzLines(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(normalizeMrzLine)
    .filter((line) => line.length >= MRZ_FORMATS.TD1.length - SHORT_TOLERANCE);
  const near = (line, length) => line.length >= length - SHORT_TOLERANCE && line.length <= length + LENGTH_TOLERANCE;
  const looksMrz = (line) => /<{2,}|<[KL<]{3,}/.test(line);
  for (let end = lines.length; end >= 2; end -= 1) {
    for (const format of /** @type {const} */ (['TD3', 'TD2', 'TD1'])) {
      const { lines: count, length } = MRZ_FORMATS[format];
      const start = end - count;
      if (start < 0) continue;
      const group = lines.slice(start, end);
      if (!group.every((line) => near(line, length))) continue;
      if (!group.some(looksMrz)) continue;
      if (!/^[PIACV]/.test(letters(group[0][0]))) continue;
      const fitted = group.map((line, index) => fitMrzLine(restoreMrzFillers(line, index === NAME_LINE[format]), length));
      // Kısa satırlar birden çok biçime uyabilir (TD2 / TD1): veri satırının sağlaması tutan biçim seçilir.
      const probe = parseMrz(fitted, { today: '2000-01-01' });
      if (!probe || (!probe.checks.birthDate && !probe.checks.expiryDate)) continue;
      return { format, lines: fitted };
    }
  }
  return null;
}

/**
 * Belge numarasını sağlamasına göre düzeltir: önce olduğu gibi, sonra belirsiz karakterlerin karşılıkları — en az
 * değişiklikten başlayarak. Tek hanelik sağlama rastlantıyla 1/10 tutar; bu yüzden aday satırın birleşik
 * sağlamasını da tutturmalı (`accept`), aksi halde düzeltme yapılmaz.
 * @param {string} raw @param {string} digit @param {(candidate: string) => boolean} accept
 * @returns {{ value: string, valid: boolean, corrected: boolean }}
 */
function resolveDocumentNumber(raw, digit, accept) {
  if (checks(raw, digit)) return { value: raw, valid: true, corrected: false };
  const positions = [];
  for (let index = 0; index < raw.length; index += 1) if (AMBIGUOUS[raw[index]]) positions.push(index);
  if (positions.length === 0 || positions.length > MAX_AMBIGUOUS_POSITIONS) return { value: raw, valid: false, corrected: false };
  const masks = Array.from({ length: (1 << positions.length) - 1 }, (_, index) => index + 1);
  const flips = (mask) => mask.toString(2).replace(/0/g, '').length;
  masks.sort((left, right) => flips(left) - flips(right) || left - right);
  for (const mask of masks) {
    const chars = raw.split('');
    positions.forEach((position, bit) => {
      if (mask & (1 << bit)) chars[position] = AMBIGUOUS[chars[position]];
    });
    const candidate = chars.join('');
    if (checks(candidate, digit) && accept(candidate)) return { value: candidate, valid: true, corrected: true };
  }
  return { value: raw, valid: false, corrected: false };
}

/**
 * YYMMDD → ISO gün. Doğum: gelecekteki yıl geçen yüzyıldır; son kullanma: hep 2000'ler.
 * @param {string} text @param {'birth' | 'expiry'} kind @param {string} today YYYY-MM-DD
 * @returns {string | null}
 */
export function mrzDate(text, kind, today) {
  if (!/^\d{6}$/.test(text)) return null;
  const yy = Number(text.slice(0, 2));
  const month = Number(text.slice(2, 4));
  const day = Number(text.slice(4, 6));
  const currentYy = Number(today.slice(2, 4));
  const century = kind === 'expiry' ? 2000 : yy > currentYy ? 1900 : 2000;
  const year = century + yy;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  // 31 Şubat gibi olmayan günler reddedilir (Date taşırır).
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** "OZTURK<<AHMET<YUSUF" → { surname: "OZTURK", givenNames: "AHMET YUSUF" }. */
function splitName(field) {
  const clean = letters(field).replace(/<+$/, '');
  const [surname = '', ...rest] = clean.split('<<');
  const tidy = (text) => text.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  return { surname: tidy(surname), givenNames: tidy(rest.join(' ')), truncated: !field.endsWith('<') };
}

const DOCUMENT_TYPES = { P: 'PASSPORT', I: 'NATIONAL_ID', A: 'NATIONAL_ID', C: 'NATIONAL_ID' };

/**
 * @typedef {{
 *   format: 'TD1' | 'TD2' | 'TD3',
 *   documentCode: string,
 *   documentType: 'PASSPORT' | 'NATIONAL_ID' | 'OTHER',
 *   issuingState: string | null,
 *   documentNumber: string,
 *   nationality: string | null,
 *   nationalityCode: string,
 *   birthDate: string | null,
 *   expiryDate: string | null,
 *   sex: 'M' | 'F' | null,
 *   surname: string,
 *   givenNames: string,
 *   nameTruncated: boolean,
 *   turkishIdNumber: string | null,
 *   checks: { documentNumber: boolean, birthDate: boolean, expiryDate: boolean, personalNumber: boolean, composite: boolean },
 *   valid: boolean,
 *   corrected: boolean,
 *   expired: boolean,
 * }} ParsedMrz
 */

/**
 * Satırları alanlara ayırır ve sağlar.
 * @param {string[]} rawLines biçim uzunluğunda (bkz. `findMrzLines`)
 * @param {{ today: string }} options otelin bugünü (YYYY-MM-DD): yüzyıl ve süre kontrolü
 * @returns {ParsedMrz | null} biçim tanınmazsa null
 */
export function parseMrz(rawLines, { today }) {
  const lines = rawLines.map(normalizeMrzLine);
  const format = /** @type {const} */ (['TD1', 'TD2', 'TD3']).find(
    (name) => MRZ_FORMATS[name].lines === lines.length && lines.every((line) => line.length === MRZ_FORMATS[name].length),
  );
  if (!format) return null;

  let documentCode, issuing, numberField, numberDigit, optional1 = '', birth, birthDigit, sex, expiry, expiryDigit, nationality, optional2 = '', compositeDigit, compositeText, nameField, personalDigit = null;
  if (format === 'TD1') {
    const [a, b, c] = lines;
    documentCode = letters(a.slice(0, 2));
    issuing = letters(a.slice(2, 5));
    numberField = a.slice(5, 14);
    numberDigit = checkChar(a[14]);
    optional1 = a.slice(15, 30);
    birth = digits(b.slice(0, 6));
    birthDigit = checkChar(b[6]);
    sex = letters(b[7]);
    expiry = digits(b.slice(8, 14));
    expiryDigit = checkChar(b[14]);
    nationality = letters(b.slice(15, 18));
    optional2 = b.slice(18, 29);
    compositeDigit = checkChar(b[29]);
    nameField = c;
    // Uzun belge numarası: sağlama yerinde '<' varsa numara isteğe bağlı alanda sürer, sağlaması onun sonunda.
    if (numberDigit === '<' && /[0-9A-Z]/.test(optional1[0])) {
      const end = optional1.indexOf('<');
      const tail = end < 0 ? optional1 : optional1.slice(0, end);
      numberField += tail.slice(0, -1);
      numberDigit = checkChar(tail.slice(-1));
    }
    const firstDigit = checkChar(a[14]);
    // Birleşik sağlama satır 1'in 6–30. karakterlerini kapsar: düzeltilmiş belge numarası ve hanesiyle kurulur.
    compositeText = (number) => `${number.slice(0, 9)}${firstDigit}${optional1}${birth}${birthDigit}${expiry}${expiryDigit}${optional2}`;
  } else {
    const [a, b] = lines;
    documentCode = letters(a.slice(0, 2));
    issuing = letters(a.slice(2, 5));
    nameField = a.slice(5);
    numberField = b.slice(0, 9);
    numberDigit = checkChar(b[9]);
    nationality = letters(b.slice(10, 13));
    birth = digits(b.slice(13, 19));
    birthDigit = checkChar(b[19]);
    sex = letters(b[20]);
    expiry = digits(b.slice(21, 27));
    expiryDigit = checkChar(b[27]);
    if (format === 'TD3') {
      optional2 = b.slice(28, 42);
      personalDigit = checkChar(b[42]);
      compositeDigit = checkChar(b[43]);
    } else {
      optional2 = b.slice(28, 35);
      compositeDigit = checkChar(b[35]);
    }
    compositeText = (number) =>
      format === 'TD3'
        ? `${number}${numberDigit}${birth}${birthDigit}${expiry}${expiryDigit}${optional2}${personalDigit}`
        : `${number}${numberDigit}${birth}${birthDigit}${expiry}${expiryDigit}${optional2}`;
  }

  const number = resolveDocumentNumber(numberField, numberDigit, (candidate) => checks(compositeText(candidate), compositeDigit));
  const documentNumber = number.value.replace(/</g, '');
  const composite = checks(compositeText(number.value), compositeDigit);
  const personalNumber = format === 'TD3' ? checks(optional2, personalDigit) : true;
  const birthDate = mrzDate(birth, 'birth', today);
  const expiryDate = mrzDate(expiry, 'expiry', today);
  const result = {
    checks: {
      documentNumber: number.valid,
      birthDate: checks(birth, birthDigit) && birthDate !== null,
      expiryDate: checks(expiry, expiryDigit) && expiryDate !== null,
      personalNumber,
      composite,
    },
  };
  const name = splitName(nameField);
  const nationalityIso = mrzCountryToIso(nationality);
  // TC kimlik no: kimlik kartında isteğe bağlı alanda, Türk pasaportunda kişisel numara alanında (11 hane, sağlamalı).
  const turkishIdNumber =
    nationalityIso === 'TR'
      ? [optional1, optional2].map((field) => digits(field).match(/\d{11}/g) ?? []).flat().find((candidate) => isValidTurkishIdNumber(candidate)) ?? null
      : null;
  // Birleşik sağlama yalnız isteğe bağlı alanları ek olarak korur; asıl alanların kendi sağlaması var. OCR son
  // haneyi sık bozar: isteğe bağlı veri boşsa ya da sağlamalı TC no ise (pasaportta kişisel numaranın kendi
  // sağlaması var) birleşik sağlamanın tutmaması okumayı geçersiz kılmaz.
  const optionalVerified =
    format === 'TD3'
      ? result.checks.personalNumber
      : [optional1, optional2].every((field) => /^<*$/.test(field) || (turkishIdNumber !== null && field.replace(/</g, '') === turkishIdNumber));
  const valid = result.checks.documentNumber && result.checks.birthDate && result.checks.expiryDate && result.checks.personalNumber && (result.checks.composite || optionalVerified);
  return {
    format,
    documentCode: documentCode.replace(/</g, ''),
    documentType: DOCUMENT_TYPES[documentCode[0]] ?? 'OTHER',
    issuingState: mrzCountryToIso(issuing),
    documentNumber,
    nationality: nationalityIso,
    nationalityCode: nationality.replace(/</g, ''),
    birthDate,
    expiryDate,
    sex: sex === 'M' || sex === 'F' ? sex : null,
    surname: name.surname,
    givenNames: name.givenNames,
    nameTruncated: name.truncated,
    turkishIdNumber,
    checks: result.checks,
    optionalVerified,
    valid,
    corrected: number.corrected,
    expired: Boolean(expiryDate && expiryDate < today),
  };
}

/**
 * Serbest metin (OCR ya da istemcinin gönderdiği satırlar) → ayrıştırılmış MRZ.
 * @param {string} text @param {{ today: string }} options
 * @returns {ParsedMrz | null}
 */
export function readMrz(text, options) {
  const found = findMrzLines(text);
  return found ? parseMrz(found.lines, options) : null;
}

/** MRZ adını kartın biçimine çevirir: "AHMET YUSUF" → "Ahmet Yusuf" (MRZ'de Türkçe harf yoktur; personel düzeltir). */
export function mrzNameCase(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, gap, char) => `${gap}${char.toUpperCase()}`);
}

/** Türkçe harfleri MRZ alfabesine indirger, karşılaştırma anahtarı. "Öztürk İpek" → "OZTURKIPEK". */
export function foldMrzName(text) {
  return String(text ?? '')
    .replace(/[İIı]/g, 'I')
    .replace(/[Şş]/g, 'S')
    .replace(/[Ğğ]/g, 'G')
    .replace(/[Üü]/g, 'U')
    .replace(/[Öö]/g, 'O')
    .replace(/[Çç]/g, 'C')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/**
 * Karttaki ad MRZ'dekiyle aynı kişi mi? Türkçe harf ve boşluk farkı yok sayılır; MRZ ad alanı dolmuşsa (kırpılmış)
 * baş eşleşmesi yeter.
 * @param {{ firstName: string, lastName: string }} record @param {ParsedMrz} mrz
 */
export function sameMrzName(record, mrz) {
  const recordKey = foldMrzName(`${record.lastName}${record.firstName}`);
  const mrzKey = foldMrzName(`${mrz.surname}${mrz.givenNames}`);
  if (!mrzKey) return false;
  if (mrz.nameTruncated ? recordKey.startsWith(mrzKey) : recordKey === mrzKey) return true;
  // OCR ayıracı ('<<' ya da ad arası '<') K / L okuyabilir ("ARSLAN<<ELIF" → "ARSLANKLLKELIF"): kartın soyad ve ad
  // parçaları sırayla, aralarında yalnız K / L ile okunmuşsa aynı kişi sayılır.
  const tokens = [record.lastName, ...String(record.firstName ?? '').split(/\s+/)].map(foldMrzName).filter(Boolean);
  if (tokens.length < 2) return false;
  const pattern = new RegExp(`^${tokens.join('[KL]*')}[KL]*$`);
  return pattern.test(mrzKey);
}

/**
 * MRZ'den kayda yazılacak kimlik. Türk vatandaşında KBS anahtarı TC kimlik numarasıdır: belge pasaport olsa da
 * TC no varsa kimlik türü "Kimlik kartı / TC no" olur (girişin mevcut kuralı); TC no okunamazsa belge numarası.
 * @param {ParsedMrz} mrz
 * @returns {{ idType: 'NATIONAL_ID' | 'PASSPORT' | 'OTHER', idNumber: string, nationality: string | null, birthDate: string | null, firstName: string, lastName: string }}
 */
export function mrzIdentity(mrz) {
  const turkish = mrz.nationality === 'TR' && mrz.turkishIdNumber;
  return {
    idType: turkish ? 'NATIONAL_ID' : mrz.documentType,
    idNumber: normalizeIdNumber(turkish ? mrz.turkishIdNumber : mrz.documentNumber) ?? '',
    nationality: mrz.nationality,
    birthDate: mrz.birthDate,
    firstName: mrzNameCase(mrz.givenNames),
    lastName: mrzNameCase(mrz.surname),
  };
}

/** Okumanın kabul edilmesine engel sebepler (boşsa okunan kullanılabilir). @param {ParsedMrz} mrz */
export function mrzProblems(mrz) {
  const problems = [];
  if (!mrz.checks.documentNumber) problems.push('Belge numarası sağlaması tutmadı');
  if (!mrz.checks.birthDate) problems.push('Doğum tarihi okunamadı');
  if (!mrz.checks.expiryDate) problems.push('Son kullanma tarihi okunamadı');
  if (!mrz.checks.personalNumber) problems.push('Kişisel numara sağlaması tutmadı');
  if (!mrz.checks.composite && !mrz.optionalVerified) problems.push('Satırın genel sağlaması tutmadı');
  if (!mrz.nationality) problems.push(`Uyruk kodu (${mrz.nationalityCode || '?'}) tanınmadı`);
  if (mrz.nationality === 'TR' && mrz.documentType === 'NATIONAL_ID' && !mrz.turkishIdNumber) problems.push('TC kimlik numarası okunamadı');
  return problems;
}

/**
 * Sunucu doğrulaması: gönderilen kimlik alanları MRZ'den çıkanla aynı mı? "Kimlikten okundu" işareti yalnız
 * sağlamaları tutan ve alanları değiştirilmemiş okumaya verilir.
 *
 * @param {string} text istemcinin gönderdiği MRZ satırları
 * @param {{ idType?: string | null, idNumber?: string | null, nationality?: string | null, birthDate?: string | null }} identity
 * @param {{ today: string }} options
 * @returns {{ ok: true, mrz: ParsedMrz } | { ok: false, reason: string }}
 */
export function verifyMrzIdentity(text, identity, options) {
  const mrz = readMrz(text, options);
  if (!mrz) return { ok: false, reason: 'Makine okunur satır (MRZ) tanınmadı' };
  const problems = mrzProblems(mrz);
  if (problems.length) return { ok: false, reason: `Kimlik okuması doğrulanamadı: ${problems.join('; ')}` };
  const expected = mrzIdentity(mrz);
  const changed = [];
  if (identity.idType !== expected.idType) changed.push('belge türü');
  if (normalizeIdNumber(identity.idNumber) !== expected.idNumber) changed.push('belge numarası');
  if ((identity.nationality ?? null) !== expected.nationality) changed.push('uyruk');
  if ((identity.birthDate ?? null) !== expected.birthDate) changed.push('doğum tarihi');
  if (changed.length) {
    return { ok: false, reason: `Kimlikten okunan bilgiler değiştirilmiş (${changed.join(', ')}). Okunanı kullanın ya da okumayı kaldırıp elle girin.` };
  }
  return { ok: true, mrz };
}

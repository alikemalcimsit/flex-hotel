import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COUNTRY_CODES } from './front-desk.js';
import {
  MRZ_COUNTRY_CODES,
  findMrzLines,
  fitMrzLine,
  foldMrzName,
  mrzCheckDigit,
  mrzCountryToIso,
  mrzDate,
  mrzIdentity,
  mrzNameCase,
  mrzProblems,
  normalizeMrzLine,
  parseMrz,
  readMrz,
  restoreMrzFillers,
  sameMrzName,
  verifyMrzIdentity,
} from './mrz.js';

const TODAY = '2026-11-25';
const opts = { today: TODAY };

// ICAO 9303 örnek belgeleri (Utopia "UTO" kurgusal devlet).
const ICAO_TD3 = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];
const ICAO_TD1 = ['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'];
const ICAO_TD2 = ['I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<', 'D231458907UTO7408122F1204159<<<<<<<6'];

/** Sağlamaları hesaplanmış kurgusal yeni TC kimlik kartı (arka yüz, TD1). */
function turkishIdCard({ docNumber = 'A01B23456', tckn = '10000000146', birth = '900115', sex = 'M', expiry = '310101', name = 'OZTURK<<AHMET<YUSUF' } = {}) {
  const d = (text) => String(mrzCheckDigit(text));
  const optional1 = `${tckn}`.padEnd(15, '<');
  const line1 = `I<TUR${docNumber}${d(docNumber)}${optional1}`;
  const optional2 = '<'.repeat(11);
  const body = `${birth}${d(birth)}${sex}${expiry}${d(expiry)}TUR${optional2}`;
  const composite = d(`${line1.slice(5, 30)}${birth}${d(birth)}${expiry}${d(expiry)}${optional2}`);
  return [line1, `${body}${composite}`, name.padEnd(30, '<')];
}

/** Sağlamaları hesaplanmış kurgusal pasaport (TD3). */
function passport({ country = 'DEU', nationality = country, docNumber = 'C01X00T47', birth = '850316', sex = 'F', expiry = '330110', personal = '', name = 'MUSTERMANN<<ERIKA' } = {}) {
  const d = (text) => String(mrzCheckDigit(text));
  const personalField = personal.padEnd(14, '<');
  const personalDigit = /^<*$/.test(personalField) ? '<' : d(personalField);
  const head = `${docNumber}${d(docNumber)}${nationality.padEnd(3, '<')}${birth}${d(birth)}${sex}${expiry}${d(expiry)}${personalField}${personalDigit}`;
  const composite = d(`${docNumber}${d(docNumber)}${birth}${d(birth)}${expiry}${d(expiry)}${personalField}${personalDigit}`);
  return [`P<${country.padEnd(3, '<')}${name}`.padEnd(44, '<'), `${head}${composite}`];
}

describe('MRZ (modül 59)', () => {
  describe('sağlama hanesi', () => {
    it('ICAO 7-3-1 ağırlıkları, harf ve dolgu değerleri', () => {
      assert.equal(mrzCheckDigit('L898902C3'), 6);
      assert.equal(mrzCheckDigit('740812'), 2);
      assert.equal(mrzCheckDigit('120415'), 9);
      assert.equal(mrzCheckDigit('ZE184226B<<<<<'), 1);
      assert.equal(mrzCheckDigit('D23145890'), 7);
      assert.equal(mrzCheckDigit('<<<'), 0);
      assert.ok(Number.isNaN(mrzCheckDigit('ab')));
    });
  });

  describe('ICAO örnek belgeleri', () => {
    it('TD3 pasaport: alanlar ve bütün sağlamalar', () => {
      const mrz = parseMrz(ICAO_TD3, opts);
      assert.equal(mrz.format, 'TD3');
      assert.equal(mrz.documentType, 'PASSPORT');
      assert.equal(mrz.documentNumber, 'L898902C3');
      assert.equal(mrz.birthDate, '1974-08-12');
      assert.equal(mrz.expiryDate, '2012-04-15');
      assert.equal(mrz.sex, 'F');
      assert.equal(mrz.surname, 'ERIKSSON');
      assert.equal(mrz.givenNames, 'ANNA MARIA');
      assert.deepEqual(mrz.checks, { documentNumber: true, birthDate: true, expiryDate: true, personalNumber: true, composite: true });
      assert.equal(mrz.valid, true);
      assert.equal(mrz.expired, true);
      // Utopia gerçek devlet değil: uyruk tanınmaz, kayda yazılamaz.
      assert.equal(mrz.nationality, null);
      assert.deepEqual(mrzProblems(mrz), ['Uyruk kodu (UTO) tanınmadı']);
    });

    it('TD1 kimlik kartı ve TD2', () => {
      const td1 = parseMrz(ICAO_TD1, opts);
      assert.equal(td1.format, 'TD1');
      assert.equal(td1.documentType, 'NATIONAL_ID');
      assert.equal(td1.documentNumber, 'D23145890');
      assert.equal(td1.valid, true);
      assert.equal(td1.surname, 'ERIKSSON');
      const td2 = parseMrz(ICAO_TD2, opts);
      assert.equal(td2.format, 'TD2');
      assert.equal(td2.documentNumber, 'D23145890');
      assert.equal(td2.valid, true);
    });

    it('bozuk sağlama yakalanır', () => {
      const broken = [ICAO_TD3[0], ICAO_TD3[1].replace('7408122', '7408132')];
      const mrz = parseMrz(broken, opts);
      assert.equal(mrz.checks.birthDate, false);
      assert.equal(mrz.valid, false);
    });
  });

  describe('TC kimlik kartı', () => {
    it('TC kimlik numarası isteğe bağlı alandan, kimlik türü TC no ile', () => {
      const mrz = parseMrz(turkishIdCard(), opts);
      assert.equal(mrz.valid, true, JSON.stringify(mrz.checks));
      assert.equal(mrz.nationality, 'TR');
      assert.equal(mrz.turkishIdNumber, '10000000146');
      assert.equal(mrz.documentNumber, 'A01B23456');
      assert.deepEqual(mrzIdentity(mrz), {
        idType: 'NATIONAL_ID',
        idNumber: '10000000146',
        nationality: 'TR',
        birthDate: '1990-01-15',
        firstName: 'Ahmet Yusuf',
        lastName: 'Ozturk',
      });
      assert.deepEqual(mrzProblems(mrz), []);
    });

    it('sağlaması tutmayan 11 hane TC no sayılmaz', () => {
      const mrz = parseMrz(turkishIdCard({ tckn: '10000000147' }), opts);
      assert.equal(mrz.turkishIdNumber, null);
      assert.deepEqual(mrzProblems(mrz), ['TC kimlik numarası okunamadı']);
    });

    it("Türk pasaportu: TC no kişisel numara alanında → TC no ile; yabancı pasaport → pasaport no", () => {
      const tr = parseMrz(passport({ country: 'TUR', docNumber: 'U12345678', personal: '10000000146', name: 'YILMAZ<<AYSE' }), opts);
      assert.equal(tr.valid, true, JSON.stringify(tr.checks));
      assert.equal(mrzIdentity(tr).idType, 'NATIONAL_ID');
      assert.equal(mrzIdentity(tr).idNumber, '10000000146');
      const de = parseMrz(passport(), opts);
      assert.equal(de.valid, true, JSON.stringify(de.checks));
      assert.deepEqual(mrzIdentity(de), { idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE', birthDate: '1985-03-16', firstName: 'Erika', lastName: 'Mustermann' });
    });

    it('Alman pasaportu "D<<" kodu ve İngiliz türleri', () => {
      assert.equal(mrzCountryToIso('D<<'), 'DE');
      assert.equal(mrzCountryToIso('GBD'), 'GB');
      assert.equal(mrzCountryToIso('RKS'), 'XK');
      assert.equal(mrzCountryToIso('XXA'), null, 'vatansız');
      const mrz = parseMrz(passport({ country: 'D', nationality: 'D' }), opts);
      assert.equal(mrz.nationality, 'DE');
      assert.equal(mrz.valid, true);
    });
  });

  describe('OCR hataları', () => {
    it('satırlar gürültülü metinden bulunur (boşluk, küçük harf, «, çöp satırlar)', () => {
      const [a, b] = ICAO_TD3;
      const text = `REPUBLIC OF UTOPIA\nPASSPORT  PASS\n ${a.slice(0, 20)} ${a.slice(20).replace('<<<<', '«<<')} \n${b.toLowerCase()}\n`;
      const found = findMrzLines(text);
      assert.equal(found.format, 'TD3');
      assert.equal(found.lines[1], b);
      assert.equal(readMrz(text, opts).valid, true);
    });

    it('rakam alanında harf, harf alanında rakam düzeltilir', () => {
      const [a, b] = ICAO_TD3;
      // Doğum tarihinde O (0 yerine), uyrukta 0 (O yerine): sağlama yine tutar.
      const noisy = [a, b.replace('UTO7408122', 'UT07408I22')];
      const mrz = parseMrz(noisy, opts);
      assert.equal(mrz.birthDate, '1974-08-12');
      assert.equal(mrz.nationalityCode, 'UTO');
      assert.equal(mrz.checks.birthDate, true);
    });

    it('belge numarasındaki O/0 karışıklığı sağlamaya göre çözülür', () => {
      const card = turkishIdCard({ docNumber: 'A01B23456' });
      const noisy = [card[0].replace('A01B23456', 'AO1B23456'), card[1], card[2]];
      const mrz = parseMrz(noisy, opts);
      assert.equal(mrz.documentNumber, 'A01B23456');
      assert.equal(mrz.corrected, true);
      assert.equal(mrz.valid, true);
    });

    it('kırpılmış ya da fazladan dolgulu satır tamamlanır', () => {
      const [a, b, c] = ICAO_TD1;
      const found = findMrzLines(`${a}\n${b}\n${c.slice(0, 27)}`);
      assert.equal(found.format, 'TD1');
      assert.equal(found.lines[2].length, 30);
      assert.equal(findMrzLines('MERHABA\nDÜNYA'), null);
    });

    it("OCR'ın K / L okuduğu ve yuttuğu dolgu geri kurulur (tarayıcıda gerçek okuma çıktısı)", () => {
      // tesseract (eng) çıktısı: dolgu L / K okundu, ikinci satır 5 karakter kısa.
      const ocr = 'P<FRALAURENT<<MARIE<KCLATRE<LLLLLLLLLLLLLLLLL\n19FV123459FRA8807043F3202159<<<<<LLLLL2\n';
      const found = findMrzLines(ocr);
      assert.equal(found.format, 'TD3');
      assert.equal(found.lines[1], '19FV123459FRA8807043F3202159<<<<<<<<<<<<<<<2');
      const mrz = parseMrz(found.lines, opts);
      assert.equal(mrz.valid, true, JSON.stringify(mrz.checks));
      assert.equal(mrz.documentNumber, '19FV12345');
      assert.equal(mrz.nationality, 'FR');
      // Kontrastı açılmış görüntüde dolgu fazladan okunur (satır 50 karakter): kısaltılır.
      const longer = findMrzLines('P<FRALAURENT<<MARIE<KCLATIRE<L<LLLLLLLLLLLLLLKLKL\n19FV123459FRA8807043F3202159<<<<<KLLKLLLLLL2');
      assert.equal(longer.lines[0].length, 44);
      assert.equal(parseMrz(longer.lines, opts).valid, true);
      // TC kimlik kartında (tarayıcıdaki gerçek okuma) satır 2'nin isteğe bağlı alanı hiç '<' olmadan K/L okundu,
      // birleşik sağlama hanesi de bozuk. Asıl alanların sağlaması ve TC no sağlaması tutuyor: okuma geçerli.
      const card = readMrz('I<TURA23K45678710000000146<<<<\n8506092M3306091TURKKLLLLKLLLKL\nSIMSEK<<AHMET<<<<<<<<<<<<<<<<<', opts);
      assert.equal(card.turkishIdNumber, '10000000146');
      assert.equal(card.valid, true);
      assert.deepEqual(mrzProblems(card), []);
      // İsteğe bağlı alanda doğrulanamayan veri varken birleşik sağlama yine şart.
      const icao = [...ICAO_TD1];
      icao[0] = icao[0].replace('D231458907<<<<<<<<<<<<<<<', 'D231458907ABC123<<<<<<<<<');
      assert.equal(parseMrz(icao, opts).valid, false);
      // Ad satırının ortasındaki K / L ad harfidir, dokunulmaz (personel adı belgeyle karşılaştırır).
      assert.equal(restoreMrzFillers('P<DEUMUELLER<<KLARA<<<<LLLL', true), 'P<DEUMUELLER<<KLARA<<<<<<<<');
      assert.equal(restoreMrzFillers('L898902C36UTO7408122F1204159ZE184226B<KLL<10', false), 'L898902C36UTO7408122F1204159ZE184226B<<<<<10');
      assert.equal(fitMrzLine('AB<<C', 7), 'AB<<<<C');
      assert.equal(fitMrzLine('AB<<<<C', 5), 'AB<<C');
      assert.equal(fitMrzLine('ABC', 5), 'ABC<<');
    });

    it('normalizeMrzLine', () => {
      assert.equal(normalizeMrzLine(' p<utoeri ‹‹ '), 'P<UTOERI<<');
    });
  });

  describe('tarih', () => {
    it('doğumda yüzyıl, son kullanmada 2000ler; olmayan gün reddedilir', () => {
      assert.equal(mrzDate('990101', 'birth', TODAY), '1999-01-01');
      assert.equal(mrzDate('260101', 'birth', TODAY), '2026-01-01');
      assert.equal(mrzDate('270101', 'birth', TODAY), '1927-01-01');
      assert.equal(mrzDate('300101', 'expiry', TODAY), '2030-01-01');
      assert.equal(mrzDate('900230', 'birth', TODAY), null);
      assert.equal(mrzDate('9001AA', 'birth', TODAY), null);
    });

    it('süresi dolmuş belge işaretlenir', () => {
      assert.equal(parseMrz(turkishIdCard({ expiry: '251231' }), opts).expired, true);
      assert.equal(parseMrz(turkishIdCard(), opts).expired, false);
    });
  });

  describe('ad', () => {
    it('kart biçimi ve Türkçe harfsiz karşılaştırma', () => {
      assert.equal(mrzNameCase('AHMET YUSUF'), 'Ahmet Yusuf');
      assert.equal(mrzNameCase("O'BRIEN-SMITH"), "O'Brien-Smith");
      assert.equal(foldMrzName('Öztürk İpek Çağla Şule'), 'OZTURKIPEKCAGLASULE');
      const mrz = parseMrz(turkishIdCard({ name: 'OZTURK<<IPEK<CAGLA' }), opts);
      assert.equal(sameMrzName({ firstName: 'İpek Çağla', lastName: 'Öztürk' }, mrz), true);
      assert.equal(sameMrzName({ firstName: 'İpek', lastName: 'Öztürk' }, mrz), false);
    });

    it("OCR ayıracı K / L okuduysa (tarayıcıdaki gerçek okuma) kartın adı yine eşleşir", () => {
      const mrz = parseMrz(turkishIdCard({ name: 'ARSLANKLLKELIF' }), opts);
      assert.equal(sameMrzName({ firstName: 'Elif', lastName: 'Arslan' }, mrz), true);
      assert.equal(sameMrzName({ firstName: 'Elif', lastName: 'Aslan' }, mrz), false);
      assert.equal(sameMrzName({ firstName: 'Ece', lastName: 'Arslan' }, mrz), false);
    });

    it('dolu (kırpılmış) ad alanında baş eşleşmesi yeter', () => {
      const long = 'WOLFESCHLEGELSTEINHAUSEN<<HUBERT<BLAINE<XAVIER';
      const mrz = parseMrz(turkishIdCard({ name: long.slice(0, 30) }), opts);
      assert.equal(mrz.nameTruncated, true);
      assert.equal(sameMrzName({ firstName: 'Hubert Blaine Xavier', lastName: 'Wolfeschlegelsteinhausen' }, mrz), true);
    });
  });

  describe('sunucu doğrulaması', () => {
    const text = turkishIdCard().join('\n');
    const identity = { idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR', birthDate: '1990-01-15' };

    it('okunanla aynı kimlik kabul edilir', () => {
      const result = verifyMrzIdentity(text, identity, opts);
      assert.equal(result.ok, true);
    });

    it('değiştirilmiş alan reddedilir, sebep alan adıyla', () => {
      const result = verifyMrzIdentity(text, { ...identity, birthDate: '1990-01-16', idNumber: '10000000078' }, opts);
      assert.equal(result.ok, false);
      assert.match(result.reason, /belge numarası, doğum tarihi/);
    });

    it('sağlaması tutmayan ya da tanınmayan okuma reddedilir', () => {
      assert.equal(verifyMrzIdentity('merhaba', identity, opts).ok, false);
      const broken = turkishIdCard();
      broken[1] = broken[1].replace('900115', '900116');
      assert.match(verifyMrzIdentity(broken.join('\n'), identity, opts).reason, /Doğum tarihi okunamadı/);
    });
  });

  it('uyruk listesindeki her ülkenin MRZ kodu var, kodlar tek', () => {
    const covered = new Set(MRZ_COUNTRY_CODES.map(mrzCountryToIso));
    const missing = COUNTRY_CODES.filter((code) => !covered.has(code));
    assert.deepEqual(missing, []);
    const iso3 = MRZ_COUNTRY_CODES.filter((code) => code.length === 3 && !['GBD', 'GBN', 'GBO', 'GBP', 'GBS', 'RKS', 'UNK'].includes(code));
    assert.equal(new Set(iso3.map(mrzCountryToIso)).size, iso3.length, 'bir alfa-2 iki alfa-3 koduna gitmemeli');
  });
});

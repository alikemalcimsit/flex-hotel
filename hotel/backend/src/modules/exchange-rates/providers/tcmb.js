import { EXCHANGE_RATE_KINDS, TCMB_RATE_FIELDS } from '@hotelos/hotel-contracts';

/**
 * TCMB gösterge niteliğindeki kurlar (modül 60) — herkese açık XML: günün bülteni `https://www.tcmb.gov.tr/kurlar/today.xml`, geçmiş
 * gün `https://www.tcmb.gov.tr/kurlar/YYYYAA/GGAAYYYY.xml` (hafta sonu / tatilde yoktur: 404). Biçim (doğrulandı):
 * `<Tarih_Date Tarih="25.11.2026" …><Currency CurrencyCode="USD"><Unit>1</Unit><ForexBuying>…</ForexBuying>…</Currency>…`.
 */

const BASE = 'https://www.tcmb.gov.tr/kurlar';
const TIMEOUT_MS = 15_000;

/**
 * Bülten XML'i → { date, currencies: { USD: { unit, rates: { FOREX_BUYING: '50.5531', … } } } }; bozuksa null.
 * @param {string} xml
 */
export function parseTcmbXml(xml) {
  const header = /<Tarih_Date[^>]*\sTarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!header) return null;
  /** @type {Record<string, { unit: number, rates: Record<string, string | null> }>} */
  const currencies = {};
  for (const match of xml.matchAll(/<Currency\b[^>]*\bCurrencyCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g)) {
    const [, code, body] = match;
    const field = (name) => {
      const value = new RegExp(`<${name}>\\s*([0-9.]+)\\s*</${name}>`).exec(body)?.[1];
      return value || null;
    };
    currencies[code] = { unit: Number(field('Unit') ?? 1) || 1, rates: Object.fromEntries(EXCHANGE_RATE_KINDS.map((kind) => [kind, field(TCMB_RATE_FIELDS[kind])])) };
  }
  if (!Object.keys(currencies).length) return null;
  return { date: `${header[3]}-${header[2]}-${header[1]}`, currencies };
}

/** @param {string} day "YYYY-AA-GG" */
export const tcmbArchiveUrl = (day) => {
  const [year, month, date] = day.split('-');
  return `${BASE}/${year}${month}/${date}${month}${year}.xml`;
};

/**
 * @param {typeof fetch} [fetchImpl]
 * @returns {{ name: string, bulletin: (day: string) => Promise<ReturnType<typeof parseTcmbXml>> }}
 */
export function createTcmbProvider(fetchImpl = globalThis.fetch) {
  return Object.freeze({
    name: 'TCMB',
    /** O günün bülteni; yoksa (hafta sonu, tatil) null. Ağ hatası fırlatır. */
    async bulletin(day) {
      const response = await fetchImpl(tcmbArchiveUrl(day), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/xml' } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`TCMB cevap vermedi (HTTP ${response.status})`);
      const parsed = parseTcmbXml(await response.text());
      if (!parsed) throw new Error('TCMB bülteni okunamadı');
      // Tatilde TCMB bazen önceki günü döndürür: istenen gün değilse yok say.
      return parsed.date === day ? parsed : null;
    },
  });
}

export const tcmbProvider = createTcmbProvider();

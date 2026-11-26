import { egmProvider, jandarmaProvider } from './official.js';
import { testProvider } from './test.js';

export { KbsProviderError } from './errors.js';

/**
 * KBS sağlayıcıları (modül 58). Kuyruk ve gönderici yalnız bu arayüzü bilir; gerçek servis bağlanınca adaptörü yazılır.
 *
 * @typedef {{ hotelId: string, settings: any, password: string | null }} KbsContext
 * @typedef {{
 *   kind: 'CHECK_IN' | 'CHECK_OUT' | 'ROOM_CHANGE',
 *   roomNumber: string,
 *   previousRoomNumber: string | null,
 *   occurredAt: string,
 *   checkInRef: string | null,
 *   person: { firstName: string, lastName: string, idType: string, idNumber: string, nationality: string, birthDate: string | null,
 *     gender: string | null, birthPlace: string | null, fatherName: string | null, motherName: string | null },
 * }} KbsOutgoing
 * @typedef {{
 *   name: string,
 *   label: string,
 *   testConnection: (context: KbsContext) => Promise<{ ok: boolean, message: string }>,
 *   send: (context: KbsContext, notification: KbsOutgoing) => Promise<{ ref: string, code: string | null, message: string | null }>,
 * }} KbsProvider
 */

/** @type {Record<string, KbsProvider>} */
const PROVIDERS = Object.freeze({ TEST: testProvider, EGM: egmProvider, JANDARMA: jandarmaProvider });

/** @param {string} name @returns {KbsProvider | null} */
export function kbsProviderFor(name) {
  return PROVIDERS[name] ?? null;
}

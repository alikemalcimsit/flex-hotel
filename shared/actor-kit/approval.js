/**
 * Onay akışı (modül 11) — aktörün "bunu ben yapmam, personel karar versin"
 * demesinin yolu.
 *
 * İşleyici, işi yapmadan önce `ctx.requireApproval({...})` çağırır (ya da
 * `requireApproval` yardımcısını fırlatır). Taban sınıf bunu bir hata gibi
 * değil, bir **sinyal** gibi ele alır: iş yeniden denenmez, manuel göreve
 * düşmez, olay "işlenmiş" sayılmaz. Bunun yerine onay isteği açılır ve
 * olayın zarfı bekleyen işe (`PendingAction`) yazılır. Personel onaylayınca
 * aynı işleyici aynı olayla, bu kez `ctx.approval` dolu olarak yeniden
 * çağrılır; reddedilir ya da süresi dolarsa olay o aktör için işlenmiş
 * sayılır ve bir daha ele alınmaz.
 *
 * Neden ayrı sınıf: `retryable = false` işaretli sıradan bir hata da yeniden
 * denenmez ama manuel göreve düşer. Onay bekleyen iş bir hata değildir;
 * personelin görev listesine ikinci bir kayıt düşmemeli.
 */
export class ApprovalRequired extends Error {
  /**
   * @param {{
   *   action: string,
   *   type: string,
   *   summary: string,
   *   reason?: string | null,
   *   data?: Record<string, unknown>,
   *   amount?: string | number | null,
   *   currency?: string | null,
   *   entityType?: string | null,
   *   entityId?: string | null,
   *   expiresInMs?: number | null,
   * }} request
   */
  constructor(request) {
    super(`Onay gerekiyor: ${request?.summary ?? request?.action ?? '?'}`);
    this.name = 'ApprovalRequired';
    this.request = request;
    // Yeniden denemekle çözülmez (taban sınıf zaten ayrı ele alıyor; bu
    // işaret, sinyali kendi yakalayan işleyiciler için).
    this.retryable = false;
  }
}

/**
 * İşleyicinin içinden: `throw requireApproval({...})`.
 * @param {ConstructorParameters<typeof ApprovalRequired>[0]} request
 */
export function requireApproval(request) {
  return new ApprovalRequired(request);
}

/** @param {unknown} error */
export function isApprovalRequired(error) {
  return error instanceof ApprovalRequired;
}

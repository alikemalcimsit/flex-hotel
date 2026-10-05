import { defineActor } from '@hotelos/actor-kit';

/**
 * Bütçe yorum ajanı (modül 27): sapma raporunda istenen dönemin plan /
 * gerçekleşen farkını kısa bir paragrafla yorumlar — hangi kalemler sapmayı
 * sürükledi, oda gelirinde doluluk mu fiyat mı, eksik veri. Rakamları kendisi
 * hesaplamaz; sistemin hesapladığı açıklamayı (`explain_variance`) yorumlar.
 *
 * Kapalıysa ya da hata verirse istek "yorum yapılamadı" olarak kapanır; rapor
 * yorumsuz da tam çalışır.
 */
export const budgetAgentManifest = defineActor({
  name: 'budget-agent',
  title: 'Bütçe yorum ajanı',
  packageName: '@hotelos/budget-agent',
  type: 'agent',
  description:
    'Sapma raporunda istenen dönemin bütçe sapmasını kısa bir Türkçe paragrafla yorumlar: en büyük sapmalar, ' +
    'oda gelirinde doluluk ve fiyat etkisi, eksik gerçekleşen. Rakamları sistem hesaplar, ajan yalnızca yorumlar.',
  subscribes: ['budget.commentary.requested'],
  publishes: ['budget.commentary.completed'],
  retry: { attempts: 2, backoffMs: 1000 },
  fallbackModule: 'Bütçe',
  // Tek model çağrısı birkaç saniye sürer: isteyeni bekletmesin.
  background: { maxConcurrent: 4, maxQueued: 200 },
});

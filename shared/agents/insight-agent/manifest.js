import { defineActor } from '@hotelos/actor-kit';

/**
 * Geri bildirim ajanı (insight-agent; modül 55'te kuruldu, 54 ve FlexAI 2.0 kullanır).
 *
 * - **Etiket:** misafirin açık uçlu yorumuna duygu (olumlu / nötr / olumsuz / karışık), en fazla beş konu (sabit
 *   listeden) ve tek cümlelik Türkçe özet verir. Puanları sistem hesaplar; ajan yalnız metni okur.
 * - **Yorum sitesi yorumu (modül 54):** duygu, −100…100 puan, konu, departman, dil, Türkçe özet ve yorumun dilinde otel adına
 *   önerilen cevap (söz vermez, kişisel veri yazmaz).
 * - **Dönem özeti:** dönemin sayıları ve en yeni yorumlarından ana temaları (pay, örnek alıntı), bir paragraf özet ve
 *   en fazla üç öneri yazar. Rakam uydurmaz; yalnız verilen sayıları kullanır.
 *
 * Kapalıysa ya da hata verirse istek "yapılamadı" olarak kapanır; anket ve rapor AI'sız da tam çalışır.
 */
export const insightAgentManifest = defineActor({
  name: 'insight-agent',
  title: 'Geri bildirim ajanı',
  packageName: '@hotelos/insight-agent',
  type: 'agent',
  description:
    'Misafir anketlerindeki ve yorum sitelerindeki (Google, Booking.com…) yorumlara duygu, konu ve departman etiketi verir, ' +
    'yorum siteleri için otel adına cevap önerir; seçilen dönem için ana temaları, örnek alıntıları ve ' +
    'önerileri yazar. Puanları sistem hesaplar; ajan yalnız metni yorumlar, kişi adı ve iletişim bilgisi görmez.',
  subscribes: ['survey.analysis.requested', 'survey.insight.requested', 'review.analysis.requested'],
  publishes: ['survey.analysis.completed', 'survey.insight.completed', 'review.analysis.completed'],
  retry: { attempts: 2, backoffMs: 1000 },
  fallbackModule: 'Anket',
  // Model çağrısı saniyeler sürer; misafirin gönderimi beklemesin, toplu yorumlar sıraya girsin.
  background: { maxConcurrent: 4, maxQueued: 500 },
});

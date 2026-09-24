import { defineActor } from '@hotelos/actor-kit';

/**
 * Router ajanı: AI modundaki konuşmaya gelen her misafir mesajının niyetini
 * küçük (ucuz, hızlı) bir modelle belirler. Concierge ajanı bu sonuca göre
 * cevap verir; şikâyet ve "personelle görüşmek istiyorum" konuşmayı
 * personele devreder.
 *
 * Kapalıysa ya da hata verirse AI konuşması personele alınır (misafir
 * cevapsız kalmaz) ve iş "Misafir mesajları" manuel görevi olarak düşer.
 */
export const routerAgentManifest = defineActor({
  name: 'router-agent',
  title: 'Niyet ajanı',
  packageName: '@hotelos/router-agent',
  type: 'agent',
  description:
    'Misafir mesajının niyetini (rezervasyon, soru, şikâyet, personel isteği) küçük modelle belirler. ' +
    'Concierge buna göre cevap verir ya da konuşmayı personele devreder. Kapalıyken AI konuşmaları personele düşer.',
  subscribes: ['guest.message.received'],
  publishes: ['guest.intent.detected'],
  retry: { attempts: 2, backoffMs: 800 },
  fallbackModule: 'Misafir mesajları',
  // Model çağrısı saniyeler sürer: gelen mesajı kaydeden webhook beklemesin.
  background: { maxConcurrent: 16, maxQueued: 1000 },
});

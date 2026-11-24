import { defineActor } from '@hotelos/actor-kit';

/**
 * Dinamik fiyat ajanı (modül 34): günlük fiyat değerlendirmesi olayını alır,
 * doluluk / kalan gün / geçen yıl verisine bakıp gerekçeli fiyat önerileri
 * üretir. **Fiyatı kendisi değiştirmez** — her önerisi M11 onay kuyruğuna
 * düşer; kural tabanlı yield ile aynı kapıdan (createSuggestions) girer.
 */
export const pricingAgentManifest = defineActor({
  name: 'pricing-agent',
  type: 'agent',
  description:
    'Doluluk, kalan gün ve geçen yıl verisinden gerekçeli fiyat önerileri üretir. ' +
    'Fiyatı kendisi değiştirmez: her önerisi onay kuyruğuna düşer, personel karar verir.',
  subscribes: ['pricing.review.requested'],
  publishes: [],
  retry: { attempts: 2, backoffMs: 2000 },
  fallbackModule: 'Fiyatlandırma',
  // Günde otel başına bir olay: dar eşzamanlılık yeter, kuyruk küçük.
  background: { maxConcurrent: 2, maxQueued: 50 },
});

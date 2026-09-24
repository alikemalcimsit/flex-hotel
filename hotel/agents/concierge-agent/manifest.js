import { defineActor } from '@hotelos/actor-kit';

/**
 * Concierge ajanı: misafirle konuşup müsaitlik ve fiyat bakar, teklif
 * hazırlar, misafirin açık onayıyla rezervasyon ister; rezervasyon açılınca
 * onay kodunu, açılamazsa sebebini sohbete yazar.
 *
 * Kapalıysa ya da hata verirse konuşma personele alınır ve iş "Misafir
 * mesajları" manuel görevi olarak düşer.
 */
export const conciergeAgentManifest = defineActor({
  name: 'concierge-agent',
  type: 'agent',
  description:
    'Misafirle konuşur: müsaitlik ve fiyat bakar, teklif hazırlar, misafir açıkça onaylayınca rezervasyon ister; ' +
    'rezervasyon açılınca onay kodunu sohbete yazar. Şikâyet ve personel isteğini personele devreder.',
  subscribes: ['guest.intent.detected', 'reservation.created', 'reservation.rejected'],
  publishes: ['reservation.requested'],
  retry: { attempts: 2, backoffMs: 1000 },
  fallbackModule: 'Misafir mesajları',
  // Tur birkaç model çağrısı sürer: router'ı ve rezervasyon aktörünü bekletmesin.
  background: { maxConcurrent: 16, maxQueued: 1000 },
});

import { defineActor } from '@hotelos/actor-kit';

/**
 * Rapor ajanı (modül 24): yöneticinin doğal dildeki rapor sorusunu ("geçen ayın haftalık doluluğu") bir rapor tanımına
 * çevirir, raporu araçla görür, grafik tipini ve kısa yorumu seçer. Rakam üretmez: tabloyu sistem çalıştırır.
 *
 * Kapalıysa ya da hata verirse soru "rapor talebi" manuel görevi olarak rapor yetkilisinin önüne düşer.
 */
export const reportAgentManifest = defineActor({
  name: 'report-agent',
  title: 'Rapor ajanı',
  packageName: '@hotelos/report-agent',
  type: 'agent',
  description:
    'Rapor asistanına yazılan soruyu doluluk, gelir, kırılım, tahmin ya da bütçe sapması raporuna çevirir; grafik ve kısa ' +
    'Türkçe yorum seçer. Tabloyu sistem çalıştırır (MCP rapor araçları). Kapalıyken soru rapor talebi olarak personele düşer.',
  subscribes: ['report.question.asked'],
  publishes: ['report.question.completed'],
  retry: { attempts: 2, backoffMs: 1000 },
  fallbackModule: 'Rapor talebi',
  // Birkaç model çağrısı + rapor sorgusu: soranı bekletmesin.
  background: { maxConcurrent: 4, maxQueued: 200 },
});

import { useCrudResource } from '../../lib/useCrudResource.js';

/**
 * Ayarlar ekranlarının veri katmanı — ortak `useCrudResource` üzerine ince
 * bir sarmalayıcı. Odalar modülü de aynı hook'u kendi yoluyla kullanıyor.
 *
 * @param {{ resource: string, labels: { singular: string } }} options
 */
export function useSettingsResource({ resource, labels }) {
  return useCrudResource({
    basePath: `/settings/${resource}`,
    queryKey: ['settings', resource],
    labels,
  });
}

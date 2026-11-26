import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.js';
import { api } from './api.js';
import { resolveDisplay } from './displayMoney.js';
import { cashKeys } from './payments.js';
import { PERMISSIONS, useCan } from './permissions.js';

/** `GET /exchange-rates/current`'i okuyabilen izinler (sunucudaki kuralla aynı). */
const RATE_READ_PERMISSIONS = Object.freeze([PERMISSIONS.CASH_VIEW, PERMISSIONS.PAYMENT_RECEIVE, PERMISSIONS.PAYMENT_REFUND, PERMISSIONS.EXCHANGE_RATES_MANAGE]);

/** Güncel kurlar sık değişmez (günde bir); gösterim için 5 dakikalık önbellek yeter. */
const RATES_STALE_MS = 5 * 60_000;

/**
 * Kullanıcının gösterim para birimi ve güncel kuru (modül 60). Seçim yoksa ya da kullanıcı kurları okuyamıyorsa
 * istek atılmaz; kur yoksa / okunamazsa null — karşılık sessizce gösterilmez (tutarın kendisi her zaman görünür).
 * Kasa ekranıyla aynı sorgu anahtarı: kur girilince ikisi birlikte tazelenir.
 * @returns {ReturnType<typeof resolveDisplay>}
 */
export function useDisplayCurrency() {
  const displayCurrency = useAuthStore((state) => state.user?.displayCurrency ?? null);
  const can = useCan();
  const canReadRates = RATE_READ_PERMISSIONS.some((permission) => can(permission));
  const rates = useQuery({
    queryKey: cashKeys.rates,
    queryFn: () => api('/exchange-rates/current'),
    enabled: Boolean(displayCurrency) && canReadRates,
    staleTime: RATES_STALE_MS,
    retry: false,
  });
  return useMemo(() => resolveDisplay(displayCurrency, rates.data), [displayCurrency, rates.data]);
}

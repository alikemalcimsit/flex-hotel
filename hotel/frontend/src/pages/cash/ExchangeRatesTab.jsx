import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXCHANGE_RATE_MAX_CURRENCIES, EXCHANGE_RATE_SOURCE_LABELS, EXCHANGE_RATE_STALE_DAYS, exchangeRatesInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiPut, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { cashKeys, formatRate } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { CASH_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { TcmbSettingsCard } from './TcmbSettingsCard.jsx';

/** Kur tablosu boşken form bu dövizlerle açılır. */
const DEFAULT_FORM_CURRENCIES = Object.freeze(['EUR', 'USD', 'GBP']);

/**
 * Döviz kurları (modül 17): güncel kurlar, günün kur girişi (yetkiliyle),
 * geçmiş. Kur yalnızca iş günü için girilir; aynı gün yeniden girilirse
 * güncellenir (denetim izi eskiyi tutar). Alınmış ödeme kendi kurunu sakladığı
 * için kur değişse de değişmez. Kur birkaç günden eskiyse döviz alınmaz.
 * Modül 60: TCMB ayarı kartı (otomatik çekme, şimdi çek) ve kurun kaynağı (Elle / TCMB + bülten günü).
 */
export function ExchangeRatesTab() {
  const t = useT();
  const can = useCan();
  const { isLive } = useLiveChannel(CASH_CHANNEL, { queryKeys: [cashKeys.rates, ['cash', 'rate-history']] });
  const current = useQuery({ queryKey: cashKeys.rates, queryFn: () => api('/exchange-rates/current') });

  if (!current.data) return <QueryFallback query={current} errorTitle={t('cash.rates.loadFailed')} />;
  const data = current.data;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('cash.rates.currentTitle')}
        description={t('cash.rates.currentDescription', { hotelCurrency: data.hotelCurrency, days: EXCHANGE_RATE_STALE_DAYS })}
        actions={<Badge tone={isLive ? 'success' : 'warning'}>{isLive ? t('common.live') : t('common.notLive')}</Badge>}
      >
        {data.rates.length === 0 ? (
          <EmptyState icon="coins" title={t('cash.rates.emptyTitle')} description={t('cash.rates.emptyDescription')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {data.rates.map((rate) => (
              <li key={rate.currency} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-bold">
                  1 {rate.currency} = <span className="tabular-nums">{formatRate(rate.rate)}</span> {data.hotelCurrency}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  {formatDate(rate.date)} · {rate.enteredBy}
                  <SourceBadge source={rate.source} bulletinDate={rate.bulletinDate} />
                  {rate.today ? <Badge tone="success">{t('common.today')}</Badge> : rate.usable ? <Badge tone="warning">{t('cash.rates.notToday')}</Badge> : <Badge tone="danger">{t('cash.rates.stale')}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TcmbSettingsCard />
      {can(PERMISSIONS.EXCHANGE_RATES_MANAGE) && <TodayRatesForm data={data} />}
      <RateHistory currencies={data.rates.map((rate) => rate.currency)} />
    </div>
  );
}

/**
 * Günün kurlarını gir: bilinen dövizler son kurlarıyla dolu gelir, yeni döviz eklenebilir.
 * @param {{ data: { businessDate: string, hotelCurrency: string, rates: Array<{ currency: string, rate: string, today: boolean }> } }} props
 */
function TodayRatesForm({ data }) {
  const t = useT();
  const queryClient = useQueryClient();
  const initial = () =>
    (data.rates.length ? data.rates.map((rate) => rate.currency) : DEFAULT_FORM_CURRENCIES).map((currency) => ({
      currency,
      rate: formatRate(data.rates.find((row) => row.currency === currency)?.rate ?? '').replace('—', ''),
    }));
  const [rows, setRows] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  // Başka bir yetkili kur girince (canlı) form da güncel değerlerle yeniden kurulur.
  const signature = data.rates.map((rate) => `${rate.currency}:${rate.rate}:${rate.date}`).join('|');
  useEffect(() => {
    setRows(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const mutation = useMutation({
    mutationFn: (body) => apiPut('/exchange-rates/today', body),
    onSuccess: () => {
      toastSuccess(t('cash.rates.saved', { date: formatDate(data.businessDate) }));
      setErrors({});
      queryClient.invalidateQueries({ queryKey: cashKeys.all });
    },
    onError: (error) => setServerError(error),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    // Kuru boş bırakılan satır girilmemiş sayılır (o döviz bugün girilmiyor).
    const filled = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.rate.trim());
    const result = validateWith(exchangeRatesInputSchema, { rates: filled.map(({ row }) => row) });
    if (!result.ok) {
      // Hata yolları süzülmüş listenin sırasıyla gelir; formdaki satıra geri eşlenir.
      setErrors(
        Object.fromEntries(
          Object.entries(result.errors).map(([key, message]) => {
            const match = /^rates\.(\d+)\.(.+)$/.exec(key);
            return [match ? `rates.${filled[Number(match[1])].index}.${match[2]}` : key, message];
          }),
        ),
      );
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  const update = (index, patch) => setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  return (
    <Card title={t('cash.rates.todayTitle', { date: formatDate(data.businessDate) })} description={t('cash.rates.todayDescription')}>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {serverError && <Alert tone="danger" title={t('common.notSaved')}>{serverError.message}</Alert>}
        {errors.rates && <p className="text-sm text-sec-strong">{errors.rates}</p>}
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[6rem_1fr_auto] items-end gap-2">
            <Input
              label={index === 0 ? t('cash.rates.currency') : undefined}
              aria-label={t('cash.rates.currency')}
              value={row.currency}
              maxLength={3}
              onChange={(event) => update(index, { currency: event.target.value.toUpperCase() })}
              error={errors[`rates.${index}.currency`]}
              disabled={busy}
            />
            <Input
              label={index === 0 ? t('cash.rates.rateLabel', { hotelCurrency: data.hotelCurrency }) : undefined}
              aria-label={t('cash.rates.rateAria', { currency: row.currency || t('cash.rates.currency') })}
              inputMode="decimal"
              placeholder={t('cash.rates.ratePlaceholder')}
              value={row.rate}
              onChange={(event) => update(index, { rate: event.target.value })}
              error={errors[`rates.${index}.rate`]}
              disabled={busy}
            />
            <Button
              type="button"
              variant="ghost"
              icon="trash"
              aria-label={t('cash.rates.removeRow', { currency: row.currency || '' })}
              onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
              disabled={busy || rows.length === 1}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            icon="plus"
            onClick={() => setRows((current) => [...current, { currency: '', rate: '' }])}
            disabled={busy || rows.length >= EXCHANGE_RATE_MAX_CURRENCIES}
          >
            {t('cash.rates.addCurrency')}
          </Button>
          <Button type="submit" icon="check" disabled={busy} className="ml-auto">
            {busy ? t('common.saving') : t('cash.rates.saveRates')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Kur geçmişi (son gün önce), döviz süzgeciyle, "daha fazla" ile.
 * @param {{ currencies: string[] }} props
 */
function RateHistory({ currencies }) {
  const t = useT();
  const [currency, setCurrency] = useState('');
  const history = useInfiniteQuery({
    queryKey: cashKeys.rateHistory({ currency }),
    queryFn: ({ pageParam }) => api(withQuery('/exchange-rates/history', { currency: currency || undefined, cursor: pageParam ?? undefined })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = history.data?.pages.flatMap((page) => page.rates) ?? [];

  return (
    <Card
      title={t('cash.rates.historyTitle')}
      actions={
        <Select
          compact
          label={t('cash.rates.currency')}
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          options={[{ value: '', label: t('cash.rates.allCurrencies') }, ...currencies.map((value) => ({ value, label: value }))]}
        />
      }
    >
      {history.isPending ? (
        <Spinner className="py-4" />
      ) : history.isError ? (
        <p className="text-sm text-sec-strong">{history.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('common.noRecords')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-semibold">{formatDate(row.date)}</span> · 1 {row.currency} = <span className="tabular-nums">{formatRate(row.rate)}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-muted">
                <SourceBadge source={row.source} bulletinDate={row.bulletinDate} />
                {row.enteredBy}
              </span>
            </li>
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <div className="pt-3 text-center">
          <Button size="sm" variant="outline" icon="arrowDown" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
            {history.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Kurun kaynağı: "Elle" ya da "TCMB · 25 Kas 2026" (bülten günü). Eski kayıtta kaynak yoksa çizilmez.
 * @param {{ source?: 'MANUAL' | 'TCMB' | null, bulletinDate?: string | null }} props
 */
function SourceBadge({ source, bulletinDate }) {
  const t = useT();
  if (!source) return null;
  const label = t(`cash.rateSource.${source}`, EXCHANGE_RATE_SOURCE_LABELS[source] ?? source);
  return (
    <Badge tone={source === 'TCMB' ? 'info' : 'neutral'}>
      {source === 'TCMB' && bulletinDate ? t('cash.rates.tcmbBulletin', { source: label, date: formatDate(bulletinDate) }) : label}
    </Badge>
  );
}

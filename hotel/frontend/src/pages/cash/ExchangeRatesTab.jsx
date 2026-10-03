import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXCHANGE_RATE_MAX_CURRENCIES, EXCHANGE_RATE_STALE_DAYS, exchangeRatesInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { cashKeys, formatRate } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { CASH_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Sık kullanılan dövizler: kur tablosu boşken form bunlarla açılır. */
const COMMON_CURRENCIES = Object.freeze(['EUR', 'USD', 'GBP']);

/**
 * Döviz kurları (modül 17): güncel kurlar, günün kur girişi (yetkiliyle),
 * geçmiş. Kur yalnızca iş günü için girilir; aynı gün yeniden girilirse
 * güncellenir (denetim izi eskiyi tutar). Alınmış ödeme kendi kurunu sakladığı
 * için kur değişse de değişmez. Kur birkaç günden eskiyse döviz alınmaz.
 */
export function ExchangeRatesTab() {
  const can = useCan();
  const { isLive } = useLiveChannel(CASH_CHANNEL, { queryKeys: [cashKeys.rates, ['cash', 'rate-history']] });
  const current = useQuery({ queryKey: cashKeys.rates, queryFn: () => api('/exchange-rates/current') });

  if (!current.data) return <QueryFallback query={current} errorTitle="Kurlar yüklenemedi" />;
  const data = current.data;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Güncel kurlar"
        description={`1 birim döviz kaç ${data.hotelCurrency}. Döviz ödemeleri bu kurla çevrilir; ${EXCHANGE_RATE_STALE_DAYS} günden eski kurla döviz alınmaz.`}
        actions={<Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>}
      >
        {data.rates.length === 0 ? (
          <EmptyState icon="coins" title="Henüz kur girilmemiş" description="Döviz ödemesi almak için günün kurunu girin." />
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {data.rates.map((rate) => (
              <li key={rate.currency} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-bold">
                  1 {rate.currency} = <span className="tabular-nums">{formatRate(rate.rate)}</span> {data.hotelCurrency}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  {formatDate(rate.date)} · {rate.enteredBy}
                  {rate.today ? <Badge tone="success">Bugün</Badge> : rate.usable ? <Badge tone="warning">Bugün girilmedi</Badge> : <Badge tone="danger">Güncel değil</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
  const queryClient = useQueryClient();
  const initial = () =>
    (data.rates.length ? data.rates.map((rate) => rate.currency) : COMMON_CURRENCIES).map((currency) => ({
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
      toastSuccess(`${formatDate(data.businessDate)} kurları kaydedildi`);
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
    <Card title={`Bugünün kurları — ${formatDate(data.businessDate)}`} description="Yalnızca iş günü için girilir; aynı gün yeniden kaydederseniz güncellenir. Geçmiş ödemeler etkilenmez.">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {serverError && <Alert tone="danger" title="Kaydedilmedi">{serverError.message}</Alert>}
        {errors.rates && <p className="text-sm text-sec-strong">{errors.rates}</p>}
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[6rem_1fr_auto] items-end gap-2">
            <Input
              label={index === 0 ? 'Döviz' : undefined}
              aria-label="Döviz"
              value={row.currency}
              maxLength={3}
              onChange={(event) => update(index, { currency: event.target.value.toUpperCase() })}
              error={errors[`rates.${index}.currency`]}
              disabled={busy}
            />
            <Input
              label={index === 0 ? `Kur (1 birim = ? ${data.hotelCurrency})` : undefined}
              aria-label={`${row.currency || 'Döviz'} kuru`}
              inputMode="decimal"
              placeholder="ör. 38,5125"
              value={row.rate}
              onChange={(event) => update(index, { rate: event.target.value })}
              error={errors[`rates.${index}.rate`]}
              disabled={busy}
            />
            <Button
              variant="ghost"
              icon="trash"
              aria-label={`${row.currency || 'Satırı'} kaldır`}
              onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
              disabled={busy || rows.length === 1}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            icon="plus"
            onClick={() => setRows((current) => [...current, { currency: '', rate: '' }])}
            disabled={busy || rows.length >= EXCHANGE_RATE_MAX_CURRENCIES}
          >
            Döviz ekle
          </Button>
          <Button type="submit" icon="check" disabled={busy} className="ml-auto">
            {busy ? 'Kaydediliyor…' : 'Kurları kaydet'}
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
      title="Geçmiş"
      actions={
        <Select
          compact
          label="Döviz"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          options={[{ value: '', label: 'Bütün dövizler' }, ...currencies.map((value) => ({ value, label: value }))]}
        />
      }
    >
      {history.isPending ? (
        <Spinner className="py-4" />
      ) : history.isError ? (
        <p className="text-sm text-sec-strong">{history.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Kayıt yok.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-semibold">{formatDate(row.date)}</span> · 1 {row.currency} = <span className="tabular-nums">{formatRate(row.rate)}</span>
              </span>
              <span className="text-xs text-ink-muted">{row.enteredBy}</span>
            </li>
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <div className="pt-3 text-center">
          <Button size="sm" variant="outline" icon="arrowDown" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
            {history.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla'}
          </Button>
        </div>
      )}
    </Card>
  );
}

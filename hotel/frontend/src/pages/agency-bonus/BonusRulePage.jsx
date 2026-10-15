import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AGENCY_BONUS_METRIC_LABELS,
  AGENCY_BONUS_PHASE_LABELS,
  AGENCY_BONUS_RULE_STATUS_LABELS,
  AGENCY_BONUS_STATUS_LABELS,
  formatBonusPeriod,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { PHASE_TONES, RULE_STATUS_TONES, SETTLEMENT_STATUS_TONES, agencyBonusKeys, formatQuantity, formatScore, monthLabel, useAgencyBonusLive, useBonusRule } from '../../lib/agencyBonus.js';
import { describeTiers } from '../../lib/agencyBonusForm.js';
import { useChannelTime } from '../../lib/channelManager.js';
import { apiPost } from '../../lib/api.js';
import { formatMoney, formatPercent } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ReasonDialog } from './BonusDialogs.jsx';
import { Figure, PaceBadge, TargetBar, TierLadder } from './BonusProgress.jsx';

const STALE_TEXT = 'Kural bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.';

/**
 * Prim kuralı ekranı (modül 35): kural, **canlı** hedef durumu (gerçekleşen,
 * eldeki, tahmin, zamana göre durum, sonraki kademe), şu ana kadarki ve
 * tahmini prim (dilim dökümüyle), kademe merdiveni, aylık üretim ve durum
 * eylemleri (yürürlüğe al, iptal, sil, hak edişi hesapla).
 */
export function BonusRulePage() {
  const { ruleId } = useParams();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useBonusRule(ruleId);
  const timeOf = useChannelTime();
  useAgencyBonusLive();
  const [dialog, setDialog] = useState(null);

  const action = useMutation({
    mutationFn: ({ kind, body }) => apiPost(`/agency-bonus/rules/${ruleId}/${kind}`, body),
    onSuccess: (result, { kind }) => {
      setDialog(null);
      queryClient.invalidateQueries({ queryKey: agencyBonusKeys.all });
      if (kind === 'delete') {
        toastSuccess('Taslak kural silindi');
        navigate('/acente-primleri');
        return;
      }
      if (kind === 'settle') {
        toastSuccess('Hak ediş hesaplandı');
        navigate(`/acente-primleri/hak-edis/${result.id}`);
        return;
      }
      toastSuccess(kind === 'activate' ? 'Kural yürürlükte: ilerleme izleniyor' : 'Kural iptal edildi');
      queryClient.setQueryData(agencyBonusKeys.rule(ruleId), result);
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: agencyBonusKeys.all });
    },
  });

  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <QueryFallback query={query} errorTitle="Prim kuralı yüklenemedi" />
      </div>
    );
  }

  const rule = query.data;
  const { live } = rule;
  const currency = rule.currency;
  const canManage = can(PERMISSIONS.AGENCY_BONUS_MANAGE);
  const busy = action.isPending;
  const locked = Boolean(rule.bonus && rule.bonus.status !== 'DRAFT');
  const ended = live.phase === 'ENDED';
  const run = (kind, body = {}) => action.mutate({ kind, body });
  const version = { expectedUpdatedAt: rule.updatedAt };
  const tierText = describeTiers(rule, currency);
  const quantity = (value) => formatQuantity(rule.metric, value, currency);

  const actions = canManage && (
    <div className="flex flex-wrap gap-2">
      {rule.status !== 'CANCELLED' && !locked && (
        <Button type="button" variant="outline" icon="pencil" onClick={() => navigate(`/acente-primleri/kural/${rule.id}/duzenle`)} disabled={busy}>
          Düzenle
        </Button>
      )}
      {rule.status === 'DRAFT' && (
        <>
          <Button type="button" icon="check" onClick={() => run('activate', version)} disabled={busy}>
            Yürürlüğe al
          </Button>
          <Button type="button" variant="ghost" icon="trash" onClick={() => setDialog('delete')} disabled={busy}>
            Sil
          </Button>
        </>
      )}
      {rule.status === 'ACTIVE' && ended && !locked && (
        <Button type="button" icon="refresh" onClick={() => run('settle')} disabled={busy}>
          {rule.bonus ? 'Hak edişi yeniden hesapla' : 'Hak edişi hesapla'}
        </Button>
      )}
      {rule.status === 'ACTIVE' && !locked && (
        <Button type="button" variant="dangerSoft" icon="close" onClick={() => setDialog('cancel')} disabled={busy}>
          İptal et
        </Button>
      )}
    </div>
  );

  const maxMonth = Math.max(1, ...live.months.map((month) => month.nights + month.onBooksNights));

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={rule.name}
        description={
          <>
            <Link to={`/acenteler/${rule.agency.id}/prim`} className="font-semibold hover:underline">
              {rule.agency.name} ({rule.agency.code})
            </Link>
            {` · ${formatBonusPeriod(rule.startDate, rule.endDate)} · ${AGENCY_BONUS_METRIC_LABELS[rule.metric]}`}
          </>
        }
        actions={actions}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RULE_STATUS_TONES[rule.status]}>{AGENCY_BONUS_RULE_STATUS_LABELS[rule.status]}</Badge>
        {rule.status !== 'CANCELLED' && <Badge tone={PHASE_TONES[live.phase]}>{AGENCY_BONUS_PHASE_LABELS[live.phase]}</Badge>}
        {live.phase === 'RUNNING' && <PaceBadge pace={live.pace.pace} />}
        {rule.bonus && (
          <Link to={`/acente-primleri/hak-edis/${rule.bonus.id}`}>
            <Badge tone={SETTLEMENT_STATUS_TONES[rule.bonus.status]}>
              Hak ediş: {AGENCY_BONUS_STATUS_LABELS[rule.bonus.status]} · {formatMoney(rule.bonus.amount, currency)}
            </Badge>
          </Link>
        )}
      </div>

      {rule.status === 'DRAFT' && (
        <Alert tone="warning" title="Taslak">
          Taslak kural izlenmez, kademe uyarısı ve hak ediş çıkmaz. Aşağıdaki rakamlar &quot;bu koşullarla ne olurdu&quot; hesabıdır; kontrol edip yürürlüğe alın.
        </Alert>
      )}
      {rule.status === 'CANCELLED' && (
        <Alert tone="warning" title="İptal edildi">
          {rule.cancelledBy} · {timeOf(rule.cancelledAt)} — {rule.cancelReason}
        </Alert>
      )}
      {rule.status === 'ACTIVE' && ended && !rule.bonus && (
        <Alert tone="info" title="Dönem bitti">
          Hak ediş zamanlanmış işle yarım saat içinde kendiliğinden hesaplanır{canManage ? '; isterseniz şimdi hesaplayın' : ''}.
        </Alert>
      )}
      {locked && (
        <Alert tone="info" title="Kural kilitli">
          Hak edişi onaya gönderilmiş ya da onaylanmış; kural değiştirilemez ve iptal edilemez. Düzeltme gerekirse önce hak edişi yeniden açın.
        </Alert>
      )}

      <Card>
        <section aria-label="Hedef durumu" className="flex flex-col gap-4 p-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-ink">Hedef durumu</h2>
            <span className="text-xs text-ink-muted">İş günü {live.businessDate} · canlı hesap</span>
          </div>
          <TargetBar
            scorePct={live.realized.scorePct}
            projectedPct={ended ? null : live.projected.scorePct}
            tiers={rule.tiers}
            target={rule.target}
            label="Hedefe ulaşma"
          />
          <p className="text-xs text-ink-muted">
            Koyu: gerçekleşen{ended ? '' : ' · açık: eldeki rezervasyonlarla tahmin'} · ince çizgiler kademe eşikleri · kalın çizgi hedef.
          </p>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure
              label="Gerçekleşen"
              value={quantity(live.realized.achieved)}
              hint={rule.metric === 'NIGHTS' ? `${formatMoney(live.realized.revenue, currency)} vergisiz ciro` : `${live.realized.nights.toLocaleString('tr-TR')} gece`}
            />
            <Figure label="Hedef" value={quantity(rule.target)} hint={`Puan ${formatScore(live.realized.scorePct)}`} tone={Number(live.realized.scorePct) >= 100 ? 'success' : 'neutral'} />
            {ended ? (
              <Figure label="Dönem" value="Bitti" hint={formatBonusPeriod(rule.startDate, rule.endDate)} />
            ) : (
              <Figure
                label="Eldekiyle tahmin"
                value={quantity(live.projected.achieved)}
                hint={`Eldeki ${live.onBooks.nights.toLocaleString('tr-TR')} gece · ${formatMoney(live.onBooks.revenue, currency)} · puan ${formatScore(live.projected.scorePct)}`}
              />
            )}
            {ended ? (
              <Figure
                label="Sonuç"
                value={Number(live.realized.scorePct) >= 100 ? <Badge tone="success">Hedefe ulaştı</Badge> : <Badge tone="warning">Hedefe ulaşmadı</Badge>}
                hint={live.earned.tierIndex ? `${live.earned.tierIndex}. kademe` : 'Kademeye ulaşılmadı'}
              />
            ) : (
              <Figure
                label="Zamana göre"
                value={live.pace.pace ? <PaceBadge pace={live.pace.pace} /> : '—'}
                hint={live.pace.elapsedDays ? `${live.pace.elapsedDays}/${live.pace.totalDays} gün geçti · beklenen ${quantity(live.pace.expected)}` : 'Dönem başlamadı'}
              />
            )}
          </dl>
          {live.nextTier && (
            <p className="text-sm text-ink-soft">
              Sonraki kademe ({live.nextTier.tier}. · {formatPercent(live.nextTier.ratePct)}): <strong className="text-ink">{quantity(live.nextTier.remaining)}</strong> kaldı.
            </p>
          )}
        </section>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <section aria-label="Prim" className="flex flex-col gap-4 p-1">
            <h2 className="text-base font-bold text-ink">Prim</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Figure
                label={ended ? 'Dönemin primi' : 'Şu ana kadarki prim'}
                value={formatMoney(live.earned.amount, currency)}
                tone="success"
                hint={live.earned.tierIndex ? `${live.earned.tierIndex}. kademe · etkin oran ${formatPercent(live.earned.effectiveRatePct ?? '0')}` : 'Kademeye ulaşılmadı'}
              />
              {!ended && (
                <Figure
                  label="Eldekiyle tahmini prim"
                  value={formatMoney(live.forecast.amount, currency)}
                  hint={live.forecast.tierIndex ? `${live.forecast.tierIndex}. kademe` : 'Kademeye ulaşılmıyor'}
                />
              )}
            </dl>
            {live.earned.capped && <Alert tone="warning" title="Tavana takıldı">Brüt prim {formatMoney(live.earned.grossAmount, currency)}; tavan {formatMoney(rule.maxBonus, currency)} ödenir.</Alert>}
            {live.earned.slices.length > 0 && <SliceTable slices={live.earned.slices} metric={rule.metric} currency={currency} />}
          </section>
        </Card>
        <Card>
          <section aria-label="Kademeler" className="flex flex-col gap-3 p-1">
            <h2 className="text-base font-bold text-ink">Kademeler</h2>
            <p className="text-sm font-semibold text-success-ink">{tierText.headline}</p>
            <TierLadder metric={rule.metric} tiers={rule.tiers} reached={live.earned.tierIndex} projected={ended ? null : live.projectedTier} currency={currency} />
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-ink-soft">
              {tierText.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>{rule.roomTypes.length ? `Sayılan oda tipleri: ${rule.roomTypes.map((type) => type.name).join(', ')}` : 'Bütün oda tipleri sayılır'}</li>
            </ul>
            {rule.notes && <p className="rounded-item bg-canvas p-2 text-xs text-ink-soft">{rule.notes}</p>}
          </section>
        </Card>
      </div>

      <Card>
        <section aria-label="Aylık üretim" className="flex flex-col gap-3 p-1">
          <h2 className="text-base font-bold text-ink">Aylık üretim</h2>
          {live.months.length === 0 ? (
            <p className="text-sm text-ink-muted">Bu dönemde bu acenteden konaklama yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
                    <th className="py-2 pr-3">Ay</th>
                    <th className="py-2 pr-3">Geceler</th>
                    <th className="py-2 pr-3 text-right">Gerçekleşen</th>
                    <th className="py-2 pr-3 text-right">Vergisiz ciro</th>
                    <th className="py-2 text-right">Eldeki</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {live.months.map((month) => (
                    <tr key={month.month}>
                      <td className="py-2 pr-3 font-semibold text-ink">{monthLabel(month.month)}</td>
                      <td className="w-1/3 py-2 pr-3">
                        <span className="flex h-2.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
                          <span className="bg-success" style={{ width: `${(month.nights / maxMonth) * 100}%` }} />
                          <span className="bg-info-line" style={{ width: `${(month.onBooksNights / maxMonth) * 100}%` }} />
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{month.nights.toLocaleString('tr-TR')} gece</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(month.revenue, currency)}</td>
                      <td className="py-2 text-right tabular-nums text-ink-muted">
                        {month.onBooksNights ? `${month.onBooksNights.toLocaleString('tr-TR')} gece · ${formatMoney(month.onBooksRevenue, currency)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Card>

      <p className="text-xs text-ink-muted">
        Açan {rule.createdBy} · {timeOf(rule.createdAt)}
        {rule.activatedAt && ` · yürürlüğe alan ${rule.activatedBy} · ${timeOf(rule.activatedAt)}`}
      </p>

      <ConfirmDialog
        open={dialog === 'delete'}
        title="Taslak kural silinsin mi?"
        message="Yürürlüğe girmemiş kural kalıcı olarak silinir."
        confirmLabel="Sil"
        onConfirm={() => run('delete', version)}
        onClose={() => setDialog(null)}
        isPending={busy}
      />
      {dialog === 'cancel' && (
        <ReasonDialog
          open
          title="Kuralı iptal et"
          intro={
            <>
              Kural izlenmez, dönem sonunda hak ediş çıkmaz.{rule.bonus ? ' Hesaplanmış (onaya gitmemiş) hak ediş de silinir.' : ''} İptal geri alınmaz; gerekirse yeni kural açın.
            </>
          }
          label="İptal gerekçesi"
          confirmLabel="İptal et"
          confirmIcon="close"
          version={rule.updatedAt}
          busy={busy}
          serverErrors={action.error?.fields}
          onConfirm={(body) => run('cancel', body)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/**
 * Dilim dökümü (kademe, oran, matrah, prim).
 * @param {{ slices: Array<{ tier: number, ratePct: string, from: string, to: string | null, base: string, amount: string, nights?: number }>, metric: 'NIGHTS' | 'REVENUE', currency: string }} props
 */
export function SliceTable({ slices, metric, currency }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead>
          <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
            <th className="py-2 pr-3">Kademe</th>
            <th className="py-2 pr-3">Dilim</th>
            <th className="py-2 pr-3 text-right">Matrah</th>
            <th className="py-2 pr-3 text-right">Oran</th>
            <th className="py-2 text-right">Prim</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {slices.map((slice) => (
            <tr key={slice.tier}>
              <td className="py-2 pr-3 font-semibold text-ink">{slice.tier}.</td>
              <td className="py-2 pr-3 text-xs text-ink-soft">
                {formatQuantity(metric, slice.from, currency)}
                {slice.to ? ` – ${formatQuantity(metric, slice.to, currency)}` : ' ve üstü'}
                {slice.nights !== undefined && ` · ${slice.nights.toLocaleString('tr-TR')} gece`}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(slice.base, currency)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatPercent(slice.ratePct)}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(slice.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/acente-primleri" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      Acente primleri
    </Link>
  );
}

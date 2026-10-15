import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AGENCY_BONUS_METRIC_LABELS,
  AGENCY_BONUS_PHASES,
  AGENCY_BONUS_PHASE_LABELS,
  AGENCY_BONUS_RULE_SORTS,
  AGENCY_BONUS_RULE_SORT_LABELS,
  AGENCY_BONUS_RULE_STATUSES,
  AGENCY_BONUS_RULE_STATUS_LABELS,
  AGENCY_BONUS_STATUS_LABELS,
  formatBonusPeriod,
} from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PHASE_TONES, RULE_STATUS_TONES, SETTLEMENT_STATUS_TONES, agencyBonusKeys, formatQuantity, formatScore } from '../../lib/agencyBonus.js';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { PaceBadge, TargetBar } from './BonusProgress.jsx';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;

const PHASE_FILTERS = Object.freeze([{ value: '', label: 'Hepsi' }, ...AGENCY_BONUS_PHASES.map((value) => ({ value, label: AGENCY_BONUS_PHASE_LABELS[value] }))]);
const STATUS_OPTIONS = Object.freeze([{ value: '', label: 'Bütün durumlar' }, ...AGENCY_BONUS_RULE_STATUSES.map((value) => ({ value, label: AGENCY_BONUS_RULE_STATUS_LABELS[value] }))]);
const SORT_OPTIONS = Object.freeze(AGENCY_BONUS_RULE_SORTS.map((value) => ({ value, label: AGENCY_BONUS_RULE_SORT_LABELS[value] })));

/** @param {{ label: string, options: ReadonlyArray<{ value: string, label: string }>, value: string, onChange: (value: string) => void }} props */
function FilterChips({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value || 'all'}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full border px-3 py-1 text-sm font-semibold ${value === option.value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Hedef durumu (modül 35): kurallar — acente, dönem ve evre, hedef, gerçekleşen
 * ve puan çubuğu, zamana göre durum, ulaşılan kademe, hak edişin durumu.
 * Evre / durum süzgeci, acente ya da kural adıyla arama, hedefe ulaşmaya göre
 * sıralama; sayfalı ve canlı.
 *
 * Puan zamanlanmış işin özetidir (yarım saatte bir tazelenir); kural ekranı
 * canlı hesaplar.
 *
 * @param {{ agencyId?: string, embedded?: boolean }} [props] acente kartında yalnızca o acentenin kuralları
 */
export function BonusRulesTab({ agencyId, embedded = false } = {}) {
  const can = useCan();
  const outlet = useOutletContext() ?? {};
  const isLive = outlet.isLive ?? true;
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('END_DATE');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filters = { search, phase, status, sort, page, agencyId: agencyId ?? null };
  const list = useQuery({
    queryKey: agencyBonusKeys.rules(filters),
    queryFn: () =>
      api(
        withQuery('/agency-bonus/rules', {
          search: search || undefined,
          phase: phase || undefined,
          status: status || undefined,
          agencyId: agencyId || undefined,
          sort,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const currency = list.data?.meta?.currency ?? '';

  const columns = [
    {
      key: 'rule',
      header: embedded ? 'Kural' : 'Acente / kural',
      render: (row) => (
        <Link to={`/acente-primleri/kural/${row.id}`} className="block min-w-0">
          {!embedded && <span className="block truncate font-semibold text-ink hover:underline">{row.agency.name}</span>}
          <span className={`block truncate ${embedded ? 'font-semibold text-ink hover:underline' : 'text-xs text-ink-muted'}`}>{row.name}</span>
          <span className="block text-xs text-ink-muted">{formatBonusPeriod(row.startDate, row.endDate)}</span>
        </Link>
      ),
    },
    {
      key: 'target',
      header: 'Hedef',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{formatQuantity(row.metric, row.target, currency)}</span>
          <span className="block text-ink-muted">{AGENCY_BONUS_METRIC_LABELS[row.metric]}</span>
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Gerçekleşen',
      className: 'min-w-48',
      render: (row) =>
        row.status === 'DRAFT' || row.phase === 'UPCOMING' ? (
          <span className="text-xs text-ink-muted">{row.status === 'DRAFT' ? 'Taslak: izlenmiyor' : 'Dönem başlamadı'}</span>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-ink tabular-nums">{formatQuantity(row.metric, row.progress.achieved, currency)}</span>
              <span className="font-bold tabular-nums text-ink">{formatScore(row.progress.scorePct)}</span>
            </span>
            <TargetBar compact scorePct={row.progress.scorePct} tiers={row.tiers} target={row.target} label={`${row.agency.name} hedef ilerlemesi`} />
            <span className="flex flex-wrap items-center gap-1">
              {row.progress.reachedTier > 0 ? <Badge tone="success">{row.progress.reachedTier}. kademe</Badge> : <span className="text-xs text-ink-muted">Kademe yok</span>}
              {row.phase === 'RUNNING' && <PaceBadge pace={row.progress.pace} />}
            </span>
          </span>
        ),
    },
    {
      key: 'phase',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={RULE_STATUS_TONES[row.status]}>{AGENCY_BONUS_RULE_STATUS_LABELS[row.status]}</Badge>
          {row.status !== 'CANCELLED' && <Badge tone={PHASE_TONES[row.phase]}>{AGENCY_BONUS_PHASE_LABELS[row.phase]}</Badge>}
        </span>
      ),
    },
    {
      key: 'settlement',
      header: 'Hak ediş',
      className: 'whitespace-nowrap',
      render: (row) =>
        row.bonus ? (
          <Link to={`/acente-primleri/hak-edis/${row.bonus.id}`} className="flex flex-col items-start gap-1">
            <Badge tone={SETTLEMENT_STATUS_TONES[row.bonus.status]}>{AGENCY_BONUS_STATUS_LABELS[row.bonus.status]}</Badge>
            <span className="text-xs font-semibold text-ink tabular-nums">{formatMoney(row.bonus.amount, currency)}</span>
          </Link>
        ) : row.status === 'ACTIVE' && row.phase === 'ENDED' ? (
          <span className="text-xs font-semibold text-warning-ink">Hesaplanacak</span>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
  ];

  const filtered = Boolean(search || phase || status);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips label="Evre" options={PHASE_FILTERS} value={phase} onChange={(value) => { setPhase(value); setPage(1); }} />
          {!embedded && (
            <span className={`ml-auto text-xs font-semibold ${isLive ? 'text-success-ink' : 'text-warning-ink'}`}>{isLive ? 'Canlı' : 'Canlı değil — dakikada bir tazelenir'}</span>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {!embedded && (
            <Input label="Ara" name="bonus-rule-search" placeholder="Acente adı / kodu ya da kural adı" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:max-w-sm" />
          )}
          <Select label="Durum" name="bonus-rule-status" options={STATUS_OPTIONS} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="w-full sm:w-44" />
          <Select label="Sırala" name="bonus-rule-sort" options={SORT_OPTIONS} value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className="w-full sm:w-60" />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan kural yok' : 'Henüz prim kuralı yok'}
        emptyHint={
          filtered
            ? 'Aramayı ya da süzgeçleri değiştirin.'
            : can(PERMISSIONS.AGENCY_BONUS_MANAGE)
              ? '"Yeni prim kuralı" ile acenteye dönem hedefi ve kademeli prim oranları tanımlayın.'
              : undefined
        }
      />
    </div>
  );
}

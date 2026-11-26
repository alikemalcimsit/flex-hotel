import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, EmptyState, Icon, Input, Spinner } from '@hotelos/ui';
import { Toolbar } from '../../components/Toolbar.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatPercent } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { addDays, dayLabel } from '../plan/planTheme.js';
import { countText } from '../plan/planText.jsx';

/**
 * Müsaitlik ızgarası: satır oda tipi, sütun gece, hücrede boş oda sayısı.
 *
 * Renk kodu bilinçli: resepsiyonist ekrana bakınca sayı okumadan önce doluluk
 * durumunu görmeli. Kırmızı = overbooking (negatif), turuncu = son odalar,
 * yeşil = rahat.
 *
 * "Arızalı" odalar sayıdan düşer; "hizmet dışı" odalar satılabilir sayılır ama
 * misafire verilemez — hücrede nokta ile işaretlenir, çünkü o gecenin son boş
 * odası hizmet dışıysa satılan misafire oda bulunamaz.
 */

const WINDOW_DAYS = 14;

/** Boş oda oranı bu değerin altına (dahil) inince hücre "son odalar" olur. */
const LOW_AVAILABILITY_RATIO = 0.25;

/** Hücre tonları ve lejant tek kaynaktan: renk değişirse ikisi ayrışmasın. Etiket: `roomPlan.availability.<ton>`. */
const CELL_TONES = {
  comfortable: {
    cell: 'bg-success-soft text-success-ink',
    swatch: 'bg-success-soft ring-success/40',
  },
  low: {
    cell: 'bg-warning-soft text-warning-ink ring-1 ring-inset ring-warning-line',
    swatch: 'bg-warning-soft ring-warning/50',
  },
  full: {
    cell: 'bg-black/[0.04] text-ink-muted',
    swatch: 'bg-black/[0.04] ring-black/25',
  },
  overbooked: {
    cell: 'bg-danger-soft font-bold text-danger-ink ring-1 ring-inset ring-danger-line',
    swatch: 'bg-danger-soft ring-danger/40',
  },
};

const LEGEND_ORDER = ['comfortable', 'low', 'full', 'overbooked'];

/** Pencerede bir gün eksik geldiyse (olmamalı) hücre güvenli tarafta "dolu" görünsün. */
const EMPTY_CELL = Object.freeze({ free: 0, occupied: 0, outOfOrder: 0, outOfService: 0, unassigned: 0 });


/** @param {{ free: number, total: number }} cell */
function cellTone({ free, total }) {
  if (free < 0) return CELL_TONES.overbooked.cell;
  if (free === 0) return CELL_TONES.full.cell;
  if (total > 0 && free / total <= LOW_AVAILABILITY_RATIO) return CELL_TONES.low.cell;
  return CELL_TONES.comfortable.cell;
}

export function AvailabilityTab() {
  const t = useT();
  const { today } = useHotelToday();
  // Kullanıcı başka bir güne gitmediyse pencere otelin bugününü takip eder
  // (panel gece açık kalsa da ertesi gün "bugün"den başlar).
  const [pinnedFrom, setPinnedFrom] = useState(null);
  const from = pinnedFrom ?? today;

  const to = addDays(from, WINDOW_DAYS);
  const query = useQuery({
    queryKey: ['rooms', 'availability', { from, to }],
    queryFn: () => api(withQuery('/rooms/availability', { from, to })),
  });

  return (
    <div className="flex flex-col gap-5">
      <Toolbar>
        <Input
          label={t('roomPlan.shared.from')}
          name="from"
          type="date"
          value={from}
          onChange={(event) => event.target.value && setPinnedFrom(event.target.value)}
          className="w-full sm:w-48"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon="chevronLeft" onClick={() => setPinnedFrom(addDays(from, -WINDOW_DAYS))}>
            {t('roomPlan.availability.prev', { count: WINDOW_DAYS })}
          </Button>
          <Button variant="secondary" onClick={() => setPinnedFrom(null)}>
            {t('common.today')}
          </Button>
          <Button variant="outline" onClick={() => setPinnedFrom(addDays(from, WINDOW_DAYS))}>
            {t('roomPlan.availability.next', { count: WINDOW_DAYS })}
            <Icon name="chevronRight" className="size-4 shrink-0" />
          </Button>
        </div>
      </Toolbar>

      {query.isPending && (
        <Card>
          <Spinner label={t('roomPlan.availability.loading')} className="py-8" />
        </Card>
      )}

      {query.isError && (
        <Alert
          tone="danger"
          title={t('roomPlan.availability.loadFailed')}
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      )}

      {query.data && query.data.roomTypes.length === 0 && (
        <Card>
          <EmptyState
            icon="layers"
            title={t('roomPlan.shared.noRoomTypes')}
            description={t('roomPlan.availability.noTypesHint')}
          />
        </Card>
      )}

      {query.data && query.data.roomTypes.length > 0 && (
        <>
          <div className="overflow-hidden rounded-card bg-surface shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-muted">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-surface-muted px-5 py-3.5 text-left text-[0.7rem] font-bold uppercase tracking-[0.08em] text-ink-muted"
                    >
                      {t('roomPlan.filter.roomType')}
                    </th>
                    {query.data.days.map((day) => {
                      const label = dayLabel(day);
                      const isToday = day === today;
                      return (
                        <th
                          key={day}
                          scope="col"
                          aria-current={isToday ? 'date' : undefined}
                          className={`px-1.5 py-2.5 text-center text-xs font-bold ${
                            label.isWeekend ? 'bg-info-soft text-info-ink' : 'text-ink-muted'
                          } ${isToday ? 'shadow-[inset_0_-3px_0_var(--color-ink)]' : ''}`}
                        >
                          <div className="capitalize">{isToday ? t('common.today') : label.weekday}</div>
                          <div className="font-medium">{label.dayMonth}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {query.data.roomTypes.map((roomType) => (
                    <tr key={roomType.id}>
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-5 py-3 text-left font-normal">
                        <div className="font-bold text-ink">{roomType.code}</div>
                        <div className="whitespace-nowrap text-xs text-ink-muted">
                          {roomType.name} · {countText(t, 'roomPlan.shared.rooms', roomType.total)}
                        </div>
                      </th>
                      {query.data.days.map((day) => {
                        const cell = roomType.days[day] ?? { ...EMPTY_CELL, total: roomType.total };
                        const breakdown = t('roomPlan.availability.breakdown', {
                          total: cell.total,
                          occupied: cell.occupied,
                          outOfOrder: cell.outOfOrder,
                          outOfService: cell.outOfService,
                          unassigned: cell.unassigned,
                        });
                        return (
                          <td key={day} className="px-1 py-1.5 text-center">
                            <div
                              className={`relative min-w-10 rounded-item px-2 py-2 text-sm font-semibold tabular-nums ${cellTone(cell)}`}
                              title={breakdown}
                            >
                              {cell.free}
                              {cell.outOfService > 0 && (
                                <span
                                  aria-hidden="true"
                                  className="absolute right-1 top-1 size-1.5 rounded-full bg-ink-soft"
                                />
                              )}
                              <span className="sr-only">, {breakdown}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-ink-soft">
            {LEGEND_ORDER.map((key) => (
              <span key={key} className="flex items-center gap-2">
                <span aria-hidden="true" className={`inline-block size-3.5 rounded-[5px] ring-1 ring-inset ${CELL_TONES[key].swatch}`} />
                {t(`roomPlan.availability.${key}`, { pct: formatPercent(LOW_AVAILABILITY_RATIO * 100) })}
              </span>
            ))}
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-ink-soft" />
              {t('roomPlan.availability.outOfServiceLegend')}
            </span>
            <span className="font-medium text-ink-muted">{t('roomPlan.availability.hoverHint')}</span>
          </div>
        </>
      )}
    </div>
  );
}

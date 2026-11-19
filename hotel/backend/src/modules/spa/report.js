import { toDecimal, toMoneyString } from '@hotelos/core';
import { SPA_MAX_SERVICES, addSpaDays, spaDaysBetween, spaWeekday } from '@hotelos/hotel-contracts';
import { Prisma } from '@prisma/client';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { dayBounds, prisma, spaContext } from './shared.js';

/**
 * Spa raporu (modül 57): seçilen gün aralığının (randevu gününe göre) özeti.
 *
 * - **Ciro:** tamamlanan randevuların misafirin ödediği toplamı (vergi dahil) + geç iptal / gelmedi bedelleri.
 * - **Hizmet ve kategori:** tamamlanan / iptal / gelmedi sayıları, ciro, dakika.
 * - **Terapist:** tamamladığı randevular ve dersler, dakika, ciro (çift terapistli randevuda ciro eşit bölünür) ve
 *   doluluk — dolu dakika ÷ çalışma dakikası. Çalışma dakikası terapistin **bugünkü** haftalık saatlerinden hesaplanır
 *   (geçmişteki saat değişiklikleri ve izinler tutulmaz), bu yüzden yaklaşıktır.
 * - **Eğilim:** 62 güne kadar günlük, daha uzunda aylık.
 *
 * Beş gruplu sorgu, paralel; hepsi `[hotelId, startsAt]` aralığıyla (uzun aralıkta tablo taraması daha ucuz, planlayıcı
 * seçer). Çift terapistli randevunun terapist sayısı pencere fonksiyonuyla tek geçişte (randevu başına alt sorgu yok:
 * 1 yıllık raporda 0,74 → 0,2 sn). Saat dilimi dönüşümü SQL'de açık yazılır (oturum ayarına bakılmaz).
 */

/** Günlük eğilimin en uzun aralığı; üstü aylık gruplanır. */
const DAILY_TREND_DAYS = 62;
/** Raporda listelenen en fazla hizmet: otelin bütün hizmetleri (kategori toplamı bu satırlardan; eksik kalmasın). */
const SERVICE_LIMIT = SPA_MAX_SERVICES;

const money = (value) => toMoneyString(String(value ?? 0));
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * @param {string} hotelId @param {{ from: string, to: string }} query
 */
export async function spaReport(hotelId, { from, to }) {
  const { timezone, currency } = await spaContext(hotelId);
  const start = sqlTimestamp(dayBounds(from, timezone).start);
  const end = sqlTimestamp(dayBounds(to, timezone).end);
  const daily = spaDaysBetween(from, to) + 1 <= DAILY_TREND_DAYS;
  const local = Prisma.sql`((a."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})`;
  const bucket = daily ? Prisma.sql`to_char(${local}, 'YYYY-MM-DD')` : Prisma.sql`to_char(${local}, 'YYYY-MM')`;
  const scope = Prisma.sql`a."hotelId" = ${hotelId} AND a."startsAt" >= ${start} AND a."startsAt" < ${end}`;

  const [statusRows, serviceRows, therapistRows, sessionRows, trendRows, hours] = await Promise.all([
    prisma.$queryRaw`
      SELECT a."status", a."source", count(*)::int AS "count", coalesce(sum(a."guestCount"), 0)::int AS "guests",
             coalesce(sum(a."totalDue"), 0)::text AS "total",
             coalesce(sum(a."balance") FILTER (WHERE a."balance" > 0 AND a."status" IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')), 0)::text AS "open"
      FROM "SpaAppointment" a WHERE ${scope} GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT a."serviceId", max(a."serviceName") AS "name", max(a."category") AS "category", max(a."kind"::text) AS "kind",
             count(*) FILTER (WHERE a."status" = 'COMPLETED')::int AS "completed",
             count(*) FILTER (WHERE a."status" = 'CANCELLED')::int AS "cancelled",
             count(*) FILTER (WHERE a."status" = 'NO_SHOW')::int AS "noShow",
             coalesce(sum(a."guestCount") FILTER (WHERE a."status" = 'COMPLETED'), 0)::int AS "guests",
             coalesce(sum(a."totalDue") FILTER (WHERE a."status" = 'COMPLETED'), 0)::text AS "revenue",
             coalesce(sum(a."totalDue") FILTER (WHERE a."status" IN ('CANCELLED', 'NO_SHOW')), 0)::text AS "fees"
      FROM "SpaAppointment" a WHERE ${scope} AND a."status" IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
      GROUP BY a."serviceId" ORDER BY sum(a."totalDue") DESC NULLS LAST, max(a."serviceName") LIMIT ${SERVICE_LIMIT}`,
    // Birebir randevular: terapist başına (çift terapistte ciro bölünür).
    prisma.$queryRaw`
      SELECT t."therapistId", count(*)::int AS "appointments",
             coalesce(sum(t."minutes"), 0)::int AS "minutes",
             coalesce(sum(t."totalDue" / t."share"), 0)::text AS "revenue"
      FROM (
        SELECT h."therapistId", a."totalDue", extract(epoch FROM (a."endsAt" - a."startsAt")) / 60 AS "minutes",
               count(*) OVER (PARTITION BY a."id") AS "share"
        FROM "SpaAppointment" a
        JOIN "SpaHold" h ON h."appointmentId" = a."id" AND h."therapistId" IS NOT NULL
        WHERE ${scope} AND a."status" = 'COMPLETED' AND a."sessionId" IS NULL
      ) t
      GROUP BY t."therapistId"`,
    // Grup dersleri: eğitmen başına yapılan seans, dakika ve katılanların cirosu.
    prisma.$queryRaw`
      SELECT h."therapistId", count(*)::int AS "sessions",
             coalesce(sum(extract(epoch FROM (a."endsAt" - a."startsAt")) / 60), 0)::int AS "minutes",
             coalesce(sum(e."revenue"), 0)::text AS "revenue", coalesce(sum(e."guests"), 0)::int AS "guests"
      FROM "SpaSession" a
      JOIN "SpaHold" h ON h."sessionId" = a."id" AND h."therapistId" IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT sum(p."totalDue") AS "revenue", sum(p."guestCount") AS "guests" FROM "SpaAppointment" p WHERE p."sessionId" = a."id" AND p."status" = 'COMPLETED'
      ) e ON true
      WHERE ${scope} AND a."status" = 'COMPLETED'
      GROUP BY h."therapistId"`,
    prisma.$queryRaw`
      SELECT ${bucket} AS "bucket",
             count(*) FILTER (WHERE a."status" = 'COMPLETED')::int AS "completed",
             count(*) FILTER (WHERE a."status" IN ('CANCELLED', 'NO_SHOW'))::int AS "lost",
             coalesce(sum(a."totalDue") FILTER (WHERE a."status" IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')), 0)::text AS "revenue"
      FROM "SpaAppointment" a WHERE ${scope} GROUP BY 1 ORDER BY 1`,
    prisma.spaTherapist.findMany({
      where: { hotelId },
      select: { id: true, name: true, title: true, isActive: true, hours: { select: { weekday: true, startMinute: true, endMinute: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  /* ── Toplamlar ── */
  const count = (predicate) => /** @type {any[]} */ (statusRows).filter(predicate).reduce((sum, row) => sum + row.count, 0);
  const total = (predicate, field = 'total') => /** @type {any[]} */ (statusRows).filter(predicate).reduce((sum, row) => sum.plus(toDecimal(row[field])), toDecimal(0));
  const completed = count((row) => row.status === 'COMPLETED');
  const cancelled = count((row) => row.status === 'CANCELLED');
  const noShow = count((row) => row.status === 'NO_SHOW');
  const closed = completed + cancelled + noShow;
  const all = count(() => true);
  const revenue = total((row) => row.status === 'COMPLETED');
  const fees = total((row) => row.status === 'CANCELLED' || row.status === 'NO_SHOW');

  /* ── Terapist: doluluk için aralıktaki hafta günü sayıları ── */
  const weekdayCount = new Map();
  for (let cursor = from; cursor <= to; cursor = addSpaDays(cursor, 1)) weekdayCount.set(spaWeekday(cursor), (weekdayCount.get(spaWeekday(cursor)) ?? 0) + 1);
  const privateBy = new Map(/** @type {any[]} */ (therapistRows).map((row) => [row.therapistId, row]));
  const sessionBy = new Map(/** @type {any[]} */ (sessionRows).map((row) => [row.therapistId, row]));
  const therapists = hours
    .map((therapist) => {
      const own = privateBy.get(therapist.id);
      const classes = sessionBy.get(therapist.id);
      const busyMinutes = (own?.minutes ?? 0) + (classes?.minutes ?? 0);
      const workMinutes = therapist.hours.reduce((sum, hour) => sum + (hour.endMinute - hour.startMinute) * (weekdayCount.get(hour.weekday) ?? 0), 0);
      return {
        id: therapist.id,
        name: therapist.name,
        title: therapist.title,
        isActive: therapist.isActive,
        appointments: own?.appointments ?? 0,
        sessions: classes?.sessions ?? 0,
        minutes: busyMinutes,
        workMinutes,
        occupancyPct: pct(busyMinutes, workMinutes),
        revenue: toMoneyString(toDecimal(own?.revenue ?? 0).plus(toDecimal(classes?.revenue ?? 0))),
      };
    })
    .filter((row) => row.isActive || row.appointments || row.sessions)
    .sort((a, b) => Number(b.revenue) - Number(a.revenue) || a.name.localeCompare(b.name, 'tr'));

  /* ── Kategori: hizmet satırlarından ── */
  const categories = new Map();
  for (const row of /** @type {any[]} */ (serviceRows)) {
    const entry = categories.get(row.category) ?? { category: row.category, completed: 0, guests: 0, revenue: toDecimal(0) };
    entry.completed += row.completed;
    entry.guests += row.guests;
    entry.revenue = entry.revenue.plus(toDecimal(row.revenue));
    categories.set(row.category, entry);
  }

  return {
    from,
    to,
    currency,
    totals: {
      appointments: all,
      booked: count((row) => row.status === 'BOOKED'),
      waitlisted: count((row) => row.status === 'WAITLISTED'),
      completed,
      cancelled,
      noShow,
      guests: /** @type {any[]} */ (statusRows).filter((row) => row.status === 'COMPLETED').reduce((sum, row) => sum + row.guests, 0),
      revenue: toMoneyString(revenue),
      feeRevenue: toMoneyString(fees),
      totalRevenue: toMoneyString(revenue.plus(fees)),
      openBalance: toMoneyString(total(() => true, 'open')),
      cancellationPct: pct(cancelled, closed),
      noShowPct: pct(noShow, closed),
      portal: count((row) => row.source === 'PORTAL'),
      portalPct: pct(count((row) => row.source === 'PORTAL'), all),
    },
    categories: [...categories.values()].map((entry) => ({ ...entry, revenue: toMoneyString(entry.revenue) })).sort((a, b) => Number(b.revenue) - Number(a.revenue)),
    services: /** @type {any[]} */ (serviceRows).map((row) => ({ serviceId: row.serviceId, name: row.name, category: row.category, kind: row.kind, completed: row.completed, cancelled: row.cancelled, noShow: row.noShow, guests: row.guests, revenue: money(row.revenue), fees: money(row.fees) })),
    therapists,
    trend: { bucket: daily ? 'DAY' : 'MONTH', points: /** @type {any[]} */ (trendRows).map((row) => ({ bucket: row.bucket, completed: row.completed, lost: row.lost, revenue: money(row.revenue) })) },
  };
}

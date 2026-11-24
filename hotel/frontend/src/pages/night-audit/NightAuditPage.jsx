import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Textarea } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { formatMoney } from '../../lib/format.js';
import { openShiftReportPdf, useCloseDay, useNightAuditStatus } from '../../lib/nightAudit.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ClosureSummary } from './ClosureSummary.jsx';

const STEPS = ['Gelmeyenler', 'Oda ücretleri', 'Kasa sayımı', 'Fark', 'Kapat'];

/** "1050.00" − "1000.00" gösterim için (sunucu asıl hesabı yapar). */
const variance = (counted, expected) => (Number(counted || 0) - Number(expected || 0)).toFixed(2);

/**
 * Gün kapanış sihirbazı (modül 18): gelmeyenler → oda ücretleri → kasa sayımı →
 * fark → kapat. Önizleme adımları veriyi yazmaz; yalnız "Günü kapat" işler.
 */
export function NightAuditPage() {
  const can = useCan();
  const canClose = can(PERMISSIONS.NIGHT_AUDIT_CLOSE);
  const statusQuery = useNightAuditStatus();
  const closeDay = useCloseDay();

  const [step, setStep] = useState(0);
  const [counted, setCounted] = useState(/** @type {Record<string, string>} */ ({}));
  const [note, setNote] = useState('');
  const [waiveNoShowFees, setWaiveNoShowFees] = useState(false);
  const [closed, setClosed] = useState(/** @type {any} */ (null));

  const status = statusQuery.data;
  const currency = status?.currency ?? '';

  /** Sayım satırları: beklenen kasası olan yöntemler + nakit hep gösterilir. */
  const methods = useMemo(() => {
    const expected = new Map((status?.expectedCash ?? []).map((row) => [row.method, row.expected]));
    if (!expected.has('CASH')) expected.set('CASH', '0.00');
    return [...expected.entries()].map(([method, exp]) => ({ method, expected: exp }));
  }, [status]);

  if (statusQuery.isPending || statusQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Gün kapanış" description="Gece görevlisi günü adım adım kapatır." />
        <QueryFallback query={statusQuery} errorTitle="Kapanış durumu yüklenemedi" />
      </div>
    );
  }

  const countedFor = (method) => counted[method] ?? '';
  const submit = async () => {
    try {
      const body = {
        counts: methods.map((row) => ({ method: row.method, counted: countedFor(row.method) || '0' })),
        note: note.trim() || undefined,
        waiveNoShowFees,
      };
      const result = await closeDay.mutateAsync(body);
      setClosed(result);
      toastSuccess(`${status.businessDay} kapatıldı.`);
    } catch (error) {
      toastError(/** @type {Error} */ (error).message);
    }
  };

  if (closed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Gün kapatıldı" description={`${closed.day} kapanışı tamamlandı; iş günü ilerledi.`} />
        <Card title="Günlük özet">
          <ClosureSummary stats={closed.stats} noShowCount={closed.noShowCount} />
        </Card>
        <div className="flex flex-wrap gap-3">
          <Button icon="fileText" onClick={() => openShiftReportPdf(closed.day)}>
            Devir raporu (PDF)
          </Button>
          <Link to="/gun-kapanis/gecmis">
            <Button variant="outline" icon="list">
              Kapanış geçmişi
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gün kapanış"
        description={`Kapatılacak iş günü: ${status.businessDay}`}
        actions={status.status === 'IN_PROGRESS' ? <Badge tone="warning">Kapanış sürüyor{status.startedBy ? ` · ${status.startedBy}` : ''}</Badge> : null}
      />

      {!canClose && <Alert tone="info" title="Görüntüleme yetkisi" >Günü kapatmak için yetkiniz yok; yalnızca durumu görüyorsunuz.</Alert>}

      <Stepper step={step} />

      <Card>
        {step === 0 && <NoShowStep noShows={status.noShows} />}
        {step === 1 && <RoomChargeStep inHouse={status.inHouse} businessDay={status.businessDay} />}
        {step === 2 && <CashCountStep methods={methods} counted={counted} setCounted={setCounted} currency={currency} />}
        {step === 3 && <VarianceStep methods={methods} counted={counted} currency={currency} />}
        {step === 4 && (
          <CloseStep
            status={status}
            note={note}
            setNote={setNote}
            waiveNoShowFees={waiveNoShowFees}
            setWaiveNoShowFees={setWaiveNoShowFees}
            currency={currency}
            methods={methods}
            counted={counted}
          />
        )}
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" icon="arrowLeft" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Geri
        </Button>
        {step < STEPS.length - 1 ? (
          <Button icon="arrowRight" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
            İleri
          </Button>
        ) : (
          <Button icon="checkCircle" disabled={!canClose || closeDay.isPending} onClick={submit}>
            {closeDay.isPending ? 'Kapatılıyor…' : 'Günü kapat'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Adım göstergesi. @param {{ step: number }} props */
function Stepper({ step }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {STEPS.map((label, index) => (
        <li
          key={label}
          className={`flex items-center gap-2 rounded-item border px-3 py-1.5 text-sm ${
            index === step ? 'border-ink bg-surface font-semibold text-ink' : index < step ? 'border-transparent bg-surface text-ink-muted' : 'border-transparent bg-surface/60 text-ink-muted'
          }`}
        >
          <span className="grid size-5 place-items-center rounded-full bg-line text-xs font-bold text-ink">{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** @param {{ noShows: Array<{ id: string, confirmationCode: string, checkIn: string }> }} props */
function NoShowStep({ noShows }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-ink">Gelmeyenler</h2>
      {noShows.length === 0 ? (
        <p className="text-sm text-ink-muted">Giriş günü gelmiş ama gelmemiş rezervasyon yok.</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">Aşağıdaki {noShows.length} rezervasyon “gelmedi” olarak işaretlenecek; odaları envantere döner.</p>
          <ul className="divide-y divide-line rounded-card border border-line">
            {noShows.map((row) => (
              <li key={row.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-medium text-ink">{row.confirmationCode}</span>
                <span className="text-ink-muted">Giriş: {row.checkIn}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** @param {{ inHouse: number, businessDay: string }} props */
function RoomChargeStep({ inHouse, businessDay }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-ink">Oda ücretleri</h2>
      <p className="text-sm text-ink-muted">
        İçeride {inHouse} oda var. Kapanışta <strong>{businessDay}</strong> gecesinin oda ücretleri (vergisiyle) içerideki folyolara işlenir. Daha önce işlenmiş geceler tekrar
        işlenmez.
      </p>
    </div>
  );
}

/** @param {{ methods: Array<{ method: string, expected: string }>, counted: Record<string, string>, setCounted: Function, currency: string }} props */
function CashCountStep({ methods, counted, setCounted, currency }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-ink">Kasa sayımı</h2>
      <p className="text-sm text-ink-muted">Her yöntem için sayılan tutarı girin. Sistemin beklediği tutar ipucu olarak gösterilir.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {methods.map((row) => (
          <Input
            key={row.method}
            label={`${PAYMENT_METHOD_LABELS[row.method] ?? row.method} — beklenen ${formatMoney(row.expected, currency)}`}
            inputMode="decimal"
            placeholder={row.expected}
            value={counted[row.method] ?? ''}
            onChange={(event) => setCounted((prev) => ({ ...prev, [row.method]: event.target.value }))}
          />
        ))}
      </div>
    </div>
  );
}

/** @param {{ methods: Array<{ method: string, expected: string }>, counted: Record<string, string>, currency: string }} props */
function VarianceStep({ methods, counted, currency }) {
  const rows = methods.map((row) => ({ ...row, counted: counted[row.method] || '0.00', diff: variance(counted[row.method], row.expected) }));
  const total = rows.reduce((acc, row) => acc + Number(row.diff), 0).toFixed(2);
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-ink">Fark</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-muted">
            <th className="py-2">Yöntem</th>
            <th className="py-2 text-right">Beklenen</th>
            <th className="py-2 text-right">Sayılan</th>
            <th className="py-2 text-right">Fark</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.method} className="border-b border-line/60">
              <td className="py-2">{PAYMENT_METHOD_LABELS[row.method] ?? row.method}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(row.expected, currency)}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(row.counted, currency)}</td>
              <td className={`py-2 text-right tabular-nums font-semibold ${Number(row.diff) < 0 ? 'text-sec-strong' : Number(row.diff) > 0 ? 'text-ink' : 'text-ink-muted'}`}>
                {formatMoney(row.diff, currency)}
              </td>
            </tr>
          ))}
          <tr className="font-bold text-ink">
            <td className="py-2">Toplam</td>
            <td />
            <td />
            <td className="py-2 text-right tabular-nums">{formatMoney(total, currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** @param {any} props */
function CloseStep({ status, note, setNote, waiveNoShowFees, setWaiveNoShowFees, currency, methods, counted }) {
  const total = methods.reduce((acc, row) => acc + Number(counted[row.method] || 0), 0).toFixed(2);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-ink">Günü kapat</h2>
      <ul className="space-y-1 text-sm text-ink-muted">
        <li>İş günü: <strong className="text-ink">{status.businessDay}</strong></li>
        <li>Gelmedi işaretlenecek: <strong className="text-ink">{status.noShows.length}</strong></li>
        <li>Oda ücreti işlenecek: <strong className="text-ink">{status.inHouse}</strong> oda</li>
        <li>Sayılan kasa toplamı: <strong className="text-ink">{formatMoney(total, currency)}</strong></li>
      </ul>
      {status.noShows.length > 0 && (
        <Checkbox
          label="Gelmeyen ücretini uygulama"
          hint="İşaretlenirse gelmeyen misafirlerden gelmedi ücreti alınmaz."
          checked={waiveNoShowFees}
          onChange={(event) => setWaiveNoShowFees(event.target.checked)}
        />
      )}
      <Textarea label="Devir notu (isteğe bağlı)" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Devralan vardiyaya not…" />
      <Alert tone="warning" title="Dikkat">Gün kapatılınca iş günü ilerler ve bu işlem geri alınamaz.</Alert>
    </div>
  );
}

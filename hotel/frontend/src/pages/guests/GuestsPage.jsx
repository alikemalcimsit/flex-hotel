import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { contactText, guestPath, useGuests } from '../../lib/crm.js';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Misafir listesi + arama (modül 22): ad / telefon / e-posta ile aranır;
 * her kart konaklama sayısı, toplam harcama ve son konaklamayı gösterir.
 */
export function GuestsPage() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => { setQ(text.trim()); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const query = useGuests({ q: q || undefined, tag: tag || undefined, page, pageSize: PAGE_SIZE });

  const columns = [
    { key: 'name', header: 'Misafir', className: 'font-semibold', render: (row) => row.name },
    { key: 'contact', header: 'İletişim', render: (row) => <span className="text-ink-muted">{contactText(row)}</span> },
    {
      key: 'tags',
      header: 'Etiketler',
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {(row.tags ?? []).map((t) => <Badge key={t} tone={t.toLowerCase() === 'vip' ? 'success' : t.toLowerCase() === 'sorunlu' ? 'danger' : 'neutral'}>{t}</Badge>)}
        </span>
      ),
    },
    { key: 'stayCount', header: 'Konaklama', className: 'text-right tabular-nums', render: (row) => row.stayCount ?? 0 },
    { key: 'totalSpend', header: 'Toplam harcama', className: 'text-right tabular-nums', render: (row) => formatMoney(row.totalSpend) },
    { key: 'lastStay', header: 'Son konaklama', className: 'text-right', render: (row) => <span className="text-ink-muted">{row.lastStay ? formatDate(row.lastStay.checkIn) : '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Misafirler" description="Misafir kartları: geçmiş konaklamalar, tercihler, harcama ve notlar." />

      <div className="flex flex-wrap items-end gap-3">
        <Input label="Ara" name="guest-search" type="search" placeholder="Ad soyad, telefon ya da e-posta" value={text} onChange={(e) => setText(e.target.value)} className="min-w-64" />
        <Input label="Etiket" name="tag" type="search" placeholder="VIP, Sadık…" value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }} className="w-40" />
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={setPage}
        emptyTitle="Misafir bulunamadı"
        emptyHint="Arama kutusuna ad, telefon ya da e-posta yazın."
        rowActions={(row) => (
          <Button variant="outline" size="sm" icon="arrowRight" onClick={() => navigate(guestPath(row.id))}>
            Kart
          </Button>
        )}
      />
    </div>
  );
}

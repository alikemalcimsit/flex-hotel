import { BOARD_TYPES, BOARD_TYPE_LABELS, inclusiveDays } from '@hotelos/hotel-contracts';
import { Button, Card, EmptyState, Icon, Input } from '@hotelos/ui';
import { BLOCKS_EXPANDED_UP_TO, filledCells, newBlock, rateCellKey } from '../../lib/rateBlocks.js';
import { cellText, parseCell } from '../../lib/moneyInput.js';
import { addDaysIso } from '../../lib/reservations.js';

/** Pansiyonun kısa kodu: "BB — Oda + kahvaltı" → "BB". @param {string} board */
const boardCode = (board) => BOARD_TYPE_LABELS[board]?.split(' — ')[0] ?? board;

/**
 * Yeni dönemin varsayılan tarihleri: son dönemin ertesi günü kontrat bitişine
 * kadar (yer kalmadıysa boş).
 *
 * @param {Array<{ endDate: string }>} blocks
 * @param {{ startDate: string, endDate: string }} contract
 */
export function nextBlockDates(blocks, contract) {
  const lastEnd = blocks.map((block) => block.endDate).filter(Boolean).sort().at(-1);
  if (!lastEnd) return { startDate: contract.startDate, endDate: contract.endDate };
  const start = addDaysIso(lastEnd, 1);
  return start <= contract.endDate ? { startDate: start, endDate: contract.endDate } : { startDate: '', endDate: '' };
}

/**
 * Kontrat fiyat tablosu (modül 29): her **dönem** için oda tipi satırları ×
 * pansiyon sütunları; hücre oda başı gecelik fiyattır, boş hücre "bu kombinasyon
 * satılmaz". Dönemler birbirine bitişik ya da ayrık olabilir; aynı oda tipi +
 * pansiyon için dönemler çakışamaz (hata hücreye ve döneme yazılır).
 *
 * Durum üst bileşendedir (kaydetme, kaydedilmemiş değişiklik uyarısı orada).
 *
 * @param {{
 *   blocks: import('../../lib/agencies.js').RateBlock[],
 *   onChange: (blocks: import('../../lib/agencies.js').RateBlock[]) => void,
 *   roomTypes: Array<{ id: string, name: string, code: string }>,
 *   contract: { startDate: string, endDate: string },
 *   defaultBoard: string,
 *   blockErrors: Record<string, string>,
 *   cellErrors: Record<string, string>,
 *   readOnly?: boolean,
 * }} props
 */
export function RateGrid({ blocks, onChange, roomTypes, contract, defaultBoard, blockErrors, cellErrors, readOnly = false }) {
  const update = (key, patch) => onChange(blocks.map((block) => (block.key === key ? { ...block, ...patch } : block)));

  const addBlock = () => onChange([...blocks, newBlock({ ...nextBlockDates(blocks, contract), boards: [defaultBoard] })]);
  const copyBlock = (block) => {
    const copy = newBlock({ ...nextBlockDates(blocks, contract), boards: [...block.boards], cells: structuredClone(block.cells) });
    onChange([...blocks, copy]);
  };
  const removeBlock = (key) => onChange(blocks.filter((block) => block.key !== key));
  const setAllCollapsed = (collapsed) => onChange(blocks.map((block) => ({ ...block, collapsed })));

  const toggleBoard = (block, board) => {
    if (block.boards.includes(board)) {
      const cells = Object.fromEntries(
        Object.entries(block.cells).map(([roomTypeId, byBoard]) => [roomTypeId, Object.fromEntries(Object.entries(byBoard).filter(([key]) => key !== board))]),
      );
      update(block.key, { boards: block.boards.filter((value) => value !== board), cells });
    } else {
      update(block.key, { boards: BOARD_TYPES.filter((value) => value === board || block.boards.includes(value)) });
    }
  };

  const setCell = (block, roomTypeId, board, text) =>
    update(block.key, { cells: { ...block.cells, [roomTypeId]: { ...(block.cells[roomTypeId] ?? {}), [board]: text } } });

  /** Odaktan çıkınca geçerli sayı Türkçe biçime çevrilir; geçersiz metin olduğu gibi kalır (hata gösterilir). */
  const tidyCell = (block, roomTypeId, board) => {
    const text = block.cells[roomTypeId]?.[board] ?? '';
    const parsed = parseCell(text);
    if (parsed !== null && Number.isFinite(Number(parsed))) {
      const tidy = cellText(parsed);
      if (tidy !== text) setCell(block, roomTypeId, board, tidy);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {blocks.length === 0 && (
        <EmptyState
          icon="banknote"
          title="Henüz fiyat dönemi yok"
          description={readOnly ? undefined : 'Bir dönem ekleyin; oda tipi × pansiyon için gecelik fiyatları girin. Boş bırakılan hücre satılmaz.'}
        />
      )}

      {blocks.length > BLOCKS_EXPANDED_UP_TO && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>{blocks.length} dönem</span>
          <Button variant="outline" size="sm" onClick={() => setAllCollapsed(false)}>Hepsini aç</Button>
          <Button variant="outline" size="sm" onClick={() => setAllCollapsed(true)}>Hepsini kapat</Button>
        </div>
      )}

      {blocks.map((block, index) => {
        const days = block.startDate && block.endDate && block.endDate >= block.startDate ? inclusiveDays(block.startDate, block.endDate) : null;
        // Hatalı blok kapalı kalamaz: kullanıcı hatayı görmeden kaydedemez.
        const hasError = Boolean(blockErrors[block.key]) || Object.keys(cellErrors).some((key) => key.startsWith(`${block.key}|`));
        const open = !block.collapsed || hasError;
        return (
          <Card key={block.key}>
            <div className="flex flex-col gap-4 p-1">
              <div className="flex flex-wrap items-end gap-3">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${index + 1}. dönemi ${open ? 'kapat' : 'aç'}`}
                  onClick={() => update(block.key, { collapsed: open })}
                  className="grid h-10 min-w-10 place-items-center rounded-item bg-black/[0.05] px-2 text-sm font-bold text-ink-soft hover:bg-black/[0.09]"
                >
                  <span className="flex items-center gap-1">
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} className="size-3.5" />
                    {index + 1}
                  </span>
                </button>
                <Input label="Başlangıç" name={`${block.key}-start`} type="date" value={block.startDate} min={contract.startDate} max={contract.endDate} onChange={(event) => update(block.key, { startDate: event.target.value })} disabled={readOnly} className="w-full sm:w-44" />
                <Input label="Bitiş (dahil)" name={`${block.key}-end`} type="date" value={block.endDate} min={block.startDate || contract.startDate} max={contract.endDate} onChange={(event) => update(block.key, { endDate: event.target.value })} disabled={readOnly} className="w-full sm:w-44" />
                {days !== null && <span className="pb-3 text-xs font-semibold text-ink-muted">{days} gün{!open ? ` · ${filledCells(block)} fiyat` : ''}</span>}
                {!readOnly && (
                  <span className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm" icon="layers" onClick={() => copyBlock(block)}>Dönemi kopyala</Button>
                    <Button variant="dangerSoft" size="sm" icon="trash" aria-label={`${index + 1}. dönemi sil`} onClick={() => removeBlock(block.key)} />
                  </span>
                )}
              </div>
              {blockErrors[block.key] && (
                <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-sec-strong">
                  <Icon name="alertCircle" className="size-3.5 shrink-0" />
                  {blockErrors[block.key]}
                </p>
              )}

              {open && (
              <>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pansiyonlar">
                <span className="mr-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Pansiyon</span>
                {BOARD_TYPES.map((board) => (
                  <button
                    key={board}
                    type="button"
                    title={BOARD_TYPE_LABELS[board]}
                    aria-pressed={block.boards.includes(board)}
                    disabled={readOnly}
                    onClick={() => toggleBoard(block, board)}
                    className={`rounded-full border px-3 py-1 text-xs font-bold disabled:cursor-default ${block.boards.includes(board) ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
                  >
                    {board}
                  </button>
                ))}
              </div>

              {block.boards.length === 0 ? (
                <p className="text-sm text-ink-muted">Fiyat girmek için en az bir pansiyon seçin.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max text-sm">
                    <thead>
                      <tr className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                        <th scope="col" className="py-2 pr-4 font-bold">Oda tipi</th>
                        {block.boards.map((board) => (
                          <th key={board} scope="col" title={BOARD_TYPE_LABELS[board]} className="px-1.5 py-2 text-right font-bold">{boardCode(board)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {roomTypes.map((type) => (
                        <tr key={type.id}>
                          <th scope="row" className="whitespace-nowrap py-2 pr-4 text-left font-semibold text-ink">
                            {type.name}
                            <span className="ml-2 font-mono text-xs font-normal text-ink-muted">{type.code}</span>
                          </th>
                          {block.boards.map((board) => {
                            const error = cellErrors[rateCellKey(block.key, type.id, board)];
                            return (
                              <td key={board} className="px-1.5 py-1.5 text-right">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  aria-label={`${type.name} ${boardCode(board)} gecelik fiyat`}
                                  aria-invalid={error ? true : undefined}
                                  title={error}
                                  placeholder="—"
                                  disabled={readOnly}
                                  value={block.cells[type.id]?.[board] ?? ''}
                                  onChange={(event) => setCell(block, type.id, board, event.target.value)}
                                  onBlur={() => tidyCell(block, type.id, board)}
                                  className={`w-28 rounded-item border bg-surface px-2.5 py-1.5 text-right tabular-nums text-ink outline-none transition-colors focus:border-ink disabled:bg-surface-muted ${error ? 'border-sec-strong bg-danger-soft' : 'border-line-strong'}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {roomTypes.flatMap((type) => block.boards.map((board) => cellErrors[rateCellKey(block.key, type.id, board)] && `${type.name} ${boardCode(board)}: ${cellErrors[rateCellKey(block.key, type.id, board)]}`)).filter(Boolean).slice(0, 3).map((message) => (
                <p key={message} role="alert" className="text-xs font-semibold text-sec-strong">{message}</p>
              ))}
              </>
              )}
            </div>
          </Card>
        );
      })}

      {!readOnly && (
        <div>
          <Button variant="outline" icon="plus" onClick={addBlock}>Fiyat dönemi ekle</Button>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Button, Textarea } from '@hotelos/ui';
import { formatDateTime } from '../../lib/format.js';

/**
 * Misafir notları sekmesi (modül 22): tarihli, yazarlı; sabitlenen üstte.
 */
export function NotesTab({ notes, actions, canManage }) {
  const [body, setBody] = useState('');

  const add = () => {
    if (!body.trim()) return;
    actions.addNote.mutate({ body: body.trim(), pinned: false }, { onSuccess: () => setBody('') });
  };

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="space-y-2 rounded-card border border-line bg-canvas p-4">
          <Textarea label="Yeni not" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Köşe oda sever; erken giriş istedi…" />
          <Button icon="plus" onClick={add} disabled={!body.trim() || actions.addNote.isPending}>Not ekle</Button>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-ink-muted">Henüz not yok.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className={`rounded-card border p-4 ${note.pinned ? 'border-ink bg-canvas' : 'border-line bg-surface'}`}>
              <p className="whitespace-pre-wrap text-sm text-ink">{note.body}</p>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-muted">
                <span>{note.createdBy} · {formatDateTime(note.createdAt)}</span>
                {canManage && (
                  <span className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" icon={note.pinned ? 'bellOff' : 'bell'} onClick={() => actions.updateNote.mutate({ noteId: note.id, body: { pinned: !note.pinned } })}>
                      {note.pinned ? 'Sabiti kaldır' : 'Sabitle'}
                    </Button>
                    <Button variant="ghost" size="sm" icon="trash" onClick={() => actions.deleteNote.mutate(note.id)} aria-label="Sil" />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

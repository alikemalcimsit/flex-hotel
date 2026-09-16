import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MAX_MESSAGE_LENGTH } from '@hotelos/hotel-contracts';
import { Button, Icon } from '@hotelos/ui';

/** Yazma alanının büyüyebileceği en fazla yükseklik; sonrası kayar. */
const MAX_COMPOSER_HEIGHT_PX = 176;

/** Sınıra bu oranda yaklaşınca karakter sayacı görünür. */
const COUNTER_THRESHOLD = 0.8;

/**
 * Konuşma başına yarım kalan metinler. Resepsiyonist başka konuşmaya bakıp
 * dönünce yazdığı kaybolmasın; sayfa yenilenince tutulmaz (misafir verisi
 * tarayıcıda kalıcı saklanmaz).
 * @type {Map<string, string>}
 */
const drafts = new Map();

const MODES = Object.freeze([
  { value: false, label: 'Misafire yaz', icon: 'send' },
  { value: true, label: 'İç not', icon: 'lock' },
]);

/**
 * Cevap kutusu.
 *
 * - **Enter** gönderir, **Shift+Enter** alt satıra geçer (Türkçe klavyede
 *   harf birleştirme sürerken Enter gönderme yapmaz).
 * - **İç not** misafire gitmez; ekip içi bilgi ("misafir VIP, oda değişimi
 *   teklif edildi"). Kutu sarıya döner, karışmasın.
 * - Konuşma kapalıysa ya da AI modundaysa göndermenin ne yapacağı kutunun
 *   altında yazar — sessiz sürpriz yok. (Kanalın bağlı olmadığı konuşmanın
 *   üstündeki uyarıda; burada tekrarlanmaz.)
 *
 * @param {{
 *   conversation: { id: string, status: string, mode: string, contactName: string },
 *   onSend: (input: { text: string, internal: boolean }) => void,
 * }} props
 */
export function MessageComposer({ conversation, onSend }) {
  const textareaId = useId();
  const hintId = useId();
  const textareaRef = useRef(null);
  const [internal, setInternal] = useState(false);
  const draftKey = `${conversation.id}:${internal ? 'note' : 'reply'}`;
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '');

  // Mod değişince o modun taslağına geç.
  useEffect(() => {
    setText(drafts.get(draftKey) ?? '');
  }, [draftKey]);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }, [text]);

  const update = (value) => {
    setText(value);
    if (value) drafts.set(draftKey, value);
    else drafts.delete(draftKey);
  };

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_MESSAGE_LENGTH;

  const send = () => {
    if (!canSend) return;
    onSend({ text: trimmed, internal });
    update('');
    textareaRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  const hint = internal
    ? 'İç not yalnızca ekibe görünür; misafire gönderilmez.'
    : [
        conversation.status === 'CLOSED' && 'Göndermek konuşmayı yeniden açar.',
        conversation.mode === 'AI' && 'Yazarsanız konuşma size geçer; AI asistanı bu konuşmaya karışmaz.',
      ]
        .filter(Boolean)
        .join(' ');

  const showCounter = text.length >= MAX_MESSAGE_LENGTH * COUNTER_THRESHOLD;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className={`border-t px-4 py-3 transition-colors sm:px-5 ${
        internal ? 'border-warning-line bg-warning-soft/60' : 'border-line bg-surface'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div role="group" aria-label="Mesaj türü" className="inline-flex gap-1 rounded-item bg-black/[0.04] p-0.5">
          {MODES.map((mode) => (
            <button
              key={mode.label}
              type="button"
              aria-pressed={internal === mode.value}
              onClick={() => {
                setInternal(mode.value);
                textareaRef.current?.focus();
              }}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                internal === mode.value
                  ? mode.value
                    ? 'bg-warning text-white'
                    : 'bg-ink text-white'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon name={mode.icon} className="size-3.5" />
              {mode.label}
            </button>
          ))}
        </div>
        <span className="hidden text-[0.7rem] text-ink-muted sm:inline">Enter gönderir · Shift+Enter yeni satır</span>
      </div>

      <div className="flex items-end gap-2">
        <label htmlFor={textareaId} className="sr-only">
          {internal ? 'İç not' : `${conversation.contactName} kişisine mesaj`}
        </label>
        <textarea
          ref={textareaRef}
          id={textareaId}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => update(event.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={hint ? hintId : undefined}
          placeholder={internal ? 'Ekip için not…' : 'Cevabınızı yazın…'}
          className={`min-h-[44px] flex-1 resize-none rounded-control border px-4 py-2.5 text-sm font-medium text-ink outline-none transition placeholder:font-normal placeholder:text-ink-muted/70 focus:ring-[3px] ${
            internal
              ? 'border-warning-line bg-surface focus:border-warning focus:ring-warning/20'
              : 'border-line-strong bg-surface focus:border-ink focus:ring-black/[0.08]'
          }`}
        />
        <Button
          type="submit"
          icon={internal ? 'lock' : 'send'}
          disabled={!canSend}
          className="h-11 shrink-0"
          aria-label={internal ? 'Notu kaydet' : 'Gönder'}
        >
          <span className="hidden sm:inline">{internal ? 'Not ekle' : 'Gönder'}</span>
        </Button>
      </div>

      {(hint || showCounter) && (
        <div className="mt-1.5 flex items-start justify-between gap-3 text-[0.72rem]">
          <p id={hintId} className={internal ? 'text-warning-ink' : 'text-ink-muted'}>
            {hint}
          </p>
          {showCounter && (
            <span className="shrink-0 font-semibold tabular-nums text-warning-ink">
              {text.length}/{MAX_MESSAGE_LENGTH}
            </span>
          )}
        </div>
      )}
    </form>
  );
}

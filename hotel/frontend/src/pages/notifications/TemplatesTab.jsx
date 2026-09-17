import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LANGUAGE_LABELS,
  NOTIFICATION_LANGUAGES,
  NOTIFICATION_SOURCE_LABELS,
  NOTIFICATION_TRIGGER_HINTS,
  NOTIFICATION_TRIGGERS,
} from '@hotelos/hotel-contracts';
import { Icon } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api } from '../../lib/api.js';
import { notificationKeys } from '../../lib/notifications.js';
import { CHANNEL_ICONS } from './notificationTheme.js';
import { TemplateEditor } from './TemplateEditor.jsx';

/** @param {string | null} value @param {readonly string[]} allowed */
const pick = (value, allowed) => (allowed.includes(value) ? value : allowed[0]);

/**
 * Bildirim şablonları: hangi olayda misafire hangi metin gider.
 *
 * Solda olaylar, sağda seçilen olayın kanal × dil metni. Seçim adreste
 * (`?olay=&kanal=&dil=`); kaydedilmemiş değişiklik varken başka metne
 * geçilirse sorulur.
 */
export function TemplatesTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = {
    key: pick(searchParams.get('olay'), NOTIFICATION_TRIGGERS),
    channel: pick(searchParams.get('kanal'), NOTIFICATION_CHANNELS),
    language: pick(searchParams.get('dil'), NOTIFICATION_LANGUAGES),
  };
  const [dirty, setDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState(null);

  const templatesQuery = useQuery({
    queryKey: notificationKeys.templates,
    queryFn: () => api('/notifications/templates'),
  });
  const channelsQuery = useQuery({
    queryKey: notificationKeys.channels,
    queryFn: () => api('/notifications/channels'),
  });

  const applySelection = useCallback(
    (next) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set('olay', next.key);
          params.set('kanal', next.channel);
          params.set('dil', next.language);
          return params;
        },
        { replace: true },
      );
      setDirty(false);
    },
    [setSearchParams],
  );

  const select = (changes) => {
    const next = { ...selection, ...changes };
    if (next.key === selection.key && next.channel === selection.channel && next.language === selection.language) return;
    if (dirty) setPendingSelection(next);
    else applySelection(next);
  };

  if (!templatesQuery.data) return <QueryFallback query={templatesQuery} errorTitle="Şablonlar yüklenemedi" />;

  const items = templatesQuery.data.items;
  const find = (key, channel, language) =>
    items.find((item) => item.key === key && item.channel === channel && item.language === language);
  const current = find(selection.key, selection.channel, selection.language);
  const channelInfo = channelsQuery.data?.items.find((item) => item.channel === selection.channel);

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <nav aria-label="Bildirim olayları" className="flex flex-col gap-2">
        {NOTIFICATION_TRIGGERS.map((key) => {
          const selected = key === selection.key;
          return (
            <button
              key={key}
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => select({ key })}
              className={`rounded-card border bg-surface p-4 text-left shadow-soft transition-colors ${
                selected ? 'border-ink' : 'border-transparent hover:border-line-strong'
              }`}
            >
              <span className="block text-sm font-bold text-ink">{NOTIFICATION_SOURCE_LABELS[key]}</span>
              <span className="mt-1 block text-xs text-ink-muted">{NOTIFICATION_TRIGGER_HINTS[key]}</span>
              <span className="mt-2.5 flex flex-wrap gap-1.5">
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <TemplateState
                    key={channel}
                    channel={channel}
                    templates={NOTIFICATION_LANGUAGES.map((language) => find(key, channel, language)?.template)}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-card">
          <Segmented
            label="Kanal"
            options={NOTIFICATION_CHANNELS.map((value) => ({
              value,
              label: NOTIFICATION_CHANNEL_LABELS[value],
              icon: CHANNEL_ICONS[value],
            }))}
            value={selection.channel}
            onChange={(channel) => select({ channel })}
          />
          <Segmented
            label="Dil"
            options={NOTIFICATION_LANGUAGES.map((value) => ({ value, label: NOTIFICATION_LANGUAGE_LABELS[value] }))}
            value={selection.language}
            onChange={(language) => select({ language })}
          />
        </div>

        {current && (
          <TemplateEditor
            key={`${current.key}:${current.channel}:${current.language}:${current.template?.updatedAt ?? 'yeni'}`}
            item={current}
            channelAvailable={channelInfo?.available ?? true}
            channelEnabled={channelInfo?.enabled ?? null}
            onDirtyChange={setDirty}
          />
        )}
      </div>

      <ConfirmDialog
        open={pendingSelection !== null}
        title="Kaydedilmemiş değişiklik var"
        message="Bu metinde kaydetmediğiniz değişiklikler var. Başka metne geçerseniz kaybolur."
        confirmLabel="Kaydetmeden geç"
        confirmVariant="primary"
        confirmIcon="arrowRight"
        onConfirm={() => {
          applySelection(pendingSelection);
          setPendingSelection(null);
        }}
        onClose={() => setPendingSelection(null)}
      />
    </div>
  );
}

/**
 * Olay kartındaki kanal durumu: iki dilde de metin var mı, açık mı.
 * @param {{ channel: string, templates: Array<{ isActive: boolean } | null | undefined> }} props
 */
function TemplateState({ channel, templates }) {
  const saved = templates.filter(Boolean);
  const active = saved.some((template) => template.isActive);
  const label = NOTIFICATION_CHANNEL_LABELS[channel];
  const state = saved.length === 0 ? 'metin yok' : active ? 'açık' : 'kapalı';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${
        active ? 'bg-success-soft text-success-ink' : 'bg-black/[0.05] text-ink-muted'
      }`}
    >
      <Icon name={CHANNEL_ICONS[channel]} className="size-3" />
      {label}
      <span className="sr-only">: {state}</span>
      {!active && <span aria-hidden="true">· {state}</span>}
    </span>
  );
}

/**
 * Tek seçimli düğme grubu.
 * @param {{ label: string, options: Array<{ value: string, label: string, icon?: string }>, value: string, onChange: (value: string) => void }} props
 */
function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-control border border-line bg-surface-muted p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-item px-3.5 py-2 text-sm font-semibold transition-colors ${
              selected ? 'bg-ink text-white' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'
            }`}
          >
            {option.icon && <Icon name={option.icon} className="size-4" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

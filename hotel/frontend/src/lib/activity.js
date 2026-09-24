import { useEffect, useRef, useState } from 'react';
import { actorKind, AUDIT_FIELD_LABELS, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { ACTIVITY_CHANNEL, releaseChannel, retainChannel, socket } from './socket.js';

/**
 * Aktivite akışı ve denetim kaydı (modül 10) — sorgu anahtarları, canlı akış
 * kancası ve görünüm yardımcıları.
 */
export const activityKeys = Object.freeze({
  /** @param {object} filters */
  feed: (filters) => ['activity', 'feed', filters],
  /** @param {object} filters */
  events: (filters) => ['activity', 'events', filters],
  /** @param {string} correlationId */
  chain: (correlationId) => ['activity', 'chain', correlationId],
  /** @param {string} entity @param {string} entityId */
  record: (entity, entityId) => ['activity', 'record', entity, entityId],
  options: ['activity', 'options'],
  /** @param {object} filters */
  audit: (filters) => ['audit', filters],
});

/**
 * Canlı akış haberi: sunucu yeni aktivite satırlarının **kimliklerini**
 * gönderir (içerik değil); ekran satırları yetkili HTTP isteğiyle çeker.
 * Kopup yeniden bağlanınca `onReconnect` çağrılır (arada kaçanlar için liste
 * baştan yüklenir).
 *
 * @param {{
 *   enabled: boolean,
 *   onSignal: (signal: { ids: string[], count: number, warnings: number, errors: number, overflow: boolean }) => void,
 *   onReconnect: () => void,
 * }} options
 * @returns {{ isLive: boolean }}
 */
export function useActivityStream({ enabled, onSignal, onReconnect }) {
  const [isLive, setIsLive] = useState(socket.connected);
  const signalRef = useRef(onSignal);
  const reconnectRef = useRef(onReconnect);
  signalRef.current = onSignal;
  reconnectRef.current = onReconnect;

  useEffect(() => {
    if (!enabled) return undefined;
    let connectedOnce = socket.connected;
    const handleSignal = (payload) => signalRef.current(payload ?? { ids: [], count: 0, warnings: 0, errors: 0, overflow: true });
    const handleConnect = () => setIsLive(true);
    const handleDisconnect = () => setIsLive(false);
    const handleReady = (payload) => {
      if (!payload?.hotelId) setIsLive(false);
      if (connectedOnce && payload?.hotelId) reconnectRef.current();
      connectedOnce = true;
    };

    retainChannel(ACTIVITY_CHANNEL);
    socket.on(ACTIVITY_CHANNEL, handleSignal);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('ready', handleReady);
    if (socket.connected) setIsLive(true);
    else socket.connect();

    return () => {
      socket.off(ACTIVITY_CHANNEL, handleSignal);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('ready', handleReady);
      releaseChannel(ACTIVITY_CHANNEL);
    };
  }, [enabled]);

  return { isLive: enabled && isLive };
}

/** Süre: "850 ms", "2,4 sn", "3 dk 5 sn". @param {number | null | undefined} ms */
export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sn`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes} dk ${seconds} sn` : `${minutes} dk`;
}

/** Saniyeli saat: "14:05:09" (akış satırları aynı dakikada çok). */
export function formatClockSeconds(value, timeZone) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

const KIND_LABELS = Object.freeze({ SYSTEM: 'Sistem', CHANNEL: 'Kanal', ACTOR: 'Aktör', USER: 'Personel' });

/**
 * Kaydı yazanın ekrandaki adı: personelse adı (bilinmiyorsa e-postası),
 * kanalsa "WhatsApp kanalı", aktörse adı, sistemse "Sistem".
 *
 * @param {string | null | undefined} actor
 * @param {string | null | undefined} [name] personelin adı (sunucu çözdüyse)
 */
export function actorLabel(actor, name) {
  const kind = actorKind(actor);
  if (kind === 'USER') return name ?? actor;
  if (kind === 'CHANNEL') return `${actor.slice('kanal:'.length) === 'whatsapp' ? 'WhatsApp' : 'Web chat'} kanalı`;
  if (kind === 'SYSTEM') return KIND_LABELS.SYSTEM;
  return actor;
}

/** @param {string | null | undefined} actor */
export const actorKindLabel = (actor) => KIND_LABELS[actorKind(actor)];

/** Alanın Türkçe adı (bilinmiyorsa kendisi). @param {string} field */
export const fieldLabel = (field) => AUDIT_FIELD_LABELS[field] ?? field;

/**
 * Denetimdeki değerin ekranda gösterimi: boş "—", nesne kısa JSON.
 * @param {unknown} value
 */
export function formatAuditValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Tarih süzgeci (otel günü) → sunucunun beklediği an aralığı. Gün başı ve
 * sonu otelin saat dilimine göre.
 *
 * @param {{ from?: string, to?: string }} days `"YYYY-MM-DD"`
 * @param {string} timeZone
 */
export function dayRange({ from, to }, timeZone) {
  const start = from ? zonedWallTimeToUtc(`${from}T00:00`, timeZone) : null;
  const endMinute = to ? zonedWallTimeToUtc(`${to}T23:59`, timeZone) : null;
  return {
    ...(start ? { from: start.toISOString() } : {}),
    ...(endMinute ? { to: new Date(endMinute.getTime() + 59_999).toISOString() } : {}),
  };
}

import { create } from 'zustand';

/**
 * Yeni misafir mesajında kısa bir uyarı sesi.
 *
 * Resepsiyon ekrana her an bakmıyor; misafir yazdığında duyulmalı. Ses dosyası
 * yerine Web Audio ile üretilen iki notalık kısa bir ton: indirilecek dosya
 * yok, her tarayıcıda aynı.
 *
 * - Tercih kişiseldir ve bu tarayıcıda saklanır (kapatılabilir).
 * - Tarayıcılar kullanıcı ekrana dokunmadan ses çalmaya izin vermez; ilk
 *   tıklamada ses motoru hazırlanır, öncesinde gelen mesaj sessiz kalır.
 * - Aynı panel birden çok sekmede açıksa ses bir kez çalar.
 * - Art arda gelen mesajlarda en fazla birkaç saniyede bir çalar.
 */

const STORAGE_KEY = 'hotelos.inbox.sound';
const LAST_CHIME_KEY = 'hotelos.inbox.lastChime';

/** İki uyarı sesi arasındaki en kısa süre. */
const CHIME_THROTTLE_MS = 4000;

/** Başka sekmenin az önce çaldığı sesi tekrar çalmama penceresi. */
const CROSS_TAB_WINDOW_MS = 1500;

/** Tonlar: frekans (Hz), başlangıç ve süre (sn). */
const CHIME_NOTES = Object.freeze([
  { frequency: 880, start: 0, duration: 0.14 },
  { frequency: 1318.5, start: 0.12, duration: 0.22 },
]);
const CHIME_VOLUME = 0.08;

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const useInboxSoundStore = create((set, get) => ({
  enabled: readEnabled(),
  toggle: () => {
    const enabled = !get().enabled;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Depolama kapalıysa tercih yalnızca bu oturumda geçerli.
    }
    set({ enabled });
    if (enabled) primeAudio();
  },
}));

/** @type {AudioContext | null} */
let audioContext = null;
let lastChimeAt = 0;

function primeAudio() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    audioContext ??= new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch {
    audioContext = null;
  }
  return audioContext;
}

// İlk kullanıcı etkileşiminde ses motorunu hazırla (tarayıcı kuralı).
if (typeof window !== 'undefined') {
  const prime = () => {
    primeAudio();
    window.removeEventListener('pointerdown', prime);
    window.removeEventListener('keydown', prime);
  };
  window.addEventListener('pointerdown', prime);
  window.addEventListener('keydown', prime);
}

/** Başka sekme az önce çaldıysa true; değilse bu sekmenin çaldığını yazar. */
function claimChime(now) {
  try {
    const last = Number(localStorage.getItem(LAST_CHIME_KEY) ?? 0);
    if (now - last < CROSS_TAB_WINDOW_MS) return false;
    localStorage.setItem(LAST_CHIME_KEY, String(now));
  } catch {
    // Depolama yoksa sekmeler arası tekilleştirme yapılamaz; ses yine çalar.
  }
  return true;
}

/** Yeni mesaj sesi (tercih kapalıysa ya da ses motoru hazır değilse sessiz). */
export function playInboxChime() {
  if (!useInboxSoundStore.getState().enabled) return;
  const now = Date.now();
  if (now - lastChimeAt < CHIME_THROTTLE_MS) return;
  const context = audioContext;
  if (!context || context.state !== 'running') return;
  if (!claimChime(now)) return;
  lastChimeAt = now;

  const startAt = context.currentTime;
  for (const note of CHIME_NOTES) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = note.frequency;
    gain.gain.setValueAtTime(0, startAt + note.start);
    gain.gain.linearRampToValueAtTime(CHIME_VOLUME, startAt + note.start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.start + note.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt + note.start);
    oscillator.stop(startAt + note.start + note.duration + 0.02);
  }
}

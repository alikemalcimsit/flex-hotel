import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { saveFile } from '../src/lib/file-storage.js';
import { documentKeys, signatureKey } from '../src/modules/guest-portal/documents.js';

/**
 * Demo misafir portalı ve online check-in (modül 53; `demo-data.mjs` çağırır).
 *
 * Portal ayarı (adres `DEMO_PORTAL_URL` ortam değişkeninden; yoksa ayardaki korunur), önümüzdeki dört günün onaylı
 * varışlarına bağlantı ve gönderilmiş davet; yarısına online check-in: bugün gelenler çoğunlukla onaylı, sonrakiler
 * inceleme bekliyor / onaylı / düzeltme istenmiş. Son üç günde giriş yapanların bir kısmının online check-in'i
 * tamamlanmış. Kimlikler alan kurallarına uygun (Türk vatandaşına sağlamalı TC kimlik, yabancıya pasaport), belge
 * fotoğrafı ve imza `assets/` altındaki "örnek belge" görselleri — gerçek kişiye ait veri yok.
 */

const ASSETS = path.join(import.meta.dirname, 'assets');
const CODE_PREFIX = 'DMO-';
const DAY_MS = 86_400_000;
const REVIEWER = 'admin@hotel.local';

const FIRST_NAMES = Object.freeze({
  TR: ['Ayşe', 'Mehmet', 'Elif', 'Can', 'Zeynep', 'Burak', 'Deniz', 'Ece'],
  DE: ['Anna', 'Lukas', 'Mia', 'Jonas', 'Lea', 'Felix'],
  RU: ['Olga', 'Ivan', 'Elena', 'Dmitri', 'Anastasia', 'Sergei'],
  GB: ['Emma', 'James', 'Olivia', 'Harry'],
  NL: ['Sanne', 'Daan', 'Fleur', 'Bram'],
  OTHER: ['Sofia', 'Marco', 'Laura', 'David'],
});
const REJECT_REASONS = Object.freeze([
  'Pasaport fotoğrafı bulanık; ışıklı bir yerde yeniden çekin.',
  'Refakatçinin belge fotoğrafı yüklenmemiş görünüyor; lütfen ekleyin.',
]);

let seed = 53_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const digits = (count) => Array.from({ length: count }, () => Math.floor(rand() * 10)).join('');

/** Sağlamalı TC kimlik numarası. */
function tckn() {
  const head = [1 + Math.floor(rand() * 9), ...Array.from({ length: 8 }, () => Math.floor(rand() * 10))];
  const odd = head[0] + head[2] + head[4] + head[6] + head[8];
  const even = head[1] + head[3] + head[5] + head[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = (head.reduce((sum, digit) => sum + digit, 0) + tenth) % 10;
  return [...head, tenth, eleventh].join('');
}

/** @param {string} nationality */
const identity = (nationality) => {
  const turkish = nationality === 'TR';
  const year = 1955 + Math.floor(rand() * 45);
  return {
    idType: turkish ? 'NATIONAL_ID' : 'PASSPORT',
    idNumber: turkish ? tckn() : `${pick(['C', 'U', 'P', 'K'])}${digits(8)}`,
    nationality,
    birthDate: `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
  };
};

/**
 * Demo rezervasyonlarının portal kayıtları (bağlantı, online check-in, belge) — rezervasyonlardan önce silinir.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 * @returns {Promise<string[]>} silinecek dosya anahtarları (işlemden sonra)
 */
export async function resetGuestPortalDemo(tx, hotelId) {
  const demo = { hotelId, reservation: { confirmationCode: { startsWith: CODE_PREFIX } } };
  const [documents, checkins] = await Promise.all([
    tx.onlineCheckinDocument.findMany({ where: demo, select: { id: true, hotelId: true, contentType: true } }),
    tx.onlineCheckin.findMany({ where: demo, select: { signatureKey: true } }),
  ]);
  await tx.onlineCheckinDocument.deleteMany({ where: demo });
  await tx.onlineCheckin.deleteMany({ where: demo });
  await tx.guestPortalLink.deleteMany({ where: demo });
  return [...documents.flatMap((doc) => Object.values(documentKeys(doc))), ...checkins.map((row) => row.signatureKey)];
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string }} context
 */
export async function seedGuestPortalDemo({ prisma, core, contracts, hotelId, today, actor }) {
  const [full, thumb, signature] = await Promise.all(['ornek-belge.jpg', 'ornek-belge-kucuk.jpg', 'ornek-imza.png'].map((name) => readFile(path.join(ASSETS, name))));
  const baseUrl = process.env.DEMO_PORTAL_URL?.trim().replace(/\/+$/, '') || null;
  await prisma.guestPortalSettings.upsert({
    where: { hotelId },
    create: { hotelId, enabled: true, inviteDaysBefore: 3, checkinOpenDays: 7, documentRetentionDays: 7, publicBaseUrl: baseUrl, updatedBy: actor },
    update: baseUrl ? { publicBaseUrl: baseUrl } : {},
  });

  const start = new Date(`${today}T00:00:00.000Z`);
  const now = new Date();
  const include = { guest: { select: { firstName: true, lastName: true, nationality: true, idType: true, idNumber: true, birthDate: true } } };
  const [arriving, inHouse] = await Promise.all([
    prisma.reservation.findMany({
      where: { hotelId, confirmationCode: { startsWith: CODE_PREFIX }, status: 'CONFIRMED', checkIn: { gte: start, lt: new Date(start.getTime() + 4 * DAY_MS) } },
      include,
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
      take: 80,
    }),
    prisma.reservation.findMany({
      where: { hotelId, confirmationCode: { startsWith: CODE_PREFIX }, status: 'CHECKED_IN', checkIn: { gte: new Date(start.getTime() - 2 * DAY_MS) } },
      include,
      orderBy: [{ checkIn: 'desc' }, { id: 'asc' }],
      take: 40,
    }),
  ]);

  let documents = 0;
  const links = [];
  const checkins = [];
  const writes = [];
  /** @param {any} reservation @param {'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED'} status @param {Date} submittedAt */
  const submit = (reservation, status, submittedAt) => {
    const nationality = reservation.guest.nationality || 'TR';
    const names = FIRST_NAMES[nationality] ?? FIRST_NAMES.OTHER;
    const primary = reservation.guest.idNumber
      ? { idType: reservation.guest.idType, idNumber: reservation.guest.idNumber, nationality, birthDate: reservation.guest.birthDate ? core.toIsoDay(reservation.guest.birthDate) : identity(nationality).birthDate }
      : identity(nationality);
    const companions = [
      ...Array.from({ length: Math.max(0, reservation.adults - 1) }, () => ({ firstName: pick(names), lastName: reservation.guest.lastName, isChild: false, ...identity(nationality) })),
      ...Array.from({ length: reservation.children }, () => ({ firstName: pick(names), lastName: reservation.guest.lastName, isChild: true, idType: null, idNumber: null, nationality: null, birthDate: null })),
    ];
    const id = randomUUID();
    const reviewed = status !== 'SUBMITTED';
    checkins.push({
      id,
      hotelId,
      reservationId: reservation.id,
      status,
      arrivalDate: new Date(core.toUtcDayStart(reservation.checkIn)),
      searchText: [reservation.confirmationCode, reservation.guest.firstName, reservation.guest.lastName, ...companions.flatMap((row) => [row.firstName, row.lastName])].join(' '),
      guest: { firstName: reservation.guest.firstName, lastName: reservation.guest.lastName, ...primary },
      companions,
      vehiclePlate: nationality === 'TR' && rand() < 0.4 ? `${pick(['06', '34', '35', '07'])} ${pick(['ABC', 'KLM', 'RT', 'YZ'])} ${digits(3)}` : null,
      arrivalTime: pick(['13:30', '15:00', '16:30', '18:00', '20:15', null]),
      paymentPreference: pick(['CARD_AT_DESK', 'CARD_AT_DESK', 'CASH_AT_DESK', 'PREPAID', 'COMPANY']),
      note: rand() < 0.2 ? pick(['Bebek yatağı rica ederiz.', 'Mümkünse yüksek kat.', 'Geç saatte varacağız.']) : null,
      language: contracts.guestPortalLanguageFor(nationality),
      consents: { privacyAt: submittedAt.toISOString(), rulesAt: submittedAt.toISOString(), documentPhotosAt: submittedAt.toISOString(), marketing: rand() < 0.3 },
      signatureKey: signatureKey(hotelId, id, 1),
      submittedAt,
      reviewedAt: reviewed ? new Date(submittedAt.getTime() + 2 * 3_600_000) : null,
      reviewedBy: reviewed ? REVIEWER : null,
      rejectReason: status === 'REJECTED' ? pick(REJECT_REASONS) : null,
      completedAt: status === 'COMPLETED' ? reservation.checkedInAt : null,
      createdAt: submittedAt,
    });
    writes.push([signatureKey(hotelId, id, 1), signature]);
    [primary, ...companions].forEach((person, index) => {
      if (person.isChild) return;
      const doc = { id: randomUUID(), hotelId, reservationId: reservation.id, onlineCheckinId: id, person: index, contentType: 'image/jpeg', sizeBytes: full.length, thumbBytes: thumb.length, createdAt: submittedAt };
      documents += 1;
      checkins.at(-1).docs = [...(checkins.at(-1).docs ?? []), doc];
      const keys = documentKeys(doc);
      writes.push([keys.full, full], [keys.thumb, thumb]);
    });
  };

  for (const reservation of arriving) {
    const offset = Math.round((core.toUtcDayStart(reservation.checkIn) - start.getTime()) / DAY_MS);
    const invitedAt = new Date(now.getTime() - (4 - offset) * DAY_MS + Math.floor(rand() * 6) * 3_600_000);
    links.push({ hotelId, reservationId: reservation.id, nonce: randomBytes(24).toString('base64url'), createdBy: 'sistem · misafir portalı', createdAt: invitedAt, invitedAt, lastUsedAt: null });
    if (rand() >= 0.55) continue;
    const submittedAt = new Date(Math.min(now.getTime() - 3_600_000, invitedAt.getTime() + (2 + Math.floor(rand() * 20)) * 3_600_000));
    links.at(-1).lastUsedAt = submittedAt;
    const roll = rand();
    const status = offset === 0 ? (roll < 0.7 ? 'APPROVED' : 'SUBMITTED') : roll < 0.5 ? 'SUBMITTED' : roll < 0.88 ? 'APPROVED' : 'REJECTED';
    submit(reservation, status, submittedAt);
  }
  for (const reservation of inHouse) {
    links.push({ hotelId, reservationId: reservation.id, nonce: randomBytes(24).toString('base64url'), createdBy: 'sistem · misafir portalı', createdAt: new Date(core.toUtcDayStart(reservation.checkIn) - 3 * DAY_MS), invitedAt: new Date(core.toUtcDayStart(reservation.checkIn) - 3 * DAY_MS), lastUsedAt: null });
    if (rand() < 0.4) submit(reservation, 'COMPLETED', new Date(core.toUtcDayStart(reservation.checkIn) - DAY_MS));
  }

  for (const [key, buffer] of writes) await saveFile(key, buffer);
  await prisma.$transaction(async (tx) => {
    await tx.guestPortalLink.createMany({ data: links });
    await tx.onlineCheckin.createMany({ data: checkins.map(({ docs, ...row }) => row) });
    await tx.onlineCheckinDocument.createMany({ data: checkins.flatMap((row) => row.docs ?? []) });
  });
  return { links: links.length, checkins: checkins.length, documents };
}

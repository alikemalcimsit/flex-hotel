import { sum, toIsoDay, toMoneyString } from '@hotelos/core';
import { prisma } from '../../db.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { guestFullName } from './guests.js';

/**
 * Grup dosyası (modül 30): grubun kimliği, bağlı rezervasyonları ve folyo
 * bakiyeleri tek ekranda — toplu oda atama / giriş / çıkış butonları bu
 * listeden beslenir. Salt okunur: toplu işlemler kendi uçlarından (bulk)
 * geçer, grup iptali modül 4'ün ucundan.
 */

/** Para her zaman metin ve iki ondalık; toplamalar decimal ile (Number kayması yok). */
const money = (value) => toMoneyString(value === null || value === undefined ? '0' : value.toString());
const totalOf = (values) => (values.length === 0 ? '0.00' : toMoneyString(sum(...values)));

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listGroups(hotelId, query) {
  const where = {
    hotelId,
    deletedAt: null,
    ...(query.search
      ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.reservationGroup.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        code: true,
        name: true,
        createdAt: true,
        reservations: { where: { deletedAt: null }, select: { status: true, checkIn: true, checkOut: true } },
      },
      ...toSkipTake(query),
    }),
    prisma.reservationGroup.count({ where }),
  ]);

  const rows = items.map((group) => {
    const open = group.reservations.filter((row) => row.status === 'PENDING' || row.status === 'CONFIRMED').length;
    const inHouse = group.reservations.filter((row) => row.status === 'CHECKED_IN').length;
    const checkIns = group.reservations.map((row) => toIsoDay(row.checkIn)).sort();
    const checkOuts = group.reservations.map((row) => toIsoDay(row.checkOut)).sort();
    return {
      id: group.id,
      code: group.code,
      name: group.name,
      rooms: group.reservations.length,
      open,
      inHouse,
      checkIn: checkIns[0] ?? null,
      checkOut: checkOuts.at(-1) ?? null,
      createdAt: group.createdAt.toISOString(),
    };
  });
  return buildPage(rows, total, query);
}

/**
 * Grup dosyası: grup + rezervasyonlar (misafir, oda, durum, fiyat, açık folyo
 * bakiyesi) + toplamlar. Birleştirilen (TRANSFERRED) folyonun bakiyesi taşındığı
 * folyoda sayılır, burada sayılmaz.
 *
 * @param {string} hotelId
 * @param {string} groupId
 */
export async function getGroupFile(hotelId, groupId) {
  const group = await prisma.reservationGroup.findFirst({
    where: { id: groupId, hotelId, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      notes: true,
      createdBy: true,
      createdAt: true,
      reservations: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: 'asc' }],
        select: {
          id: true,
          confirmationCode: true,
          status: true,
          checkIn: true,
          checkOut: true,
          adults: true,
          children: true,
          boardType: true,
          totalPrice: true,
          currency: true,
          updatedAt: true,
          guest: { select: { id: true, firstName: true, lastName: true } },
          roomType: { select: { id: true, code: true, name: true } },
          room: { select: { id: true, number: true } },
          agency: { select: { id: true, code: true, name: true } },
          folios: { where: { status: { not: 'TRANSFERRED' } }, select: { balance: true, status: true } },
        },
      },
    },
  });
  if (!group) throw new NotFoundError('Grup bulunamadı');

  const reservations = group.reservations.map((row) => ({
    id: row.id,
    confirmationCode: row.confirmationCode,
    status: row.status,
    checkIn: toIsoDay(row.checkIn),
    checkOut: toIsoDay(row.checkOut),
    adults: row.adults,
    children: row.children,
    boardType: row.boardType,
    totalPrice: money(row.totalPrice),
    currency: row.currency,
    balance: totalOf(row.folios.map((folio) => folio.balance.toString())),
    hasOpenFolio: row.folios.some((folio) => folio.status === 'OPEN'),
    updatedAt: row.updatedAt.toISOString(),
    guest: { id: row.guest.id, name: guestFullName(row.guest) },
    roomType: row.roomType,
    room: row.room,
    agency: row.agency,
  }));

  const byStatus = {};
  for (const row of reservations) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

  return {
    id: group.id,
    code: group.code,
    name: group.name,
    notes: group.notes ?? null,
    createdBy: group.createdBy,
    createdAt: group.createdAt.toISOString(),
    reservations,
    summary: {
      rooms: reservations.length,
      byStatus,
      totalPrice: totalOf(reservations.map((row) => row.totalPrice)),
      openBalance: totalOf(reservations.map((row) => row.balance)),
      currency: reservations[0]?.currency ?? null,
    },
  };
}

import { currentActor } from '@hotelos/core';
import { recordAudit } from '../../lib/audit.js';
import { StaleWriteError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { hrContext, prisma } from './shared.js';

/**
 * İK ayarları (modül 52): hafta tatili günü, günlük / haftalık çalışma normu, resmî tatiller, izin onayı, belge hatırlatma.
 */

/** @param {string} hotelId */
export async function getHrSettings(hotelId) {
  const context = await hrContext(hotelId);
  const { holidaySet, ...settings } = context.settings;
  return { settings, today: context.today };
}

/**
 * @param {string} hotelId
 * @param {{ expectedUpdatedAt: Date | null, weeklyRestDay: number, dailyWorkMinutes: number, weeklyWorkMinutes: number, publicHolidays: Array<{ date: string, name: string }>, leaveApprovalRequired: boolean, documentReminderDays: number }} input
 */
export async function saveHrSettings(hotelId, input) {
  const context = await hrContext(hotelId);
  if (input.expectedUpdatedAt && context.settings.updatedAt && new Date(context.settings.updatedAt).getTime() !== input.expectedUpdatedAt.getTime()) {
    throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
  }
  const data = {
    weeklyRestDay: input.weeklyRestDay,
    dailyWorkMinutes: input.dailyWorkMinutes,
    weeklyWorkMinutes: input.weeklyWorkMinutes,
    publicHolidays: [...input.publicHolidays].sort((a, b) => a.date.localeCompare(b.date)),
    leaveApprovalRequired: input.leaveApprovalRequired,
    documentReminderDays: input.documentReminderDays,
    updatedBy: currentActor(),
  };
  await writeWithEvents(async (tx, stage) => {
    await tx.hrSettings.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
    const { holidaySet, isDefault, updatedAt, updatedBy, ...before } = context.settings;
    await recordAudit(tx, { hotelId, entity: 'HrSettings', entityId: hotelId, action: 'UPDATE', before, after: { ...data, updatedBy: undefined } });
    await stage('hr.changed', { hotelId, area: 'SETTINGS' });
  });
  return getHrSettings(hotelId);
}

export { prisma };

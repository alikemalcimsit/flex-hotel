import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { writeWithEvents } from '../../lib/write.js';
import { ensureTreasuryGlAccount, prisma } from './shared.js';

/**
 * Genel muhasebenin süreç içi dinleyicisi (modül 48): yeni kasa / banka hesabı açılınca hesap planında 100 / 102
 * altında alt hesabı ve TREASURY kuralı kendiliğinden açılır (hesap planı yüklüyse; yüklü değilse ilk yüklemede toplu).
 * Otomatik fişler burada değil, muhasebe aktöründe.
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

async function onTreasuryCreated(payload) {
  const settings = await prisma.accountingSettings.findUnique({ where: { hotelId: payload.hotelId }, select: { glChartSeededAt: true } });
  if (!settings?.glChartSeededAt) return;
  const treasury = await prisma.treasuryAccount.findFirst({ where: { id: payload.treasuryAccountId, hotelId: payload.hotelId }, select: { id: true, kind: true, name: true, currency: true } });
  if (!treasury) return;
  await writeWithEvents(async (tx, stage) => {
    await ensureTreasuryGlAccount(tx, payload.hotelId, treasury);
    await stage('ledger.changed', { hotelId: payload.hotelId, change: 'CHART', journalIds: [] });
  });
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerLedgerSubscribers() {
  stopLedgerSubscribers();
  unsubscribers = [
    eventBus.subscribe('accounting.treasury.changed', 'ledger:treasury-account', (payload, envelope) => {
      if (payload.change !== 'CREATED') return Promise.resolve();
      return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: 'system' }, () => onTreasuryCreated(payload));
    }),
  ];
  return stopLedgerSubscribers;
}

export function stopLedgerSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}

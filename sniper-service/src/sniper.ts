import { resyClient } from './resy-client.js';
import { openTableClient } from './opentable-client.js';
import { getPendingSnipes, updateSnipe, type Snipe } from './store.js';
import { notifySlotFound, notifyBookingSuccess, notifySnipeFailed } from './notifications.js';

const POLL_INTERVAL_MS = 500;
const PRE_RELEASE_START_MS = 30000; // Start 30 seconds early
const MAX_POLL_DURATION_MS = 120000; // Give up after 2 minutes

const scheduledSnipes = new Map<string, NodeJS.Timeout>();

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const normalized = timeStr.trim().toUpperCase();

  const match12 = normalized.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2] || '0', 10);
    const period = match12[3];

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return { hours, minutes };
  }

  const match24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return {
      hours: parseInt(match24[1], 10),
      minutes: parseInt(match24[2], 10),
    };
  }

  throw new Error(`Cannot parse time: ${timeStr}`);
}

function timeMatchesPreference(slotTime: string, preferredTime: string): boolean {
  try {
    const slot = parseTime(slotTime);
    const preferred = parseTime(preferredTime);
    const slotMinutes = slot.hours * 60 + slot.minutes;
    const preferredMinutes = preferred.hours * 60 + preferred.minutes;
    return Math.abs(slotMinutes - preferredMinutes) <= 15;
  } catch {
    return false;
  }
}

async function executeResySnipe(snipe: Snipe): Promise<string> {
  const startTime = Date.now();
  console.log(`[Sniper] Starting Resy snipe for ${snipe.restaurantName}`);

  while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
    const slots = await resyClient.getAvailability(snipe.restaurantId, snipe.date, snipe.partySize);

    for (const preferredTime of snipe.preferredTimes) {
      const matchingSlot = slots.find((slot) => {
        const slotTimeStr = new Date(slot.date.start).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        });
        return timeMatchesPreference(slotTimeStr, preferredTime);
      });

      if (matchingSlot) {
        console.log(`[Sniper] Found slot at ${matchingSlot.date.start}, booking...`);

        const details = await resyClient.getBookingDetails(
          String(matchingSlot.config.id),
          snipe.date,
          snipe.partySize
        );

        const defaultPayment = details.user.payment_methods?.find(p => p.is_default);
        const result = await resyClient.makeReservation(details.book_token.value, defaultPayment?.id);

        const successMsg = `Booked! Confirmation: ${result.reservation_id}`;
        await notifyBookingSuccess(snipe.restaurantName, snipe.date, matchingSlot.date.start, String(result.reservation_id));

        return successMsg;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('Timed out - no matching slots found');
}

async function executeOpenTableSnipe(snipe: Snipe): Promise<string> {
  const startTime = Date.now();
  console.log(`[Sniper] Starting OpenTable snipe for ${snipe.restaurantName}`);

  while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
    const slots = await openTableClient.getAvailability(snipe.restaurantId, snipe.date, snipe.partySize);

    for (const preferredTime of snipe.preferredTimes) {
      const matchingSlot = slots.find((slot) => timeMatchesPreference(slot.time, preferredTime));

      if (matchingSlot) {
        console.log(`[Sniper] Found OpenTable slot at ${matchingSlot.time}`);

        // OpenTable can't auto-book - send notification with link
        await notifySlotFound(
          snipe.restaurantName,
          snipe.date,
          matchingSlot.time,
          'opentable',
          matchingSlot.bookingUrl
        );

        return `Slot found! Book here: ${matchingSlot.bookingUrl}`;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('Timed out - no matching slots found');
}

async function executeSnipe(snipe: Snipe, platform: 'resy' | 'opentable'): Promise<void> {
  await updateSnipe(snipe.id, 'running');
  console.log(`[Sniper] Executing snipe ${snipe.id} for ${snipe.restaurantName}`);

  try {
    let result: string;

    if (platform === 'resy') {
      result = await executeResySnipe(snipe);
    } else {
      result = await executeOpenTableSnipe(snipe);
    }

    await updateSnipe(snipe.id, 'success', result);
    console.log(`[Sniper] Success: ${result}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await updateSnipe(snipe.id, 'failed', message);
    await notifySnipeFailed(snipe.restaurantName, snipe.date, message);
    console.error(`[Sniper] Failed: ${message}`);
  }
}

export function scheduleSnipe(snipe: Snipe, platform: 'resy' | 'opentable'): void {
  // Cancel existing schedule if any
  cancelSnipe(snipe.id);

  const releaseTime = new Date(snipe.releaseTime).getTime();
  const startTime = releaseTime - PRE_RELEASE_START_MS;
  const delay = Math.max(0, startTime - Date.now());

  console.log(`[Sniper] Scheduled ${snipe.id} for ${snipe.restaurantName} in ${Math.round(delay / 1000)}s`);

  const timeout = setTimeout(() => {
    executeSnipe(snipe, platform);
  }, delay);

  scheduledSnipes.set(snipe.id, timeout);
}

export function cancelSnipe(snipeId: string): boolean {
  const timeout = scheduledSnipes.get(snipeId);
  if (timeout) {
    clearTimeout(timeout);
    scheduledSnipes.delete(snipeId);
    return true;
  }
  return false;
}

export function isSnipeScheduled(snipeId: string): boolean {
  return scheduledSnipes.has(snipeId);
}

export async function loadPendingSnipes(): Promise<void> {
  const pending = await getPendingSnipes();
  console.log(`[Sniper] Loading ${pending.length} pending snipes`);

  for (const snipe of pending) {
    const releaseTime = new Date(snipe.releaseTime).getTime();

    if (releaseTime < Date.now()) {
      await updateSnipe(snipe.id, 'failed', 'Missed release time (server was restarted)');
      continue;
    }

    // Determine platform from restaurant ID format or default to resy
    const platform = snipe.restaurantName.toLowerCase().includes('opentable') ? 'opentable' : 'resy';
    scheduleSnipe(snipe, platform);
  }
}

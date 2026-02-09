import { resyClient } from '../resy/client.js';
import { openTableClient } from '../opentable/client.js';
import { updateSnipeStatus } from './store.js';
const POLL_INTERVAL_MS = 500;
const PRE_RELEASE_START_MS = 30000; // Start polling 30 seconds before release
const MAX_POLL_DURATION_MS = 120000; // Give up after 2 minutes
function parseTime(timeStr) {
    // Handle formats like "7:00 PM", "19:00", "7:30PM"
    const normalized = timeStr.trim().toUpperCase();
    const match12 = normalized.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/);
    if (match12) {
        let hours = parseInt(match12[1], 10);
        const minutes = parseInt(match12[2] || '0', 10);
        const period = match12[3];
        if (period === 'PM' && hours !== 12)
            hours += 12;
        if (period === 'AM' && hours === 12)
            hours = 0;
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
function timeMatchesPreference(slotTime, preferredTime) {
    try {
        const slot = parseTime(slotTime);
        const preferred = parseTime(preferredTime);
        // Allow 15-minute flexibility
        const slotMinutes = slot.hours * 60 + slot.minutes;
        const preferredMinutes = preferred.hours * 60 + preferred.minutes;
        return Math.abs(slotMinutes - preferredMinutes) <= 15;
    }
    catch {
        return false;
    }
}
async function executeResySnipe(config) {
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
        const slots = await resyClient.getAvailability(parseInt(config.restaurantId, 10), config.date, config.partySize);
        // Find first slot matching any preferred time
        for (const preferredTime of config.preferredTimes) {
            const matchingSlot = slots.find((slot) => {
                const slotTimeStr = new Date(slot.time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                });
                return timeMatchesPreference(slotTimeStr, preferredTime);
            });
            if (matchingSlot) {
                // Found a slot! Try to book it immediately
                const details = await resyClient.getBookingDetails(matchingSlot.slotId, config.date, config.partySize);
                const result = await resyClient.makeReservation(details.book_token.value);
                return `Successfully booked! Reservation ID: ${result.reservation_id}, Time: ${matchingSlot.time}`;
            }
        }
        // No matching slots yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error('Snipe timed out - no matching slots became available');
}
async function executeOpenTableSnipe(config) {
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
        const slots = await openTableClient.getAvailability(parseInt(config.restaurantId, 10), config.date, config.partySize);
        // Find first slot matching any preferred time
        for (const preferredTime of config.preferredTimes) {
            const matchingSlot = slots.find((slot) => timeMatchesPreference(slot.time, preferredTime));
            if (matchingSlot) {
                // OpenTable can't complete booking via API, return the URL
                return `Slot found! Complete booking at: ${matchingSlot.bookingUrl}`;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error('Snipe timed out - no matching slots became available');
}
export async function executeSnipe(config) {
    await updateSnipeStatus(config.id, 'running');
    try {
        let result;
        if (config.platform === 'resy') {
            result = await executeResySnipe(config);
        }
        else {
            result = await executeOpenTableSnipe(config);
        }
        await updateSnipeStatus(config.id, 'success', result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await updateSnipeStatus(config.id, 'failed', message);
    }
}
export function scheduleSnipe(config) {
    const releaseTime = new Date(config.releaseTime).getTime();
    const startTime = releaseTime - PRE_RELEASE_START_MS;
    const delay = Math.max(0, startTime - Date.now());
    return setTimeout(() => {
        executeSnipe(config);
    }, delay);
}

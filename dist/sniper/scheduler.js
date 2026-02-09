import { getPendingSnipes, getSnipe, updateSnipeStatus } from './store.js';
import { scheduleSnipe } from './executor.js';
const scheduledSnipes = new Map();
export async function startScheduler() {
    // Load and schedule all pending snipes on startup
    const pending = await getPendingSnipes();
    for (const snipe of pending) {
        const releaseTime = new Date(snipe.releaseTime).getTime();
        // Skip snipes whose release time has passed
        if (releaseTime < Date.now()) {
            await updateSnipeStatus(snipe.id, 'failed', 'Missed release time (server was not running)');
            continue;
        }
        scheduleSnipeJob(snipe);
    }
}
export function scheduleSnipeJob(config) {
    // Cancel existing schedule if any
    cancelSnipeJob(config.id);
    const timeout = scheduleSnipe(config);
    scheduledSnipes.set(config.id, timeout);
}
export function cancelSnipeJob(snipeId) {
    const timeout = scheduledSnipes.get(snipeId);
    if (timeout) {
        clearTimeout(timeout);
        scheduledSnipes.delete(snipeId);
        return true;
    }
    return false;
}
export function isSnipeScheduled(snipeId) {
    return scheduledSnipes.has(snipeId);
}
export function getScheduledSnipeIds() {
    return Array.from(scheduledSnipes.keys());
}
export async function getSnipeStatus(snipeId) {
    return getSnipe(snipeId);
}
export function stopScheduler() {
    for (const [id, timeout] of scheduledSnipes) {
        clearTimeout(timeout);
        scheduledSnipes.delete(id);
    }
}

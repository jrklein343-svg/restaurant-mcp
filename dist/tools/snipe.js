import { z } from 'zod';
import { createSnipe, listSnipes, deleteSnipe, getSnipe, updateSnipeStatus } from '../sniper/store.js';
import { scheduleSnipeJob, cancelSnipeJob, isSnipeScheduled } from '../sniper/scheduler.js';
export const snipeReservationSchema = z.object({
    restaurant_id: z.string().min(1).describe('Restaurant ID (e.g., resy-12345)'),
    platform: z.enum(['resy', 'opentable']).describe('Platform'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Target reservation date (YYYY-MM-DD)'),
    party_size: z.number().int().min(1).max(20).describe('Number of guests'),
    preferred_times: z.array(z.string()).min(1).max(5).describe('Preferred time slots in order of preference (e.g., ["7:00 PM", "7:30 PM"])'),
    release_time: z.string().describe('When slots become available (ISO 8601 datetime, e.g., "2025-02-01T09:00:00")'),
});
function extractNumericId(fullId, platform) {
    const prefix = `${platform}-`;
    if (fullId.startsWith(prefix)) {
        return fullId.slice(prefix.length);
    }
    return fullId;
}
export async function snipeReservation(input) {
    const releaseDate = new Date(input.release_time);
    if (releaseDate.getTime() < Date.now()) {
        return {
            success: false,
            snipeId: '',
            message: 'Release time must be in the future',
            scheduledFor: input.release_time,
        };
    }
    const numericId = extractNumericId(input.restaurant_id, input.platform);
    const snipe = await createSnipe({
        restaurantId: numericId,
        platform: input.platform,
        date: input.date,
        partySize: input.party_size,
        preferredTimes: input.preferred_times,
        releaseTime: input.release_time,
    });
    scheduleSnipeJob(snipe);
    return {
        success: true,
        snipeId: snipe.id,
        message: `Snipe scheduled! Will attempt to book at ${input.release_time}`,
        scheduledFor: input.release_time,
    };
}
export const listSnipesSchema = z.object({});
export async function listScheduledSnipes(_input) {
    const snipes = await listSnipes();
    return snipes.map((s) => ({
        id: s.id,
        restaurantId: s.restaurantId,
        platform: s.platform,
        date: s.date,
        partySize: s.partySize,
        preferredTimes: s.preferredTimes,
        releaseTime: s.releaseTime,
        status: s.status,
        isScheduled: isSnipeScheduled(s.id),
        result: s.result,
    }));
}
export const cancelSnipeSchema = z.object({
    snipe_id: z.string().min(1).describe('Snipe ID to cancel'),
});
export async function cancelSnipe(input) {
    const snipe = await getSnipe(input.snipe_id);
    if (!snipe) {
        return {
            success: false,
            message: 'Snipe not found',
        };
    }
    if (snipe.status !== 'pending') {
        return {
            success: false,
            message: `Cannot cancel snipe with status: ${snipe.status}`,
        };
    }
    cancelSnipeJob(input.snipe_id);
    await updateSnipeStatus(input.snipe_id, 'cancelled');
    await deleteSnipe(input.snipe_id);
    return {
        success: true,
        message: 'Snipe cancelled successfully',
    };
}

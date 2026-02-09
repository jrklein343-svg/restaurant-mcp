import { z } from 'zod';
import { resyClient } from '../resy/client.js';
import { openTableClient } from '../opentable/client.js';
export const checkAvailabilitySchema = z.object({
    restaurant_id: z.string().min(1).describe('Restaurant ID (e.g., resy-12345 or opentable-67890)'),
    platform: z.enum(['resy', 'opentable']).describe('Platform the restaurant is on'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date to check (YYYY-MM-DD)'),
    party_size: z.number().int().min(1).max(20).describe('Number of guests'),
});
function extractNumericId(fullId, platform) {
    // Handle IDs like "resy-12345" or just "12345"
    const prefix = `${platform}-`;
    if (fullId.startsWith(prefix)) {
        return fullId.slice(prefix.length);
    }
    return fullId;
}
export async function checkAvailability(input) {
    const numericId = extractNumericId(input.restaurant_id, input.platform);
    if (input.platform === 'resy') {
        const slots = await resyClient.getAvailability(parseInt(numericId, 10), input.date, input.party_size);
        return {
            restaurantId: input.restaurant_id,
            platform: 'resy',
            date: input.date,
            partySize: input.party_size,
            slots: slots.map((s) => ({
                slotId: s.slotId,
                time: s.time,
                endTime: s.endTime,
                type: s.type,
                cancellationFee: s.cancellationFee,
                depositFee: s.depositFee,
            })),
        };
    }
    else {
        const slots = await openTableClient.getAvailability(parseInt(numericId, 10), input.date, input.party_size);
        return {
            restaurantId: input.restaurant_id,
            platform: 'opentable',
            date: input.date,
            partySize: input.party_size,
            slots: slots.map((s) => ({
                slotId: s.slotId,
                time: s.time,
                bookingUrl: s.bookingUrl,
            })),
        };
    }
}

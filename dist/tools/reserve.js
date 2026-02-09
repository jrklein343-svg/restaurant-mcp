import { z } from 'zod';
import { resyClient } from '../resy/client.js';
import { openTableClient } from '../opentable/client.js';
export const makeReservationSchema = z.object({
    restaurant_id: z.string().min(1).describe('Restaurant ID'),
    platform: z.enum(['resy', 'opentable']).describe('Platform'),
    slot_id: z.string().min(1).describe('Time slot ID from check_availability'),
    party_size: z.number().int().min(1).max(20).describe('Number of guests'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Reservation date (YYYY-MM-DD)'),
});
function extractNumericId(fullId, platform) {
    const prefix = `${platform}-`;
    if (fullId.startsWith(prefix)) {
        return fullId.slice(prefix.length);
    }
    return fullId;
}
export async function makeReservation(input) {
    if (input.platform === 'resy') {
        try {
            // First get booking details (includes book token and payment methods)
            const details = await resyClient.getBookingDetails(input.slot_id, input.date, input.party_size);
            // Get default payment method if available
            const defaultPayment = details.user.payment_methods?.find((p) => p.is_default);
            // Make the reservation
            const result = await resyClient.makeReservation(details.book_token.value, defaultPayment?.id);
            return {
                success: true,
                platform: 'resy',
                reservationId: String(result.reservation_id),
                confirmationDetails: `Reservation confirmed! ID: ${result.reservation_id}`,
            };
        }
        catch (error) {
            return {
                success: false,
                platform: 'resy',
                error: error instanceof Error ? error.message : 'Failed to make reservation',
            };
        }
    }
    else {
        // OpenTable cannot complete booking via API
        const numericId = extractNumericId(input.restaurant_id, 'opentable');
        const slotParts = input.slot_id.split('-');
        const time = slotParts[slotParts.length - 1] || '19:00';
        const bookingUrl = await openTableClient.getBookingUrl(parseInt(numericId, 10), input.date, time, input.party_size);
        return {
            success: true,
            platform: 'opentable',
            bookingUrl,
            confirmationDetails: 'OpenTable requires completing booking on their website. Use the provided URL.',
        };
    }
}

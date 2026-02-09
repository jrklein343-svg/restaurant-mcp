import { z } from 'zod';
import { resyClient } from '../resy/client.js';
export const listReservationsSchema = z.object({
    platform: z.enum(['resy', 'opentable', 'all']).default('all').describe('Which platform to list reservations from'),
});
export async function listReservations(input) {
    const results = [];
    if (input.platform === 'resy' || input.platform === 'all') {
        try {
            const resyReservations = await resyClient.getReservations();
            for (const r of resyReservations) {
                results.push({
                    platform: 'resy',
                    reservationId: r.reservationId,
                    restaurantName: r.venue.name,
                    location: r.venue.location,
                    date: r.date,
                    time: r.time,
                    partySize: r.partySize,
                    status: r.status,
                });
            }
        }
        catch {
            // Skip if not authenticated
        }
    }
    // Note: OpenTable doesn't provide an API to list reservations
    // Would need to scrape or use browser automation
    return results;
}
export const cancelReservationSchema = z.object({
    reservation_id: z.string().min(1).describe('Reservation ID to cancel'),
    platform: z.enum(['resy', 'opentable']).describe('Platform the reservation is on'),
});
export async function cancelReservation(input) {
    if (input.platform === 'resy') {
        try {
            await resyClient.cancelReservation(input.reservation_id);
            return {
                success: true,
                message: 'Reservation cancelled successfully',
            };
        }
        catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to cancel reservation',
            };
        }
    }
    else {
        return {
            success: false,
            message: 'OpenTable reservations must be cancelled on their website',
        };
    }
}

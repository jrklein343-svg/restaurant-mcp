/**
 * Tock platform client implementing PlatformClient interface
 * NOTE: Tock does not have a public API (exploretock.com/api is not real).
 * Search, details, and availability return empty results.
 * Booking URL construction still works for manual use.
 */
import { BasePlatformClient } from './base.js';
const BASE_URL = 'https://www.exploretock.com';
export class TockPlatformClient extends BasePlatformClient {
    name = 'tock';
    async search(_query) {
        // Tock does not have a public API
        console.error('Tock search unavailable: no public API exists. Use exploretock.com directly.');
        return [];
    }
    async getDetails(_id) {
        // Tock does not have a public API
        return null;
    }
    async getAvailability(_id, _date, _partySize) {
        // Tock does not have a public API
        return [];
    }
    async makeReservation(params) {
        // Tock requires completing booking on their website
        const venueId = this.extractId(params.restaurantId);
        const bookingUrl = this.buildBookingUrl(venueId, params.date, params.partySize);
        return {
            success: true,
            platform: this.name,
            bookingUrl,
            confirmationDetails: 'Tock requires completing booking on their website. Use the provided URL.',
        };
    }
    async isAvailable() {
        // Tock does not have a public API
        return false;
    }
    async isAuthenticated() {
        return true;
    }
    // Build booking URL
    buildBookingUrl(venueId, date, partySize) {
        const params = new URLSearchParams({
            date,
            size: String(partySize),
        });
        return `${BASE_URL}/${venueId}?${params.toString()}`;
    }
}
// Singleton instance
export const tockClient = new TockPlatformClient();

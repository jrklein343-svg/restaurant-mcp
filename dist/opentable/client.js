import axios from 'axios';
const BASE_URL = 'https://www.opentable.com/restref/api';
const BOOKING_BASE = 'https://www.opentable.com/booking/experiences-availability';
export class OpenTableClient {
    client;
    constructor() {
        this.client = axios.create({
            baseURL: BASE_URL,
            timeout: 30000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });
    }
    async search(query, location, _cuisine) {
        try {
            const response = await this.client.get('/restaurants', {
                params: {
                    name: query,
                    city: location,
                },
            });
            return (response.data.restaurants || []).map((r) => ({
                id: r.rid,
                name: r.name,
                address: r.address,
                city: r.city,
                cuisine: r.cuisine || '',
                priceRange: r.price_range || 0,
                rating: r.rating || 0,
                reviewsCount: r.reviews_count || 0,
                imageUrl: r.photos?.[0],
            }));
        }
        catch {
            // OpenTable's public API is limited; return empty on failure
            return [];
        }
    }
    async getAvailability(restaurantId, date, partySize) {
        try {
            const response = await this.client.get('/availability', {
                params: {
                    rid: restaurantId,
                    datetime: `${date}T19:00`,
                    party_size: partySize,
                },
            });
            const daySlots = response.data.availability?.[date] || [];
            return daySlots
                .filter((slot) => slot.available)
                .map((slot) => ({
                slotId: `ot-${restaurantId}-${date}-${slot.time}`,
                time: slot.time,
                bookingUrl: this.buildBookingUrl(restaurantId, date, slot.time, partySize),
            }));
        }
        catch {
            // Return empty if API fails
            return [];
        }
    }
    buildBookingUrl(restaurantId, date, time, partySize) {
        const params = new URLSearchParams({
            rid: String(restaurantId),
            datetime: `${date}T${time}`,
            covers: String(partySize),
        });
        return `${BOOKING_BASE}?${params.toString()}`;
    }
    async getBookingUrl(restaurantId, date, time, partySize) {
        return this.buildBookingUrl(restaurantId, date, time, partySize);
    }
}
export const openTableClient = new OpenTableClient();

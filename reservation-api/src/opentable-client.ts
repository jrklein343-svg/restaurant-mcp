import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://www.opentable.com/restref/api';
const BOOKING_BASE = 'https://www.opentable.com/booking/experiences-availability';

export interface OpenTableSearchResult {
  id: number;
  name: string;
  address: string;
  city: string;
  cuisine: string;
  priceRange: number;
  rating: number;
}

export interface OpenTableSlot {
  time: string;
  bookingUrl: string;
}

export class OpenTableClient {
  private client: AxiosInstance;

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

  async search(query: string, location: string): Promise<OpenTableSearchResult[]> {
    try {
      console.log(`[OpenTable] Searching: query="${query}", location="${location}"`);
      const response = await this.client.get('/restaurants', {
        params: { name: query, city: location },
      });
      console.log(`[OpenTable] Found ${response.data.restaurants?.length || 0} results`);
      return (response.data.restaurants || []).map((r: any) => ({
        id: r.rid,
        name: r.name,
        address: r.address,
        city: r.city,
        cuisine: r.cuisine || '',
        priceRange: r.price_range || 0,
        rating: r.rating || 0,
      }));
    } catch (error) {
      console.error('[OpenTable] Search error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  async getAvailability(restaurantId: number, date: string, partySize: number): Promise<OpenTableSlot[]> {
    try {
      const response = await this.client.get('/availability', {
        params: { rid: restaurantId, datetime: `${date}T19:00`, party_size: partySize },
      });
      const daySlots = response.data.availability?.[date] || [];
      return daySlots
        .filter((slot: any) => slot.available)
        .map((slot: any) => ({
          time: slot.time,
          bookingUrl: `${BOOKING_BASE}?rid=${restaurantId}&datetime=${date}T${slot.time}&covers=${partySize}`,
        }));
    } catch {
      return [];
    }
  }
}

export const openTableClient = new OpenTableClient();

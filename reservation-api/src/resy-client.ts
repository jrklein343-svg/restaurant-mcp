import axios, { AxiosInstance, AxiosError } from 'axios';

const BASE_URL = 'https://api.resy.com';
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

export interface ResySlot {
  slotId: string;
  token: string;
  time: string;
  endTime: string;
  type: string;
}

export interface ResySearchResult {
  id: number;
  name: string;
  location: string;
  neighborhood: string;
  cuisine: string;
  priceRange: number;
  rating: number;
}

export class ResyClient {
  private client: AxiosInstance;
  private apiKey: string;
  private authToken: string | null = null;
  private email: string | null;
  private password: string | null;

  constructor() {
    this.apiKey = process.env.RESY_API_KEY || DEFAULT_API_KEY;
    this.email = process.env.RESY_EMAIL || null;
    this.password = process.env.RESY_PASSWORD || null;
    this.client = axios.create({ baseURL: BASE_URL, timeout: 30000 });
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `ResyAPI api_key="${this.apiKey}"`,
    };
    if (this.authToken) {
      headers['x-resy-auth-token'] = this.authToken;
    }
    return headers;
  }

  async login(): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error('RESY_EMAIL and RESY_PASSWORD required');
    }
    const response = await this.client.post(
      '/3/auth/password',
      new URLSearchParams({ email: this.email, password: this.password }).toString(),
      { headers: this.getHeaders() }
    );
    this.authToken = response.data.token;
  }

  async ensureAuth(): Promise<void> {
    if (!this.authToken) await this.login();
  }

  private async request<T>(method: 'get' | 'post', url: string, data?: Record<string, string | number>, retry = true): Promise<T> {
    await this.ensureAuth();
    try {
      const config = { headers: this.getHeaders() };
      let response;
      if (method === 'get') {
        response = await this.client.get<T>(url, { ...config, params: data });
      } else {
        const body = data ? new URLSearchParams(data as Record<string, string>).toString() : '';
        response = await this.client.post<T>(url, body, config);
      }
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401 && retry) {
        await this.login();
        return this.request<T>(method, url, data, false);
      }
      throw error;
    }
  }

  // Search does NOT require authentication - it's a public endpoint
  async search(query: string, location: string, date: string, partySize: number): Promise<ResySearchResult[]> {
    interface FindResponse {
      search: { hits: Array<{ id: { resy: number }; name: string; location: { name: string; neighborhood: string }; cuisine: string[]; price_range: number; rating: number }> };
    }
    try {
      const searchQuery = `${query} ${location}`.trim();
      console.log(`[Resy] Searching: query="${searchQuery}", date=${date}, partySize=${partySize}`);
      const response = await this.client.get<FindResponse>('/4/find', {
        params: { lat: 0, long: 0, day: date, party_size: partySize, query: searchQuery },
        headers: { 'Authorization': `ResyAPI api_key="${this.apiKey}"` },
      });
      const hits = response.data.search?.hits || [];
      console.log(`[Resy] Found ${hits.length} results`);
      return hits.map((hit) => ({
        id: hit.id.resy,
        name: hit.name,
        location: hit.location?.name || '',
        neighborhood: hit.location?.neighborhood || '',
        cuisine: Array.isArray(hit.cuisine) ? hit.cuisine.join(', ') : '',
        priceRange: hit.price_range || 0,
        rating: hit.rating || 0,
      }));
    } catch (error) {
      console.error('[Resy] Search error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // Get availability does NOT require authentication - it's a public endpoint
  async getAvailability(venueId: number, date: string, partySize: number): Promise<ResySlot[]> {
    interface VenueSlotsResponse {
      results: { venues: Array<{ slots: Array<{ config: { id: number; type: string; token: string }; date: { start: string; end: string } }> }> };
    }
    try {
      const response = await this.client.get<VenueSlotsResponse>('/4/find', {
        params: { lat: 0, long: 0, day: date, party_size: partySize, venue_id: venueId },
        headers: { 'Authorization': `ResyAPI api_key="${this.apiKey}"` },
      });
      const venue = response.data.results?.venues?.[0];
      if (!venue?.slots) return [];
      return venue.slots.map((slot) => ({
        slotId: String(slot.config.id),
        token: slot.config.token,
        time: slot.date.start,
        endTime: slot.date.end,
        type: slot.config.type,
      }));
    } catch (error) {
      console.error('[Resy] Availability error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  async getBookingDetails(configId: string, date: string, partySize: number): Promise<{ bookToken: string; paymentMethodId?: number }> {
    interface DetailsResponse {
      book_token: { value: string };
      user: { payment_methods: Array<{ id: number; is_default: boolean }> };
    }
    const data = await this.request<DetailsResponse>('get', '/3/details', {
      config_id: configId, day: date, party_size: partySize,
    });
    const defaultPayment = data.user.payment_methods?.find(p => p.is_default);
    return { bookToken: data.book_token.value, paymentMethodId: defaultPayment?.id };
  }

  async makeReservation(bookToken: string, paymentMethodId?: number): Promise<{ reservationId: number }> {
    interface BookResponse { reservation_id: number }
    const reqData: Record<string, string> = { book_token: bookToken };
    if (paymentMethodId) reqData.struct_payment_method = JSON.stringify({ id: paymentMethodId });
    const data = await this.request<BookResponse>('post', '/3/book', reqData);
    return { reservationId: data.reservation_id };
  }

  async getReservations(): Promise<Array<{ id: string; restaurant: string; date: string; time: string; partySize: number }>> {
    interface ResResponse {
      reservations: Array<{ resy_token: string; venue: { name: string }; reservation: { day: string; time_slot: string; num_seats: number } }>;
    }
    const data = await this.request<ResResponse>('get', '/3/user/reservations');
    return (data.reservations || []).map((r) => ({
      id: r.resy_token,
      restaurant: r.venue.name,
      date: r.reservation.day,
      time: r.reservation.time_slot,
      partySize: r.reservation.num_seats,
    }));
  }

  async cancelReservation(resyToken: string): Promise<void> {
    await this.request<void>('get', '/3/cancel', { resy_token: resyToken });
  }
}

export const resyClient = new ResyClient();

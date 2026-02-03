import axios, { AxiosInstance, AxiosError } from 'axios';
import { getCredential, setCredential } from '../credentials.js';
import type {
  ResySearchResult,
  ResyTimeSlot,
  ResyReservation,
  ResyLoginResponse,
  ResyBookResponse,
  ResyBookDetailsResponse,
} from './types.js';

const BASE_URL = 'https://api.resy.com';

export class ResyClient {
  private client: AxiosInstance;
  private apiKey: string | null = null;
  private authToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
    });
  }

  private async ensureCredentials(): Promise<void> {
    if (!this.apiKey) {
      this.apiKey = await getCredential('resy-api-key');
    }
    if (!this.authToken) {
      this.authToken = await getCredential('resy-auth-token');
    }
    if (!this.apiKey) {
      throw new Error('Resy API key not configured. Use set_credentials tool first.');
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.apiKey) {
      headers['Authorization'] = `ResyAPI api_key="${this.apiKey}"`;
    }
    if (this.authToken) {
      headers['x-resy-auth-token'] = this.authToken;
    }
    return headers;
  }

  private async refreshToken(): Promise<boolean> {
    const email = await getCredential('resy-email');
    const password = await getCredential('resy-password');

    if (!email || !password) {
      return false;
    }

    try {
      const response = await this.client.post<ResyLoginResponse>(
        '/3/auth/password',
        new URLSearchParams({ email, password }).toString(),
        { headers: this.getHeaders() }
      );

      this.authToken = response.data.token;
      await setCredential('resy-auth-token', this.authToken);
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(
    method: 'get' | 'post' | 'delete',
    url: string,
    data?: Record<string, string | number>,
    retry = true
  ): Promise<T> {
    await this.ensureCredentials();

    try {
      const config = {
        headers: this.getHeaders(),
      };

      let response;
      if (method === 'get') {
        response = await this.client.get<T>(url, { ...config, params: data });
      } else if (method === 'post') {
        const body = data ? new URLSearchParams(data as Record<string, string>).toString() : '';
        response = await this.client.post<T>(url, body, config);
      } else {
        response = await this.client.delete<T>(url, { ...config, params: data });
      }

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401 && retry) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          return this.request<T>(method, url, data, false);
        }
        throw new Error('Resy authentication failed. Please update credentials using set_login tool.');
      }
      throw error;
    }
  }

  async login(email: string, password: string): Promise<ResyLoginResponse> {
    await this.ensureCredentials();

    const response = await this.client.post<ResyLoginResponse>(
      '/3/auth/password',
      new URLSearchParams({ email, password }).toString(),
      { headers: this.getHeaders() }
    );

    this.authToken = response.data.token;
    await setCredential('resy-auth-token', this.authToken);
    await setCredential('resy-email', email);
    await setCredential('resy-password', password);

    return response.data;
  }

  async search(
    query: string,
    location: string,
    date: string,
    partySize: number
  ): Promise<ResySearchResult[]> {
    interface FindResponse {
      search: {
        hits: Array<{
          id: { resy: number };
          name: string;
          location: { name: string; neighborhood: string };
          cuisine: string[];
          price_range: number;
          rating: number;
          images: string[];
        }>;
      };
    }

    const data = await this.request<FindResponse>('get', '/4/find', {
      lat: 0,
      long: 0,
      day: date,
      party_size: partySize,
      query: `${query} ${location}`.trim(),
    });

    return (data.search?.hits || []).map((hit) => ({
      id: hit.id.resy,
      name: hit.name,
      location: hit.location?.name || '',
      neighborhood: hit.location?.neighborhood || '',
      cuisine: Array.isArray(hit.cuisine) ? hit.cuisine.join(', ') : hit.cuisine || '',
      priceRange: hit.price_range || 0,
      rating: hit.rating || 0,
      imageUrl: hit.images?.[0],
    }));
  }

  async getAvailability(
    venueId: number,
    date: string,
    partySize: number
  ): Promise<ResyTimeSlot[]> {
    interface VenueCalendarResponse {
      scheduled: Array<{
        date: string;
        inventory: {
          reservation: string;
        };
      }>;
    }

    interface VenueSlotsResponse {
      results: {
        venues: Array<{
          slots: Array<{
            config: { id: number; type: string; token: string };
            date: { start: string; end: string };
            payment?: { cancellation_fee?: number; deposit_fee?: number };
          }>;
        }>;
      };
    }

    // First get the calendar to check if date has availability
    try {
      await this.request<VenueCalendarResponse>('get', `/4/venue/calendar`, {
        venue_id: venueId,
        num_seats: partySize,
        start_date: date,
        end_date: date,
      });
    } catch {
      // Continue anyway, calendar check is optional
    }

    // Get actual slots
    const data = await this.request<VenueSlotsResponse>('get', '/4/find', {
      lat: 0,
      long: 0,
      day: date,
      party_size: partySize,
      venue_id: venueId,
    });

    const venue = data.results?.venues?.[0];
    if (!venue?.slots) {
      return [];
    }

    return venue.slots.map((slot) => ({
      slotId: String(slot.config.id),
      token: slot.config.token,
      time: slot.date.start,
      endTime: slot.date.end,
      type: slot.config.type,
      cancellationFee: slot.payment?.cancellation_fee,
      depositFee: slot.payment?.deposit_fee,
    }));
  }

  async getBookingDetails(
    configId: string,
    date: string,
    partySize: number
  ): Promise<ResyBookDetailsResponse> {
    return this.request<ResyBookDetailsResponse>('get', '/3/details', {
      config_id: configId,
      day: date,
      party_size: partySize,
    });
  }

  async makeReservation(
    bookToken: string,
    paymentMethodId?: number
  ): Promise<ResyBookResponse> {
    const data: Record<string, string> = {
      book_token: bookToken,
    };
    if (paymentMethodId) {
      data.struct_payment_method = JSON.stringify({ id: paymentMethodId });
    }

    return this.request<ResyBookResponse>('post', '/3/book', data);
  }

  async getReservations(): Promise<ResyReservation[]> {
    interface ReservationsResponse {
      reservations: Array<{
        resy_token: string;
        venue: { name: string; location: { name: string } };
        reservation: { day: string; time_slot: string; num_seats: number };
        status: string;
      }>;
    }

    const data = await this.request<ReservationsResponse>('get', '/3/user/reservations');

    return (data.reservations || []).map((res) => ({
      reservationId: res.resy_token,
      venue: {
        name: res.venue.name,
        location: res.venue.location?.name || '',
      },
      date: res.reservation.day,
      time: res.reservation.time_slot,
      partySize: res.reservation.num_seats,
      status: res.status,
    }));
  }

  async cancelReservation(resyToken: string): Promise<void> {
    await this.request<void>('delete', '/3/book', { resy_token: resyToken });
  }

  async verifyAuth(): Promise<boolean> {
    try {
      await this.getReservations();
      return true;
    } catch {
      return false;
    }
  }
}

export const resyClient = new ResyClient();

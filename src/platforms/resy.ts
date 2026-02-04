/**
 * Resy platform client implementing PlatformClient interface
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { getCredential, setCredential } from '../credentials.js';
import { BasePlatformClient } from './base.js';
import type {
  PlatformName,
  Restaurant,
  RestaurantDetails,
  TimeSlot,
  ReservationParams,
  ReservationResult,
  SearchQuery,
  PriceRange,
  ErrorCode,
  ReservationError,
} from '../types/restaurant.js';
import { cache, CacheKeys, CacheTTL } from '../services/cache.js';
import { rateLimiter } from '../services/rate-limiter.js';
import { parseCuisines } from '../utils/normalize.js';

const BASE_URL = 'https://api.resy.com';

// Resy API response types
interface ResyVenueHit {
  id: { resy: number };
  name: string;
  location: { name: string; neighborhood: string; time_zone?: string };
  cuisine: string[] | string;
  price_range: number;
  rating: number;
  images: string[];
  url_slug?: string;
}

interface ResyFindResponse {
  search: {
    hits: ResyVenueHit[];
  };
}

interface ResyVenueDetailsResponse {
  id: { resy: number };
  name: string;
  tagline?: string;
  type?: string;
  location: {
    name: string;
    neighborhood: string;
    address_1: string;
    address_2?: string;
    locality: string;
    region: string;
    postal_code: string;
    time_zone: string;
    geo?: { lat: number; lon: number };
  };
  contact: {
    phone_number?: string;
    url?: string;
  };
  cuisine: string[] | string;
  price_range: number;
  rating: number;
  num_ratings?: number;
  images: string[];
  content?: Array<{ title: string; body: string }>;
  social?: Array<{ type: string; url: string }>;
}

interface ResySlot {
  config: { id: number; type: string; token: string };
  date: { start: string; end: string };
  payment?: { cancellation_fee?: number; deposit_fee?: number };
}

interface ResyVenueSlotsResponse {
  results: {
    venues: Array<{
      venue: { id: { resy: number }; name: string };
      slots: ResySlot[];
    }>;
  };
}

interface ResyBookDetailsResponse {
  book_token: { value: string; date_expires: string };
  user: { payment_methods: Array<{ id: number; is_default: boolean }> };
}

interface ResyBookResponse {
  resy_token: string;
  reservation_id: number;
}

interface ResyLoginResponse {
  id: number;
  token: string;
  first_name: string;
  last_name: string;
  email: string;
}

export class ResyPlatformClient extends BasePlatformClient {
  readonly name: PlatformName = 'resy';
  private client: AxiosInstance;
  private apiKey: string | null = null;
  private authToken: string | null = null;

  constructor() {
    super();
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
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'Origin': 'https://resy.com',
      'Referer': 'https://resy.com/',
      'x-origin': 'https://resy.com',
    };
    if (this.apiKey) {
      headers['Authorization'] = `ResyAPI api_key="${this.apiKey}"`;
    }
    if (this.authToken) {
      headers['x-resy-auth-token'] = this.authToken;
      headers['x-resy-universal-auth'] = this.authToken;
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

    // Check rate limit
    if (!await rateLimiter.acquire(this.name)) {
      throw new Error('Rate limited. Please try again later.') as ReservationError;
    }

    try {
      const config = { headers: this.getHeaders() };

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

  async search(query: SearchQuery): Promise<Restaurant[]> {
    const date = query.date || this.today();
    const partySize = query.partySize || 2;

    try {
      const data = await this.request<ResyFindResponse>('get', '/4/find', {
        lat: 0,
        long: 0,
        day: date,
        party_size: partySize,
        query: `${query.query} ${query.location}`.trim(),
      });

      return (data.search?.hits || []).map((hit) => this.mapToRestaurant(hit));
    } catch (error) {
      console.error('Resy search error:', error);
      return [];
    }
  }

  async getDetails(id: string | number): Promise<RestaurantDetails | null> {
    const numericId = typeof id === 'string' ? parseInt(this.extractId(id), 10) : id;

    // Check cache
    const cacheKey = CacheKeys.details(this.name, numericId);
    const cached = cache.get<RestaurantDetails>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.request<ResyVenueDetailsResponse>('get', `/4/venue`, {
        id: numericId,
      });

      const details = this.mapToDetails(data);
      cache.set(cacheKey, details, CacheTTL.RESTAURANT_DETAILS);
      return details;
    } catch (error) {
      console.error('Resy getDetails error:', error);
      return null;
    }
  }

  async getAvailability(id: string | number, date: string, partySize: number): Promise<TimeSlot[]> {
    const numericId = typeof id === 'string' ? parseInt(this.extractId(id), 10) : id;

    // Check cache
    const cacheKey = CacheKeys.availability(this.name, numericId, date, partySize);
    const cached = cache.get<TimeSlot[]>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.request<ResyVenueSlotsResponse>('get', '/4/find', {
        lat: 0,
        long: 0,
        day: date,
        party_size: partySize,
        venue_id: numericId,
      });

      const venue = data.results?.venues?.[0];
      if (!venue?.slots) {
        return [];
      }

      const slots = venue.slots.map((slot) => this.mapToTimeSlot(slot));
      cache.set(cacheKey, slots, CacheTTL.AVAILABILITY);
      return slots;
    } catch (error) {
      console.error('Resy getAvailability error:', error);
      return [];
    }
  }

  async makeReservation(params: ReservationParams): Promise<ReservationResult> {
    try {
      // Get booking details (includes book token and payment methods)
      const details = await this.request<ResyBookDetailsResponse>('get', '/3/details', {
        config_id: params.slotId,
        day: params.date,
        party_size: params.partySize,
      });

      // Get default payment method if available
      const defaultPayment = details.user.payment_methods?.find((p) => p.is_default);

      // Make the reservation
      const bookData: Record<string, string> = {
        book_token: details.book_token.value,
      };
      if (defaultPayment) {
        bookData.struct_payment_method = JSON.stringify({ id: defaultPayment.id });
      }

      const result = await this.request<ResyBookResponse>('post', '/3/book', bookData);

      // Invalidate availability cache
      cache.invalidate(`availability:${this.name}:*`);

      return {
        success: true,
        platform: this.name,
        reservationId: String(result.reservation_id),
        confirmationDetails: `Reservation confirmed! ID: ${result.reservation_id}`,
      };
    } catch (error) {
      return {
        success: false,
        platform: this.name,
        error: error instanceof Error ? error.message : 'Failed to make reservation',
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check cache
    const cacheKey = CacheKeys.health(this.name);
    const cached = cache.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    try {
      await this.ensureCredentials();
      // Simple health check - use venue endpoint which is faster
      const response = await this.client.get('/3/venue', {
        headers: this.getHeaders(),
        params: { url_slug: 'american-beauty-at-the-grove', location: 'los-angeles-ca' },
        timeout: 15000,
      });
      const available = response.status === 200;
      cache.set(cacheKey, available, CacheTTL.PLATFORM_HEALTH);
      console.log('Resy isAvailable: SUCCESS');
      return available;
    } catch (error) {
      console.error('Resy isAvailable error:', error instanceof Error ? error.message : error);
      if (error instanceof AxiosError) {
        console.error('Resy API error details:', {
          status: error.response?.status,
          data: typeof error.response?.data === 'string' ? error.response.data.substring(0, 200) : error.response?.data,
        });
      }
      cache.set(cacheKey, false, CacheTTL.PLATFORM_HEALTH);
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      await this.ensureCredentials();
      if (!this.authToken) return false;

      // Try to get user reservations to verify auth
      await this.request<{ reservations: unknown[] }>('get', '/3/user/reservations');
      return true;
    } catch {
      return false;
    }
  }

  // Login method for credential management
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

  // Get user's reservations
  async getReservations(): Promise<Array<{
    reservationId: string;
    venue: { name: string; location: string };
    date: string;
    time: string;
    partySize: number;
    status: string;
  }>> {
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

  // Cancel a reservation
  async cancelReservation(resyToken: string): Promise<void> {
    await this.request<void>('delete', '/3/book', { resy_token: resyToken });
  }

  // Helper methods
  private mapToRestaurant(hit: ResyVenueHit): Restaurant {
    const cuisines = Array.isArray(hit.cuisine) ? hit.cuisine : [hit.cuisine].filter(Boolean);

    return {
      id: this.createId(hit.id.resy),
      platform: this.name,
      platformId: hit.id.resy,
      name: hit.name,
      location: hit.location?.name || '',
      neighborhood: hit.location?.neighborhood,
      cuisine: cuisines.join(', '),
      cuisines,
      priceRange: hit.price_range || 0,
      rating: hit.rating || 0,
      imageUrl: hit.images?.[0],
    };
  }

  private mapToDetails(data: ResyVenueDetailsResponse): RestaurantDetails {
    const cuisines = Array.isArray(data.cuisine) ? data.cuisine : parseCuisines(data.cuisine || '');

    return {
      id: this.createId(data.id.resy),
      platformIds: { resy: data.id.resy },
      name: data.name,
      description: data.tagline || data.content?.[0]?.body,
      cuisines,
      priceRange: (data.price_range || 2) as PriceRange,
      rating: data.rating || 0,
      reviewCount: data.num_ratings || 0,
      address: {
        street: [data.location.address_1, data.location.address_2].filter(Boolean).join(', '),
        city: data.location.locality,
        state: data.location.region,
        zip: data.location.postal_code,
        neighborhood: data.location.neighborhood,
        coordinates: data.location.geo
          ? { lat: data.location.geo.lat, lng: data.location.geo.lon }
          : undefined,
      },
      phone: data.contact?.phone_number,
      website: data.contact?.url,
      acceptsOnlineReservations: true,
      reservationPlatforms: [this.name],
      bookingUrls: {
        resy: `https://resy.com/cities/${data.location.locality.toLowerCase().replace(/\s+/g, '-')}/venues/${data.id.resy}`,
      },
      images: data.images || [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private mapToTimeSlot(slot: ResySlot): TimeSlot {
    return {
      slotId: String(slot.config.id),
      platform: this.name,
      time: slot.date.start,
      endTime: slot.date.end,
      type: slot.config.type,
      token: slot.config.token,
      cancellationFee: slot.payment?.cancellation_fee,
      depositFee: slot.payment?.deposit_fee,
    };
  }
}

// Singleton instance
export const resyClient = new ResyPlatformClient();

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
  ReservationError,
} from '../types/restaurant.js';
import { cache, CacheKeys, CacheTTL } from '../services/cache.js';
import { rateLimiter } from '../services/rate-limiter.js';

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
      timeout: 15000, // 15 second timeout
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
      // Handle both 401 and 419 as auth errors
      if (error instanceof AxiosError && (error.response?.status === 401 || error.response?.status === 419) && retry) {
        console.log(`Resy auth error (${error.response?.status}), attempting token refresh...`);
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
    const coords = this.getCityCoordinates(query.location);

    console.error(`Resy search: "${query.query}" in "${query.location}"`);

    try {
      const findData = await this.client.get<ResyFindResponse>('/4/find', {
        headers: this.getHeaders(),
        params: {
          lat: coords.lat,
          long: coords.lng,
          day: date,
          party_size: partySize,
          query: query.query,
        },
        timeout: 10000,
      });

      const hits = findData.data?.search?.hits || [];
      console.error(`Resy search found ${hits.length} results`);
      return hits.map((hit) => this.mapToRestaurant(hit));
    } catch (error) {
      console.error('Resy search error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  private getLocationSlug(location: string): string {
    const locationLower = location.toLowerCase();

    const locationSlugs: Record<string, string> = {
      'new york': 'new-york-ny',
      'nyc': 'new-york-ny',
      'manhattan': 'new-york-ny',
      'brooklyn': 'new-york-ny',
      'los angeles': 'los-angeles-ca',
      'la': 'los-angeles-ca',
      'chicago': 'chicago-il',
      'san francisco': 'san-francisco-ca',
      'sf': 'san-francisco-ca',
      'miami': 'miami-fl',
      'austin': 'austin-tx',
      'seattle': 'seattle-wa',
      'boston': 'boston-ma',
      'denver': 'denver-co',
      'atlanta': 'atlanta-ga',
      'dallas': 'dallas-tx',
      'houston': 'houston-tx',
      'philadelphia': 'philadelphia-pa',
      'washington': 'washington-dc',
      'dc': 'washington-dc',
      'las vegas': 'las-vegas-nv',
      'vegas': 'las-vegas-nv',
      'nashville': 'nashville-tn',
      'portland': 'portland-or',
      'san diego': 'san-diego-ca',
    };

    for (const [city, slug] of Object.entries(locationSlugs)) {
      if (locationLower.includes(city)) {
        return slug;
      }
    }

    // Default: convert location to slug format
    return locationLower.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
  }

  private getCityCoordinates(location: string): { lat: number; lng: number } {
    const locationLower = location.toLowerCase();

    // Common city coordinates
    const cities: Record<string, { lat: number; lng: number }> = {
      'new york': { lat: 40.7128, lng: -73.9352 },
      'nyc': { lat: 40.7128, lng: -73.9352 },
      'manhattan': { lat: 40.7831, lng: -73.9712 },
      'brooklyn': { lat: 40.6782, lng: -73.9442 },
      'los angeles': { lat: 34.0522, lng: -118.2437 },
      'la': { lat: 34.0522, lng: -118.2437 },
      'chicago': { lat: 41.8781, lng: -87.6298 },
      'san francisco': { lat: 37.7749, lng: -122.4194 },
      'sf': { lat: 37.7749, lng: -122.4194 },
      'miami': { lat: 25.7617, lng: -80.1918 },
      'austin': { lat: 30.2672, lng: -97.7431 },
      'seattle': { lat: 47.6062, lng: -122.3321 },
      'boston': { lat: 42.3601, lng: -71.0589 },
      'denver': { lat: 39.7392, lng: -104.9903 },
      'atlanta': { lat: 33.7490, lng: -84.3880 },
      'dallas': { lat: 32.7767, lng: -96.7970 },
      'houston': { lat: 29.7604, lng: -95.3698 },
      'philadelphia': { lat: 39.9526, lng: -75.1652 },
      'washington': { lat: 38.9072, lng: -77.0369 },
      'dc': { lat: 38.9072, lng: -77.0369 },
      'las vegas': { lat: 36.1699, lng: -115.1398 },
      'vegas': { lat: 36.1699, lng: -115.1398 },
      'nashville': { lat: 36.1627, lng: -86.7816 },
      'portland': { lat: 45.5152, lng: -122.6784 },
      'san diego': { lat: 32.7157, lng: -117.1611 },
    };

    // Check if location matches any known city
    for (const [city, coords] of Object.entries(cities)) {
      if (locationLower.includes(city)) {
        return coords;
      }
    }

    // Default to New York if no match
    return { lat: 40.7128, lng: -73.9352 };
  }

  async getDetails(id: string | number): Promise<RestaurantDetails | null> {
    const numericId = typeof id === 'string' ? parseInt(this.extractId(id), 10) : id;

    // Check cache
    const cacheKey = CacheKeys.details(this.name, numericId);
    const cached = cache.get<RestaurantDetails>(cacheKey);
    if (cached) return cached;

    try {
      // Use /4/find with venue_id to get venue info (same endpoint as availability)
      const data = await this.request<ResyVenueSlotsResponse>('get', '/4/find', {
        lat: 0,
        long: 0,
        day: this.today(),
        party_size: 2,
        venue_id: numericId,
      });

      const venue = data.results?.venues?.[0];
      if (!venue) return null;

      // Build details from the find response
      const details: RestaurantDetails = {
        id: this.createId(numericId),
        platformIds: { resy: numericId },
        name: venue.venue.name,
        cuisines: [],
        priceRange: 2 as PriceRange,
        rating: 0,
        reviewCount: 0,
        address: {
          street: '',
          city: '',
          state: '',
          zip: '',
        },
        acceptsOnlineReservations: true,
        reservationPlatforms: [this.name],
        bookingUrls: {
          resy: `https://resy.com/cities/ny/venues/${numericId}`,
        },
        images: [],
        lastUpdated: new Date().toISOString(),
      };

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
      // Health check using /4/find which is the working search endpoint
      const response = await this.client.get('/4/find', {
        headers: this.getHeaders(),
        params: { lat: 40.7128, long: -73.9352, day: this.today(), party_size: 2 },
        timeout: 10000,
      });
      const available = response.status === 200;
      cache.set(cacheKey, available, CacheTTL.PLATFORM_HEALTH);
      return available;
    } catch (error) {
      console.error('Resy isAvailable error:', error instanceof Error ? error.message : error);
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

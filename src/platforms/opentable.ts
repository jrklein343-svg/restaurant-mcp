/**
 * OpenTable platform client implementing PlatformClient interface
 */

import axios, { AxiosInstance } from 'axios';
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
} from '../types/restaurant.js';
import { cache, CacheKeys, CacheTTL } from '../services/cache.js';
import { rateLimiter } from '../services/rate-limiter.js';
import { parseCuisines } from '../utils/normalize.js';

const BASE_URL = 'https://www.opentable.com/restref/api';
const BOOKING_BASE = 'https://www.opentable.com/booking/experiences-availability';

// OpenTable API response types
interface OpenTableRestaurant {
  rid: number;
  name: string;
  address: string;
  city: string;
  state?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
  price_range: number;
  cuisine: string;
  photos?: string[];
  rating?: number;
  reviews_count?: number;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  website?: string;
  description?: string;
  menu_url?: string;
  hours?: Record<string, { open: string; close: string }[]>;
}

interface OpenTableSearchResponse {
  total_entries?: number;
  restaurants: OpenTableRestaurant[];
}

interface OpenTableAvailabilityResponse {
  availability: {
    [date: string]: Array<{
      time: string;
      available: boolean;
    }>;
  };
}

export class OpenTablePlatformClient extends BasePlatformClient {
  readonly name: PlatformName = 'opentable';
  private client: AxiosInstance;

  constructor() {
    super();
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
  }

  async search(query: SearchQuery): Promise<Restaurant[]> {
    // Check rate limit
    if (!await rateLimiter.acquire(this.name)) {
      console.error('OpenTable rate limited');
      return [];
    }

    try {
      const response = await this.client.get<OpenTableSearchResponse>('/restaurants', {
        params: {
          name: query.query,
          city: query.location,
          ...(query.cuisine && { cuisine: query.cuisine }),
        },
      });

      return (response.data.restaurants || []).map((r) => this.mapToRestaurant(r));
    } catch (error) {
      console.error('OpenTable search error:', error);
      return [];
    }
  }

  async getDetails(id: string | number): Promise<RestaurantDetails | null> {
    const numericId = typeof id === 'string' ? parseInt(this.extractId(id), 10) : id;

    // Check cache
    const cacheKey = CacheKeys.details(this.name, numericId);
    const cached = cache.get<RestaurantDetails>(cacheKey);
    if (cached) return cached;

    // Check rate limit
    if (!await rateLimiter.acquire(this.name)) {
      return null;
    }

    try {
      const response = await this.client.get<OpenTableRestaurant>(`/restaurant/${numericId}`);
      const details = this.mapToDetails(response.data);
      cache.set(cacheKey, details, CacheTTL.RESTAURANT_DETAILS);
      return details;
    } catch (error) {
      console.error('OpenTable getDetails error:', error);
      return null;
    }
  }

  async getAvailability(id: string | number, date: string, partySize: number): Promise<TimeSlot[]> {
    const numericId = typeof id === 'string' ? parseInt(this.extractId(id), 10) : id;

    // Check cache
    const cacheKey = CacheKeys.availability(this.name, numericId, date, partySize);
    const cached = cache.get<TimeSlot[]>(cacheKey);
    if (cached) return cached;

    // Check rate limit
    if (!await rateLimiter.acquire(this.name)) {
      return [];
    }

    try {
      const response = await this.client.get<OpenTableAvailabilityResponse>('/availability', {
        params: {
          rid: numericId,
          datetime: `${date}T19:00`,
          party_size: partySize,
        },
      });

      const daySlots = response.data.availability?.[date] || [];

      const slots = daySlots
        .filter((slot) => slot.available)
        .map((slot) => this.mapToTimeSlot(numericId, date, slot.time, partySize));

      cache.set(cacheKey, slots, CacheTTL.AVAILABILITY);
      return slots;
    } catch (error) {
      console.error('OpenTable getAvailability error:', error);
      return [];
    }
  }

  async makeReservation(params: ReservationParams): Promise<ReservationResult> {
    // OpenTable cannot complete booking via API
    // Return booking URL for user to complete
    const numericId = parseInt(this.extractId(params.restaurantId), 10);

    // Extract time from slot ID (format: ot-{rid}-{date}-{time})
    const slotParts = params.slotId.split('-');
    const time = slotParts[slotParts.length - 1] || '19:00';

    const bookingUrl = this.buildBookingUrl(numericId, params.date, time, params.partySize);

    return {
      success: true,
      platform: this.name,
      bookingUrl,
      confirmationDetails: 'OpenTable requires completing booking on their website. Use the provided URL.',
    };
  }

  async isAvailable(): Promise<boolean> {
    // Check cache
    const cacheKey = CacheKeys.health(this.name);
    const cached = cache.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await this.client.get('/restaurants', {
        params: { city: 'New York', name: 'test' },
        timeout: 5000,
      });
      const available = response.status === 200;
      cache.set(cacheKey, available, CacheTTL.PLATFORM_HEALTH);
      return available;
    } catch {
      cache.set(cacheKey, false, CacheTTL.PLATFORM_HEALTH);
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    // OpenTable search works without authentication
    return true;
  }

  // Build booking URL
  buildBookingUrl(restaurantId: number, date: string, time: string, partySize: number): string {
    const params = new URLSearchParams({
      rid: String(restaurantId),
      datetime: `${date}T${time}`,
      covers: String(partySize),
    });
    return `${BOOKING_BASE}?${params.toString()}`;
  }

  // Helper methods
  private mapToRestaurant(r: OpenTableRestaurant): Restaurant {
    return {
      id: this.createId(r.rid),
      platform: this.name,
      platformId: r.rid,
      name: r.name,
      location: `${r.address}, ${r.city}`,
      neighborhood: r.neighborhood,
      cuisine: r.cuisine || '',
      cuisines: parseCuisines(r.cuisine || ''),
      priceRange: r.price_range || 0,
      rating: r.rating || 0,
      reviewCount: r.reviews_count,
      imageUrl: r.photos?.[0],
    };
  }

  private mapToDetails(r: OpenTableRestaurant): RestaurantDetails {
    return {
      id: this.createId(r.rid),
      platformIds: { opentable: r.rid },
      name: r.name,
      description: r.description,
      cuisines: parseCuisines(r.cuisine || ''),
      priceRange: (r.price_range || 2) as PriceRange,
      rating: r.rating || 0,
      reviewCount: r.reviews_count || 0,
      address: {
        street: r.address,
        city: r.city,
        state: r.state || '',
        zip: r.postal_code || '',
        neighborhood: r.neighborhood,
        coordinates: r.latitude && r.longitude
          ? { lat: r.latitude, lng: r.longitude }
          : undefined,
      },
      phone: r.phone,
      website: r.website,
      hours: r.hours,
      menuUrl: r.menu_url,
      acceptsOnlineReservations: true,
      reservationPlatforms: [this.name],
      bookingUrls: {
        opentable: `https://www.opentable.com/restaurant/${r.rid}`,
      },
      images: r.photos || [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private mapToTimeSlot(restaurantId: number, date: string, time: string, partySize: number): TimeSlot {
    return {
      slotId: `ot-${restaurantId}-${date}-${time}`,
      platform: this.name,
      time,
      bookingUrl: this.buildBookingUrl(restaurantId, date, time, partySize),
    };
  }
}

// Singleton instance
export const openTableClient = new OpenTablePlatformClient();

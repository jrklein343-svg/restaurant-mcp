/**
 * Tock platform client implementing PlatformClient interface
 * Tock is used by many high-end restaurants for ticketed dining experiences
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

const BASE_URL = 'https://www.exploretock.com';
const API_URL = `${BASE_URL}/api`;

// Tock API response types
interface TockVenue {
  id: string;
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  city: string;
  state?: string;
  country?: string;
  address?: string;
  zip?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  cuisine_types?: string[];
  price_point?: number;
  rating?: number;
  review_count?: number;
  images?: string[];
  featured_image?: string;
  hours?: Record<string, { open: string; close: string }[]>;
  menu_url?: string;
  experiences?: TockExperience[];
}

interface TockExperience {
  id: string;
  name: string;
  description?: string;
  price?: number;
  duration_minutes?: number;
}

interface TockSearchResponse {
  results: TockVenue[];
  total: number;
}

interface TockAvailabilitySlot {
  id: string;
  datetime: string;
  time: string;
  available: boolean;
  price?: number;
  experience_id?: string;
  tickets_available?: number;
}

interface TockAvailabilityResponse {
  venue_id: string;
  date: string;
  slots: TockAvailabilitySlot[];
}

export class TockPlatformClient extends BasePlatformClient {
  readonly name: PlatformName = 'tock';
  private client: AxiosInstance;

  constructor() {
    super();
    this.client = axios.create({
      baseURL: API_URL,
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
      console.error('Tock rate limited');
      return [];
    }

    try {
      const response = await this.client.get<TockSearchResponse>('/search', {
        params: {
          q: query.query,
          location: query.location,
          ...(query.cuisine && { cuisine: query.cuisine }),
          ...(query.date && { date: query.date }),
          ...(query.partySize && { party_size: query.partySize }),
        },
      });

      return (response.data.results || []).map((v) => this.mapToRestaurant(v));
    } catch (error) {
      // Tock API might not be publicly accessible - return empty
      console.error('Tock search error:', error);
      return [];
    }
  }

  async getDetails(id: string | number): Promise<RestaurantDetails | null> {
    const venueId = typeof id === 'string' ? this.extractId(id) : String(id);

    // Check cache
    const cacheKey = CacheKeys.details(this.name, venueId);
    const cached = cache.get<RestaurantDetails>(cacheKey);
    if (cached) return cached;

    // Check rate limit
    if (!await rateLimiter.acquire(this.name)) {
      return null;
    }

    try {
      const response = await this.client.get<TockVenue>(`/venue/${venueId}`);
      const details = this.mapToDetails(response.data);
      cache.set(cacheKey, details, CacheTTL.RESTAURANT_DETAILS);
      return details;
    } catch (error) {
      console.error('Tock getDetails error:', error);
      return null;
    }
  }

  async getAvailability(id: string | number, date: string, partySize: number): Promise<TimeSlot[]> {
    const venueId = typeof id === 'string' ? this.extractId(id) : String(id);

    // Check cache
    const cacheKey = CacheKeys.availability(this.name, venueId, date, partySize);
    const cached = cache.get<TimeSlot[]>(cacheKey);
    if (cached) return cached;

    // Check rate limit
    if (!await rateLimiter.acquire(this.name)) {
      return [];
    }

    try {
      const response = await this.client.get<TockAvailabilityResponse>(`/availability/${venueId}`, {
        params: {
          date,
          party_size: partySize,
        },
      });

      const slots = (response.data.slots || [])
        .filter((slot) => slot.available)
        .map((slot) => this.mapToTimeSlot(venueId, slot));

      cache.set(cacheKey, slots, CacheTTL.AVAILABILITY);
      return slots;
    } catch (error) {
      console.error('Tock getAvailability error:', error);
      return [];
    }
  }

  async makeReservation(params: ReservationParams): Promise<ReservationResult> {
    // Tock requires completing booking on their website
    // Return booking URL for user to complete
    const venueId = this.extractId(params.restaurantId);
    const bookingUrl = this.buildBookingUrl(venueId, params.date, params.partySize);

    return {
      success: true,
      platform: this.name,
      bookingUrl,
      confirmationDetails: 'Tock requires completing booking on their website. Use the provided URL.',
    };
  }

  async isAvailable(): Promise<boolean> {
    // Check cache
    const cacheKey = CacheKeys.health(this.name);
    const cached = cache.get<boolean>(cacheKey);
    if (cached !== null) return cached;

    try {
      // Try to access the Tock homepage
      const response = await axios.get(BASE_URL, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
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
    // Tock search works without authentication
    return true;
  }

  // Build booking URL
  buildBookingUrl(venueId: string, date: string, partySize: number): string {
    // Tock URLs typically use the venue slug
    const params = new URLSearchParams({
      date,
      size: String(partySize),
    });
    return `${BASE_URL}/${venueId}?${params.toString()}`;
  }

  // Alternative search using the explore page
  async searchByLocation(city: string, cuisine?: string): Promise<Restaurant[]> {
    // Check rate limit
    if (!await rateLimiter.acquire(this.name)) {
      return [];
    }

    try {
      const response = await this.client.get<TockSearchResponse>('/explore', {
        params: {
          city: city.toLowerCase().replace(/\s+/g, '-'),
          ...(cuisine && { cuisine: cuisine.toLowerCase() }),
        },
      });

      return (response.data.results || []).map((v) => this.mapToRestaurant(v));
    } catch (error) {
      console.error('Tock searchByLocation error:', error);
      return [];
    }
  }

  // Helper methods
  private mapToRestaurant(v: TockVenue): Restaurant {
    return {
      id: this.createId(v.id || v.slug),
      platform: this.name,
      platformId: v.id || v.slug,
      name: v.name,
      location: [v.address, v.city, v.state].filter(Boolean).join(', '),
      neighborhood: v.neighborhood,
      cuisine: (v.cuisine_types || []).join(', '),
      cuisines: v.cuisine_types || [],
      priceRange: v.price_point || 0,
      rating: v.rating || 0,
      reviewCount: v.review_count,
      imageUrl: v.featured_image || v.images?.[0],
    };
  }

  private mapToDetails(v: TockVenue): RestaurantDetails {
    return {
      id: this.createId(v.id || v.slug),
      platformIds: { tock: v.id || v.slug },
      name: v.name,
      description: v.description || v.tagline,
      cuisines: v.cuisine_types || [],
      priceRange: (v.price_point || 2) as PriceRange,
      rating: v.rating || 0,
      reviewCount: v.review_count || 0,
      address: {
        street: v.address || '',
        city: v.city,
        state: v.state || '',
        zip: v.zip || '',
        neighborhood: v.neighborhood,
        coordinates: v.latitude && v.longitude
          ? { lat: v.latitude, lng: v.longitude }
          : undefined,
      },
      phone: v.phone,
      website: v.website,
      hours: v.hours,
      menuUrl: v.menu_url,
      acceptsOnlineReservations: true,
      reservationPlatforms: [this.name],
      bookingUrls: {
        tock: `${BASE_URL}/${v.slug || v.id}`,
      },
      images: v.images || [],
      tags: v.cuisine_types,
      lastUpdated: new Date().toISOString(),
    };
  }

  private mapToTimeSlot(venueId: string, slot: TockAvailabilitySlot): TimeSlot {
    return {
      slotId: slot.id,
      platform: this.name,
      time: slot.time,
      bookingUrl: `${BASE_URL}/${venueId}?slot=${slot.id}`,
      depositFee: slot.price,
    };
  }
}

// Singleton instance
export const tockClient = new TockPlatformClient();

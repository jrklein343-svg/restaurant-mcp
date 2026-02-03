/**
 * Abstract platform interface for restaurant reservation platforms
 */

import type {
  PlatformName,
  Restaurant,
  RestaurantDetails,
  TimeSlot,
  ReservationParams,
  ReservationResult,
  SearchQuery,
} from '../types/restaurant.js';

/**
 * Base interface that all platform clients must implement
 */
export interface PlatformClient {
  /** Platform identifier */
  readonly name: PlatformName;

  /**
   * Search for restaurants
   * @param query Search parameters
   * @returns List of matching restaurants
   */
  search(query: SearchQuery): Promise<Restaurant[]>;

  /**
   * Get detailed information about a restaurant
   * @param id Platform-specific restaurant ID
   * @returns Full restaurant details
   */
  getDetails(id: string | number): Promise<RestaurantDetails | null>;

  /**
   * Get available time slots for a restaurant
   * @param id Platform-specific restaurant ID
   * @param date Date in YYYY-MM-DD format
   * @param partySize Number of guests
   * @returns List of available time slots
   */
  getAvailability(id: string | number, date: string, partySize: number): Promise<TimeSlot[]>;

  /**
   * Make a reservation
   * @param params Reservation parameters
   * @returns Reservation result
   */
  makeReservation(params: ReservationParams): Promise<ReservationResult>;

  /**
   * Check if the platform is available/healthy
   * @returns true if platform is reachable and functional
   */
  isAvailable(): Promise<boolean>;

  /**
   * Check if authentication is configured and valid
   * @returns true if authenticated and ready to make bookings
   */
  isAuthenticated(): Promise<boolean>;
}

/**
 * Helper to create a prefixed restaurant ID
 */
export function createRestaurantId(platform: PlatformName, id: string | number): string {
  return `${platform}-${id}`;
}

/**
 * Helper to extract platform and ID from a prefixed restaurant ID
 */
export function parseRestaurantId(fullId: string): { platform: PlatformName; id: string } | null {
  const platforms: PlatformName[] = ['resy', 'opentable', 'tock'];

  for (const platform of platforms) {
    const prefix = `${platform}-`;
    if (fullId.startsWith(prefix)) {
      return {
        platform,
        id: fullId.slice(prefix.length),
      };
    }
  }

  return null;
}

/**
 * Base class with common functionality
 */
export abstract class BasePlatformClient implements PlatformClient {
  abstract readonly name: PlatformName;

  abstract search(query: SearchQuery): Promise<Restaurant[]>;
  abstract getDetails(id: string | number): Promise<RestaurantDetails | null>;
  abstract getAvailability(id: string | number, date: string, partySize: number): Promise<TimeSlot[]>;
  abstract makeReservation(params: ReservationParams): Promise<ReservationResult>;
  abstract isAvailable(): Promise<boolean>;
  abstract isAuthenticated(): Promise<boolean>;

  /**
   * Create a prefixed ID for this platform
   */
  protected createId(id: string | number): string {
    return createRestaurantId(this.name, id);
  }

  /**
   * Extract the numeric/string ID from a prefixed ID
   */
  protected extractId(fullId: string): string {
    const prefix = `${this.name}-`;
    if (fullId.startsWith(prefix)) {
      return fullId.slice(prefix.length);
    }
    return fullId;
  }

  /**
   * Get current date in YYYY-MM-DD format
   */
  protected today(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Format time to HH:MM format
   */
  protected formatTime(time: string): string {
    // Handle various time formats
    const date = new Date(`2000-01-01T${time}`);
    if (isNaN(date.getTime())) {
      // Try parsing as 12-hour format
      const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = match[2];
        const period = match[3]?.toUpperCase();

        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;

        return `${hours.toString().padStart(2, '0')}:${minutes}`;
      }
      return time;
    }
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}

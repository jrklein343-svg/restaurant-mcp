/**
 * Tock platform client implementing PlatformClient interface
 * NOTE: Tock does not have a public API (exploretock.com/api is not real).
 * Search, details, and availability return empty results.
 * Booking URL construction still works for manual use.
 */

import { BasePlatformClient } from './base.js';
import type {
  PlatformName,
  Restaurant,
  RestaurantDetails,
  TimeSlot,
  ReservationParams,
  ReservationResult,
  SearchQuery,
} from '../types/restaurant.js';

const BASE_URL = 'https://www.exploretock.com';

export class TockPlatformClient extends BasePlatformClient {
  readonly name: PlatformName = 'tock';

  async search(_query: SearchQuery): Promise<Restaurant[]> {
    // Tock does not have a public API
    console.error('Tock search unavailable: no public API exists. Use exploretock.com directly.');
    return [];
  }

  async getDetails(_id: string | number): Promise<RestaurantDetails | null> {
    // Tock does not have a public API
    return null;
  }

  async getAvailability(_id: string | number, _date: string, _partySize: number): Promise<TimeSlot[]> {
    // Tock does not have a public API
    return [];
  }

  async makeReservation(params: ReservationParams): Promise<ReservationResult> {
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

  async isAvailable(): Promise<boolean> {
    // Tock does not have a public API
    return false;
  }

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  // Build booking URL
  buildBookingUrl(venueId: string, date: string, partySize: number): string {
    const params = new URLSearchParams({
      date,
      size: String(partySize),
    });
    return `${BASE_URL}/${venueId}?${params.toString()}`;
  }
}

// Singleton instance
export const tockClient = new TockPlatformClient();

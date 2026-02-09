/**
 * OpenTable platform client implementing PlatformClient interface
 * NOTE: The OpenTable public API (opentable.com/restref/api) has been shut down.
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

const BOOKING_BASE = 'https://www.opentable.com/booking/experiences-availability';

export class OpenTablePlatformClient extends BasePlatformClient {
  readonly name: PlatformName = 'opentable';

  async search(_query: SearchQuery): Promise<Restaurant[]> {
    // OpenTable public API is no longer available
    console.error('OpenTable search unavailable: public API has been shut down. Use opentable.com directly.');
    return [];
  }

  async getDetails(_id: string | number): Promise<RestaurantDetails | null> {
    // OpenTable public API is no longer available
    return null;
  }

  async getAvailability(_id: string | number, _date: string, _partySize: number): Promise<TimeSlot[]> {
    // OpenTable public API is no longer available
    return [];
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
    // OpenTable public API is no longer available
    return false;
  }

  async isAuthenticated(): Promise<boolean> {
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
}

// Singleton instance
export const openTableClient = new OpenTablePlatformClient();

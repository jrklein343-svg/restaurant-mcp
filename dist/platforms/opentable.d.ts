/**
 * OpenTable platform client implementing PlatformClient interface
 * NOTE: The OpenTable public API (opentable.com/restref/api) has been shut down.
 * Search, details, and availability return empty results.
 * Booking URL construction still works for manual use.
 */
import { BasePlatformClient } from './base.js';
import type { PlatformName, Restaurant, RestaurantDetails, TimeSlot, ReservationParams, ReservationResult, SearchQuery } from '../types/restaurant.js';
export declare class OpenTablePlatformClient extends BasePlatformClient {
    readonly name: PlatformName;
    search(_query: SearchQuery): Promise<Restaurant[]>;
    getDetails(_id: string | number): Promise<RestaurantDetails | null>;
    getAvailability(_id: string | number, _date: string, _partySize: number): Promise<TimeSlot[]>;
    makeReservation(params: ReservationParams): Promise<ReservationResult>;
    isAvailable(): Promise<boolean>;
    isAuthenticated(): Promise<boolean>;
    buildBookingUrl(restaurantId: number, date: string, time: string, partySize: number): string;
}
export declare const openTableClient: OpenTablePlatformClient;

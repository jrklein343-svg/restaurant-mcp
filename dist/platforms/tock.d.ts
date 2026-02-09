/**
 * Tock platform client implementing PlatformClient interface
 * NOTE: Tock does not have a public API (exploretock.com/api is not real).
 * Search, details, and availability return empty results.
 * Booking URL construction still works for manual use.
 */
import { BasePlatformClient } from './base.js';
import type { PlatformName, Restaurant, RestaurantDetails, TimeSlot, ReservationParams, ReservationResult, SearchQuery } from '../types/restaurant.js';
export declare class TockPlatformClient extends BasePlatformClient {
    readonly name: PlatformName;
    search(_query: SearchQuery): Promise<Restaurant[]>;
    getDetails(_id: string | number): Promise<RestaurantDetails | null>;
    getAvailability(_id: string | number, _date: string, _partySize: number): Promise<TimeSlot[]>;
    makeReservation(params: ReservationParams): Promise<ReservationResult>;
    isAvailable(): Promise<boolean>;
    isAuthenticated(): Promise<boolean>;
    buildBookingUrl(venueId: string, date: string, partySize: number): string;
}
export declare const tockClient: TockPlatformClient;

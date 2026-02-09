/**
 * Restaurant lookup service
 *
 * Flow:
 * 1. Search by name/location → get restaurant IDs
 * 2. Use IDs for details, availability, booking
 */
import type { RestaurantDetails, PlatformName, AvailabilityResult, BookingOptions, TimeSlot, ReservationResult } from '../types/restaurant.js';
import { PlatformClient } from '../platforms/base.js';
/**
 * Get all available platform clients
 */
export declare function getAvailablePlatforms(): PlatformName[];
/**
 * Get a specific platform client
 */
export declare function getPlatformClient(platform: PlatformName): PlatformClient;
/**
 * Search result
 */
export interface SearchResult {
    restaurants: Array<{
        id: string;
        name: string;
        platform: PlatformName;
        location: string;
        neighborhood?: string;
        cuisine: string;
        priceRange: number;
        rating: number;
    }>;
    platformErrors: Record<string, string>;
}
/**
 * Search for restaurants by name and location
 * Returns restaurant IDs that can be used with other functions
 */
export declare function searchRestaurant(name: string, location: string, date?: string, partySize?: number): Promise<SearchResult>;
/**
 * Result from looking up a restaurant by ID
 */
export interface RestaurantLookupResult {
    restaurant: RestaurantDetails | null;
    platform: PlatformName;
    cached: boolean;
    error?: string;
}
/**
 * Look up a restaurant by its platform-specific ID
 *
 * @param restaurantId - ID in format "platform-id" (e.g., "resy-12345")
 * @returns Restaurant details or null if not found
 */
export declare function getRestaurantById(restaurantId: string): Promise<RestaurantLookupResult>;
/**
 * Look up multiple restaurants by their IDs
 */
export declare function getRestaurantsByIds(restaurantIds: string[]): Promise<RestaurantLookupResult[]>;
/**
 * Get detailed information about a restaurant by ID
 *
 * @param restaurantId - Required ID in format "platform-id" (e.g., "resy-12345")
 * @returns Restaurant details including name, address, hours, etc.
 */
export declare function getRestaurantDetails(restaurantId: string): Promise<RestaurantDetails | null>;
/**
 * Check availability across platforms for a restaurant
 */
export declare function checkAvailability(restaurantId: string, date: string, partySize: number): Promise<AvailabilityResult>;
/**
 * Get all booking options for a restaurant
 */
export declare function getBookingOptions(restaurantId: string): Promise<BookingOptions>;
/**
 * Get platform health status
 */
export declare function getPlatformHealth(): Promise<Record<PlatformName, boolean>>;
/**
 * Find and optionally book a table result
 */
export interface FindTableResult {
    success: boolean;
    restaurant?: {
        id: string;
        name: string;
        platform: PlatformName;
    };
    date: string;
    partySize: number;
    preferredTime: string;
    availableSlots: TimeSlot[];
    selectedSlot?: TimeSlot;
    booking?: ReservationResult;
    error?: string;
}
/**
 * Find and book a table at a restaurant
 */
export declare function findTable(restaurantName: string, location: string, dateStr: string, timeStr: string, partySize: number, autoBook: boolean): Promise<FindTableResult>;

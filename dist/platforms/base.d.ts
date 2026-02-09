/**
 * Abstract platform interface for restaurant reservation platforms
 */
import type { PlatformName, Restaurant, RestaurantDetails, TimeSlot, ReservationParams, ReservationResult, SearchQuery } from '../types/restaurant.js';
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
export declare function createRestaurantId(platform: PlatformName, id: string | number): string;
/**
 * Helper to extract platform and ID from a prefixed restaurant ID
 */
export declare function parseRestaurantId(fullId: string): {
    platform: PlatformName;
    id: string;
} | null;
/**
 * Base class with common functionality
 */
export declare abstract class BasePlatformClient implements PlatformClient {
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
    protected createId(id: string | number): string;
    /**
     * Extract the numeric/string ID from a prefixed ID
     */
    protected extractId(fullId: string): string;
    /**
     * Get current date in YYYY-MM-DD format
     */
    protected today(): string;
    /**
     * Format time to HH:MM format
     */
    protected formatTime(time: string): string;
}

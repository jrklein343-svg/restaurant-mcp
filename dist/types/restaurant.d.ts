/**
 * Unified restaurant types for multi-platform support
 */
export type PlatformName = 'resy' | 'opentable' | 'tock';
export interface PlatformIds {
    resy?: number;
    opentable?: number;
    tock?: string;
}
export type PriceRange = 1 | 2 | 3 | 4;
export interface Address {
    street: string;
    city: string;
    state: string;
    zip: string;
    neighborhood?: string;
    coordinates?: {
        lat: number;
        lng: number;
    };
}
export interface DayHours {
    open: string;
    close: string;
}
export interface OperatingHours {
    [day: string]: DayHours[];
}
export interface BookingUrls {
    resy?: string;
    opentable?: string;
    tock?: string;
}
export interface SearchQuery {
    query: string;
    location: string;
    cuisine?: string;
    date?: string;
    partySize?: number;
    priceRange?: PriceRange[];
    platforms?: PlatformName[];
    fuzzyMatch?: boolean;
}
export interface Restaurant {
    id: string;
    platform: PlatformName;
    platformId: string | number;
    name: string;
    location: string;
    neighborhood?: string;
    cuisine: string;
    cuisines?: string[];
    priceRange: number;
    rating: number;
    reviewCount?: number;
    imageUrl?: string;
    matchScore?: number;
}
export interface RestaurantDetails {
    id: string;
    platformIds: PlatformIds;
    name: string;
    description?: string;
    cuisines: string[];
    priceRange: PriceRange;
    rating: number;
    reviewCount: number;
    address: Address;
    phone?: string;
    website?: string;
    email?: string;
    hours?: OperatingHours;
    acceptsOnlineReservations: boolean;
    reservationPlatforms: PlatformName[];
    bookingUrls: BookingUrls;
    menuUrl?: string;
    menuHighlights?: string[];
    images: string[];
    tags?: string[];
    lastUpdated: string;
}
export interface TimeSlot {
    slotId: string;
    platform: PlatformName;
    time: string;
    endTime?: string;
    type?: string;
    cancellationFee?: number;
    depositFee?: number;
    bookingUrl?: string;
    token?: string;
}
export interface AvailabilityResult {
    restaurantId: string;
    restaurantName?: string;
    platform: PlatformName;
    date: string;
    partySize: number;
    slots: TimeSlot[];
}
export interface ReservationParams {
    restaurantId: string;
    platform: PlatformName;
    slotId: string;
    date: string;
    partySize: number;
    token?: string;
}
export interface ReservationResult {
    success: boolean;
    platform: PlatformName;
    reservationId?: string;
    confirmationDetails?: string;
    bookingUrl?: string;
    error?: string;
    suggestions?: string[];
}
export declare enum ErrorCode {
    RESTAURANT_NOT_FOUND = "RESTAURANT_NOT_FOUND",
    NO_ONLINE_RESERVATIONS = "NO_ONLINE_RESERVATIONS",
    PLATFORM_UNAVAILABLE = "PLATFORM_UNAVAILABLE",
    RATE_LIMITED = "RATE_LIMITED",
    AUTH_FAILED = "AUTH_FAILED",
    BOOKING_FAILED = "BOOKING_FAILED",
    INVALID_DATE = "INVALID_DATE",
    NO_AVAILABILITY = "NO_AVAILABILITY",
    INVALID_INPUT = "INVALID_INPUT"
}
export declare class ReservationError extends Error {
    code: ErrorCode;
    platform?: PlatformName;
    suggestions?: string[];
    retryAfter?: number;
    constructor(code: ErrorCode, message: string, options?: {
        platform?: PlatformName;
        suggestions?: string[];
        retryAfter?: number;
    });
    toJSON(): {
        error: ErrorCode;
        message: string;
        platform: PlatformName | undefined;
        suggestions: string[] | undefined;
        retryAfter: number | undefined;
    };
}
export interface BookingOptions {
    restaurantId: string;
    restaurantName: string;
    platforms: {
        platform: PlatformName;
        available: boolean;
        bookingUrl?: string;
        requiresAuth: boolean;
    }[];
    phone?: string;
    website?: string;
}

/**
 * Unified restaurant types for multi-platform support
 */

// Platform identifiers
export type PlatformName = 'resy' | 'opentable' | 'tock';

export interface PlatformIds {
  resy?: number;
  opentable?: number;
  tock?: string;
}

// Price range ($ to $$$$)
export type PriceRange = 1 | 2 | 3 | 4;

// Address structure
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

// Operating hours
export interface DayHours {
  open: string;
  close: string;
}

export interface OperatingHours {
  [day: string]: DayHours[];
}

// Booking URLs by platform
export interface BookingUrls {
  resy?: string;
  opentable?: string;
  tock?: string;
}

// Search query parameters
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

// Basic restaurant result from search
export interface Restaurant {
  id: string;                    // Prefixed: "resy-123", "opentable-456", "tock-abc"
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
  matchScore?: number;           // Fuzzy match score (0-1)
}

// Full restaurant details
export interface RestaurantDetails {
  // Identifiers
  id: string;
  platformIds: PlatformIds;

  // Basic Info
  name: string;
  description?: string;
  cuisines: string[];
  priceRange: PriceRange;
  rating: number;
  reviewCount: number;

  // Location
  address: Address;

  // Contact
  phone?: string;
  website?: string;
  email?: string;

  // Hours
  hours?: OperatingHours;

  // Reservation Info
  acceptsOnlineReservations: boolean;
  reservationPlatforms: PlatformName[];
  bookingUrls: BookingUrls;

  // Menu
  menuUrl?: string;
  menuHighlights?: string[];

  // Media
  images: string[];
  tags?: string[];

  // Metadata
  lastUpdated: string;
}

// Time slot for availability
export interface TimeSlot {
  slotId: string;
  platform: PlatformName;
  time: string;
  endTime?: string;
  type?: string;
  cancellationFee?: number;
  depositFee?: number;
  bookingUrl?: string;
  token?: string;                // Resy-specific booking token
}

// Availability result
export interface AvailabilityResult {
  restaurantId: string;
  restaurantName?: string;
  platform: PlatformName;
  date: string;
  partySize: number;
  slots: TimeSlot[];
}

// Reservation parameters
export interface ReservationParams {
  restaurantId: string;
  platform: PlatformName;
  slotId: string;
  date: string;
  partySize: number;
  token?: string;
}

// Reservation result
export interface ReservationResult {
  success: boolean;
  platform: PlatformName;
  reservationId?: string;
  confirmationDetails?: string;
  bookingUrl?: string;
  error?: string;
  suggestions?: string[];
}

// Error codes
export enum ErrorCode {
  RESTAURANT_NOT_FOUND = 'RESTAURANT_NOT_FOUND',
  NO_ONLINE_RESERVATIONS = 'NO_ONLINE_RESERVATIONS',
  PLATFORM_UNAVAILABLE = 'PLATFORM_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  AUTH_FAILED = 'AUTH_FAILED',
  BOOKING_FAILED = 'BOOKING_FAILED',
  INVALID_DATE = 'INVALID_DATE',
  NO_AVAILABILITY = 'NO_AVAILABILITY',
  INVALID_INPUT = 'INVALID_INPUT',
}

// Custom error class
export class ReservationError extends Error {
  code: ErrorCode;
  platform?: PlatformName;
  suggestions?: string[];
  retryAfter?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      platform?: PlatformName;
      suggestions?: string[];
      retryAfter?: number;
    }
  ) {
    super(message);
    this.name = 'ReservationError';
    this.code = code;
    this.platform = options?.platform;
    this.suggestions = options?.suggestions;
    this.retryAfter = options?.retryAfter;
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      platform: this.platform,
      suggestions: this.suggestions,
      retryAfter: this.retryAfter,
    };
  }
}

// Booking options response
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

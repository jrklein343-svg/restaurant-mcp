/**
 * Name and address normalization utilities for cross-platform matching
 */
/**
 * Normalize a restaurant name for matching
 */
export declare function normalizeName(name: string): string;
/**
 * Normalize an address for matching
 */
export declare function normalizeAddress(address: string): string;
/**
 * Normalize a city/neighborhood name
 */
export declare function normalizeLocation(location: string): string;
/**
 * Remove accents/diacritics from a string
 */
export declare function removeAccents(str: string): string;
/**
 * Extract the core name from a restaurant name
 * E.g., "Carbone NYC" -> "carbone"
 */
export declare function extractCoreName(name: string): string;
/**
 * Parse a full address into components
 */
export interface AddressComponents {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    neighborhood?: string;
}
export declare function parseAddress(fullAddress: string): AddressComponents;
/**
 * Create a normalized key for deduplication
 */
export declare function createDedupeKey(name: string, city: string): string;
/**
 * Normalize cuisine type
 */
export declare function normalizeCuisine(cuisine: string): string;
/**
 * Parse comma-separated cuisines into array
 */
export declare function parseCuisines(cuisineString: string): string[];

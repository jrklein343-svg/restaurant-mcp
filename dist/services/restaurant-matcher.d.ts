/**
 * Cross-platform restaurant matching service
 * Identifies the same restaurant across different reservation platforms
 */
import type { Restaurant, PlatformName, PlatformIds } from '../types/restaurant.js';
export interface MatchedRestaurant {
    id: string;
    name: string;
    location: string;
    neighborhood?: string;
    cuisine: string;
    cuisines: string[];
    priceRange: number;
    rating: number;
    reviewCount?: number;
    imageUrl?: string;
    platformIds: PlatformIds;
    platforms: PlatformName[];
    platformResults: Map<PlatformName, Restaurant>;
    matchConfidence: number;
}
export interface MatchResult {
    matched: MatchedRestaurant[];
    unmatched: Restaurant[];
}
/**
 * Match restaurants across platforms
 * Groups restaurants that appear to be the same entity
 */
export declare function matchRestaurants(restaurants: Restaurant[]): MatchResult;
/**
 * Find a restaurant by name across all platforms
 */
export declare function findByName(name: string, location: string, restaurants: Restaurant[]): Restaurant[];
/**
 * Deduplicate restaurants from multiple platform searches
 */
export declare function deduplicateRestaurants(restaurants: Restaurant[]): Restaurant[];

/**
 * In-memory cache with TTL support
 */
export interface CacheStats {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
}
export declare const CacheTTL: {
    readonly SEARCH_RESULTS: number;
    readonly RESTAURANT_DETAILS: number;
    readonly AVAILABILITY: number;
    readonly PLATFORM_HEALTH: number;
};
export declare class CacheService {
    private cache;
    private hits;
    private misses;
    private cleanupInterval;
    constructor();
    /**
     * Get a value from the cache
     */
    get<T>(key: string): T | null;
    /**
     * Set a value in the cache with TTL
     */
    set<T>(key: string, value: T, ttl: number): void;
    /**
     * Check if a key exists and is not expired
     */
    has(key: string): boolean;
    /**
     * Delete a specific key
     */
    delete(key: string): boolean;
    /**
     * Invalidate cache entries matching a pattern
     * Pattern supports * as wildcard
     */
    invalidate(pattern: string): number;
    /**
     * Clear all cache entries
     */
    clear(): void;
    /**
     * Get cache statistics
     */
    stats(): CacheStats;
    /**
     * Clean up expired entries
     */
    private cleanup;
    /**
     * Stop the cleanup interval (for graceful shutdown)
     */
    destroy(): void;
}
export declare const CacheKeys: {
    search(queryHash: string): string;
    details(platform: string, id: string | number): string;
    availability(platform: string, id: string | number, date: string, partySize: number): string;
    health(platform: string): string;
};
/**
 * Generate a hash for search queries
 */
export declare function hashSearchQuery(query: string, location: string, cuisine?: string): string;
export declare const cache: CacheService;

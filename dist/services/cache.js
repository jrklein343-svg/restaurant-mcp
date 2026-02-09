/**
 * In-memory cache with TTL support
 */
// TTL values in milliseconds
export const CacheTTL = {
    SEARCH_RESULTS: 5 * 60 * 1000, // 5 minutes
    RESTAURANT_DETAILS: 24 * 60 * 60 * 1000, // 24 hours
    AVAILABILITY: 60 * 1000, // 1 minute (real-time critical)
    PLATFORM_HEALTH: 30 * 1000, // 30 seconds
};
export class CacheService {
    cache = new Map();
    hits = 0;
    misses = 0;
    cleanupInterval = null;
    constructor() {
        // Cleanup expired entries every minute
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }
    /**
     * Get a value from the cache
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }
        entry.hits++;
        this.hits++;
        return entry.value;
    }
    /**
     * Set a value in the cache with TTL
     */
    set(key, value, ttl) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl,
            hits: 0,
        });
    }
    /**
     * Check if a key exists and is not expired
     */
    has(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return false;
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    /**
     * Delete a specific key
     */
    delete(key) {
        return this.cache.delete(key);
    }
    /**
     * Invalidate cache entries matching a pattern
     * Pattern supports * as wildcard
     */
    invalidate(pattern) {
        let count = 0;
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                count++;
            }
        }
        return count;
    }
    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
    /**
     * Get cache statistics
     */
    stats() {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }
    /**
     * Clean up expired entries
     */
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiry) {
                this.cache.delete(key);
            }
        }
    }
    /**
     * Stop the cleanup interval (for graceful shutdown)
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}
// Cache key generators
export const CacheKeys = {
    search(queryHash) {
        return `search:${queryHash}`;
    },
    details(platform, id) {
        return `details:${platform}:${id}`;
    },
    availability(platform, id, date, partySize) {
        return `availability:${platform}:${id}:${date}:${partySize}`;
    },
    health(platform) {
        return `health:${platform}`;
    },
};
/**
 * Generate a hash for search queries
 */
export function hashSearchQuery(query, location, cuisine) {
    const normalized = `${query.toLowerCase().trim()}|${location.toLowerCase().trim()}|${cuisine?.toLowerCase().trim() || ''}`;
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}
// Singleton instance
export const cache = new CacheService();

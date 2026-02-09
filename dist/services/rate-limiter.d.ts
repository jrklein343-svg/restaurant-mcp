/**
 * Token bucket rate limiter for API calls
 */
export interface RateLimitStatus {
    platform: string;
    available: number;
    max: number;
    nextRefill: number;
    isLimited: boolean;
}
export declare class RateLimiter {
    private buckets;
    private waitQueue;
    /**
     * Initialize or get a token bucket for a platform
     */
    private getBucket;
    /**
     * Refill tokens based on elapsed time
     */
    private refill;
    /**
     * Try to acquire a token (non-blocking)
     * Returns true if token acquired, false if rate limited
     */
    tryAcquire(platform: string): boolean;
    /**
     * Acquire a token, waiting if necessary
     * Returns true when token acquired, false on timeout
     */
    acquire(platform: string, timeoutMs?: number): Promise<boolean>;
    /**
     * Get current rate limit status for a platform
     */
    getStatus(platform: string): RateLimitStatus;
    /**
     * Get status for all platforms
     */
    getAllStatus(): RateLimitStatus[];
    /**
     * Reset rate limits for a platform (for testing or error recovery)
     */
    reset(platform: string): void;
    /**
     * Reset all rate limits
     */
    resetAll(): void;
}
export declare const rateLimiter: RateLimiter;

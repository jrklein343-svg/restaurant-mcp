/**
 * Token bucket rate limiter for API calls
 */
// Rate limits per platform (requests per minute)
const PLATFORM_LIMITS = {
    resy: { tokens: 20, refillRate: 20, interval: 60000 },
    opentable: { tokens: 30, refillRate: 30, interval: 60000 },
    tock: { tokens: 15, refillRate: 15, interval: 60000 },
};
export class RateLimiter {
    buckets = new Map();
    waitQueue = new Map();
    /**
     * Initialize or get a token bucket for a platform
     */
    getBucket(platform) {
        let bucket = this.buckets.get(platform);
        if (!bucket) {
            const limits = PLATFORM_LIMITS[platform] || {
                tokens: 10,
                refillRate: 10,
                interval: 60000
            };
            bucket = {
                tokens: limits.tokens,
                lastRefill: Date.now(),
                maxTokens: limits.tokens,
                refillRate: limits.refillRate,
                refillInterval: limits.interval,
            };
            this.buckets.set(platform, bucket);
        }
        return bucket;
    }
    /**
     * Refill tokens based on elapsed time
     */
    refill(bucket) {
        const now = Date.now();
        const elapsed = now - bucket.lastRefill;
        const intervalsElapsed = Math.floor(elapsed / bucket.refillInterval);
        if (intervalsElapsed > 0) {
            bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + (intervalsElapsed * bucket.refillRate));
            bucket.lastRefill = now;
        }
    }
    /**
     * Try to acquire a token (non-blocking)
     * Returns true if token acquired, false if rate limited
     */
    tryAcquire(platform) {
        const bucket = this.getBucket(platform);
        this.refill(bucket);
        if (bucket.tokens > 0) {
            bucket.tokens--;
            return true;
        }
        return false;
    }
    /**
     * Acquire a token, waiting if necessary
     * Returns true when token acquired, false on timeout
     */
    async acquire(platform, timeoutMs = 30000) {
        // Try immediate acquisition
        if (this.tryAcquire(platform)) {
            return true;
        }
        // Wait for next refill
        const bucket = this.getBucket(platform);
        const waitTime = bucket.refillInterval - (Date.now() - bucket.lastRefill);
        if (waitTime > timeoutMs) {
            return false;
        }
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                // Try again after waiting
                if (this.tryAcquire(platform)) {
                    resolve(true);
                }
                else {
                    resolve(false);
                }
                // Remove from queue
                const queue = this.waitQueue.get(platform);
                if (queue) {
                    const index = queue.findIndex(item => item.resolve === resolve);
                    if (index > -1)
                        queue.splice(index, 1);
                }
            }, Math.min(waitTime, timeoutMs));
            // Add to wait queue
            let queue = this.waitQueue.get(platform);
            if (!queue) {
                queue = [];
                this.waitQueue.set(platform, queue);
            }
            queue.push({ resolve, timeout });
        });
    }
    /**
     * Get current rate limit status for a platform
     */
    getStatus(platform) {
        const bucket = this.getBucket(platform);
        this.refill(bucket);
        const elapsed = Date.now() - bucket.lastRefill;
        const nextRefill = bucket.refillInterval - elapsed;
        return {
            platform,
            available: bucket.tokens,
            max: bucket.maxTokens,
            nextRefill: nextRefill > 0 ? nextRefill : 0,
            isLimited: bucket.tokens <= 0,
        };
    }
    /**
     * Get status for all platforms
     */
    getAllStatus() {
        return Object.keys(PLATFORM_LIMITS).map(platform => this.getStatus(platform));
    }
    /**
     * Reset rate limits for a platform (for testing or error recovery)
     */
    reset(platform) {
        this.buckets.delete(platform);
        // Clear any waiting requests
        const queue = this.waitQueue.get(platform);
        if (queue) {
            for (const item of queue) {
                clearTimeout(item.timeout);
                item.resolve(false);
            }
            this.waitQueue.delete(platform);
        }
    }
    /**
     * Reset all rate limits
     */
    resetAll() {
        for (const platform of this.buckets.keys()) {
            this.reset(platform);
        }
    }
}
// Singleton instance
export const rateLimiter = new RateLimiter();

/**
 * Abstract platform interface for restaurant reservation platforms
 */
/**
 * Helper to create a prefixed restaurant ID
 */
export function createRestaurantId(platform, id) {
    return `${platform}-${id}`;
}
/**
 * Helper to extract platform and ID from a prefixed restaurant ID
 */
export function parseRestaurantId(fullId) {
    const platforms = ['resy', 'opentable', 'tock'];
    for (const platform of platforms) {
        const prefix = `${platform}-`;
        if (fullId.startsWith(prefix)) {
            return {
                platform,
                id: fullId.slice(prefix.length),
            };
        }
    }
    return null;
}
/**
 * Base class with common functionality
 */
export class BasePlatformClient {
    /**
     * Create a prefixed ID for this platform
     */
    createId(id) {
        return createRestaurantId(this.name, id);
    }
    /**
     * Extract the numeric/string ID from a prefixed ID
     */
    extractId(fullId) {
        const prefix = `${this.name}-`;
        if (fullId.startsWith(prefix)) {
            return fullId.slice(prefix.length);
        }
        return fullId;
    }
    /**
     * Get current date in YYYY-MM-DD format
     */
    today() {
        return new Date().toISOString().split('T')[0];
    }
    /**
     * Format time to HH:MM format
     */
    formatTime(time) {
        // Handle various time formats
        const date = new Date(`2000-01-01T${time}`);
        if (isNaN(date.getTime())) {
            // Try parsing as 12-hour format
            const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
            if (match) {
                let hours = parseInt(match[1], 10);
                const minutes = match[2];
                const period = match[3]?.toUpperCase();
                if (period === 'PM' && hours !== 12)
                    hours += 12;
                if (period === 'AM' && hours === 12)
                    hours = 0;
                return `${hours.toString().padStart(2, '0')}:${minutes}`;
            }
            return time;
        }
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
}

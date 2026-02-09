/**
 * Restaurant lookup service
 *
 * Flow:
 * 1. Search by name/location → get restaurant IDs
 * 2. Use IDs for details, availability, booking
 */
import { parseRestaurantId } from '../platforms/base.js';
import { resyClient } from '../platforms/resy.js';
import { openTableClient } from '../platforms/opentable.js';
import { tockClient } from '../platforms/tock.js';
// Platform clients registry
const platformClients = {
    resy: resyClient,
    opentable: openTableClient,
    tock: tockClient,
};
/**
 * Get all available platform clients
 */
export function getAvailablePlatforms() {
    return Object.keys(platformClients);
}
/**
 * Get a specific platform client
 */
export function getPlatformClient(platform) {
    return platformClients[platform];
}
/**
 * Search for restaurants by name and location
 * Returns restaurant IDs that can be used with other functions
 */
export async function searchRestaurant(name, location, date, partySize = 2) {
    const platformErrors = {};
    const allRestaurants = [];
    // Search all platforms in parallel
    const searchPromises = Object.entries(platformClients).map(async ([platform, client]) => {
        try {
            const isAvailable = await client.isAvailable();
            if (!isAvailable) {
                platformErrors[platform] = 'Platform unavailable';
                return [];
            }
            const results = await client.search({
                query: name,
                location,
                date,
                partySize,
            });
            return results;
        }
        catch (error) {
            platformErrors[platform] = error instanceof Error ? error.message : 'Search failed';
            return [];
        }
    });
    const results = await Promise.all(searchPromises);
    for (const platformResults of results) {
        allRestaurants.push(...platformResults);
    }
    // Map to simplified format with IDs
    const restaurants = allRestaurants.map((r) => ({
        id: r.id,
        name: r.name,
        platform: r.platform,
        location: r.location,
        neighborhood: r.neighborhood,
        cuisine: r.cuisine,
        priceRange: r.priceRange,
        rating: r.rating,
    }));
    return { restaurants, platformErrors };
}
/**
 * Look up a restaurant by its platform-specific ID
 *
 * @param restaurantId - ID in format "platform-id" (e.g., "resy-12345")
 * @returns Restaurant details or null if not found
 */
export async function getRestaurantById(restaurantId) {
    const parsed = parseRestaurantId(restaurantId);
    if (!parsed) {
        return {
            restaurant: null,
            platform: 'resy', // default
            cached: false,
            error: `Invalid restaurant ID format: ${restaurantId}. Expected format: platform-id (e.g., resy-12345, opentable-67890, tock-venue-slug)`,
        };
    }
    const client = platformClients[parsed.platform];
    if (!client) {
        return {
            restaurant: null,
            platform: parsed.platform,
            cached: false,
            error: `Unknown platform: ${parsed.platform}`,
        };
    }
    try {
        const details = await client.getDetails(parsed.id);
        return {
            restaurant: details,
            platform: parsed.platform,
            cached: false, // Cache is handled internally by getDetails
        };
    }
    catch (error) {
        return {
            restaurant: null,
            platform: parsed.platform,
            cached: false,
            error: error instanceof Error ? error.message : 'Failed to fetch restaurant details',
        };
    }
}
/**
 * Look up multiple restaurants by their IDs
 */
export async function getRestaurantsByIds(restaurantIds) {
    const results = await Promise.all(restaurantIds.map((id) => getRestaurantById(id)));
    return results;
}
/**
 * Get detailed information about a restaurant by ID
 *
 * @param restaurantId - Required ID in format "platform-id" (e.g., "resy-12345")
 * @returns Restaurant details including name, address, hours, etc.
 */
export async function getRestaurantDetails(restaurantId) {
    const parsed = parseRestaurantId(restaurantId);
    if (!parsed) {
        return null;
    }
    const client = platformClients[parsed.platform];
    return client.getDetails(parsed.id);
}
/**
 * Check availability across platforms for a restaurant
 */
export async function checkAvailability(restaurantId, date, partySize) {
    const parsed = parseRestaurantId(restaurantId);
    if (!parsed) {
        throw new Error(`Invalid restaurant ID: ${restaurantId}`);
    }
    const client = platformClients[parsed.platform];
    const slots = await client.getAvailability(parsed.id, date, partySize);
    // Get restaurant name if possible
    let restaurantName;
    try {
        const details = await client.getDetails(parsed.id);
        restaurantName = details?.name;
    }
    catch {
        // Ignore errors getting name
    }
    return {
        restaurantId,
        restaurantName,
        platform: parsed.platform,
        date,
        partySize,
        slots,
    };
}
/**
 * Get all booking options for a restaurant
 */
export async function getBookingOptions(restaurantId) {
    const parsed = parseRestaurantId(restaurantId);
    if (!parsed) {
        throw new Error(`Invalid restaurant ID: ${restaurantId}`);
    }
    // Get details from the primary platform
    const client = platformClients[parsed.platform];
    const details = await client.getDetails(parsed.id);
    if (!details) {
        throw new Error(`Restaurant not found: ${restaurantId}`);
    }
    // Check availability on each platform
    const platformOptions = await Promise.all(Object.entries(platformClients).map(async ([platform, client]) => {
        const platName = platform;
        // Check if this restaurant exists on this platform
        const platformId = details.platformIds[platName];
        if (!platformId) {
            return {
                platform: platName,
                available: false,
                requiresAuth: platName === 'resy',
            };
        }
        const isAvailable = await client.isAvailable();
        const isAuth = await client.isAuthenticated();
        return {
            platform: platName,
            available: isAvailable,
            bookingUrl: details.bookingUrls[platName],
            requiresAuth: platName === 'resy' && !isAuth,
        };
    }));
    return {
        restaurantId,
        restaurantName: details.name,
        platforms: platformOptions,
        phone: details.phone,
        website: details.website,
    };
}
/**
 * Get platform health status
 */
export async function getPlatformHealth() {
    const health = {};
    await Promise.all(Object.entries(platformClients).map(async ([platform, client]) => {
        health[platform] = await client.isAvailable();
    }));
    return health;
}
/**
 * Parse time string to 24-hour format
 */
function parseTimePreference(time) {
    const lower = time.toLowerCase().trim();
    // Named times
    if (lower.includes('breakfast'))
        return 9;
    if (lower.includes('brunch'))
        return 11;
    if (lower.includes('lunch'))
        return 12;
    if (lower === 'noon' || lower === 'midday')
        return 12;
    if (lower.includes('afternoon'))
        return 14;
    if (lower.includes('dinner') || lower.includes('evening'))
        return 19;
    if (lower.includes('late'))
        return 21;
    // Parse "7pm", "7:30pm", "19:00", etc.
    const match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (match) {
        let hour = parseInt(match[1], 10);
        const ampm = match[3];
        if (ampm === 'pm' && hour < 12)
            hour += 12;
        if (ampm === 'am' && hour === 12)
            hour = 0;
        // If no am/pm and hour <= 6, assume PM for restaurant context
        if (!ampm && hour >= 1 && hour <= 6)
            hour += 12;
        return hour;
    }
    // Default to dinner time
    return 19;
}
/**
 * Parse date string to YYYY-MM-DD format
 */
function parseDateString(dateStr) {
    const lower = dateStr.toLowerCase().trim();
    const today = new Date();
    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    // Relative dates
    if (lower === 'today') {
        return formatDate(today);
    }
    if (lower === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return formatDate(tomorrow);
    }
    // Day names
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIndex = days.findIndex(d => lower.includes(d));
    if (dayIndex !== -1) {
        const currentDay = today.getDay();
        let daysUntil = dayIndex - currentDay;
        if (daysUntil <= 0)
            daysUntil += 7; // Next week
        if (lower.includes('next'))
            daysUntil += 7;
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + daysUntil);
        return formatDate(targetDate);
    }
    // Try to parse as date
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
        return formatDate(parsed);
    }
    // Default to today
    return formatDate(today);
}
function formatDate(date) {
    return date.toISOString().split('T')[0];
}
/**
 * Find the slot closest to the preferred time
 */
function findBestSlot(slots, preferredHour) {
    if (slots.length === 0)
        return null;
    return slots.reduce((best, slot) => {
        const slotHour = parseInt(slot.time.split(':')[0], 10);
        const bestHour = parseInt(best.time.split(':')[0], 10);
        const slotDiff = Math.abs(slotHour - preferredHour);
        const bestDiff = Math.abs(bestHour - preferredHour);
        return slotDiff < bestDiff ? slot : best;
    });
}
/**
 * Find and book a table at a restaurant
 */
export async function findTable(restaurantName, location, dateStr, timeStr, partySize, autoBook) {
    // Parse date and time
    const date = parseDateString(dateStr);
    const preferredHour = parseTimePreference(timeStr);
    // Search for the restaurant
    const searchResult = await searchRestaurant(restaurantName, location, date, partySize);
    if (searchResult.restaurants.length === 0) {
        return {
            success: false,
            date,
            partySize,
            preferredTime: timeStr,
            availableSlots: [],
            error: `No restaurants found matching "${restaurantName}" in ${location}`,
        };
    }
    // Use the first (best) match
    const restaurant = searchResult.restaurants[0];
    // Check availability
    const parsed = parseRestaurantId(restaurant.id);
    if (!parsed) {
        return {
            success: false,
            restaurant: { id: restaurant.id, name: restaurant.name, platform: restaurant.platform },
            date,
            partySize,
            preferredTime: timeStr,
            availableSlots: [],
            error: 'Invalid restaurant ID',
        };
    }
    const client = platformClients[parsed.platform];
    const slots = await client.getAvailability(parsed.id, date, partySize);
    if (slots.length === 0) {
        return {
            success: false,
            restaurant: { id: restaurant.id, name: restaurant.name, platform: restaurant.platform },
            date,
            partySize,
            preferredTime: timeStr,
            availableSlots: [],
            error: `No availability at ${restaurant.name} on ${date} for ${partySize} guests`,
        };
    }
    // Find best slot
    const bestSlot = findBestSlot(slots, preferredHour);
    const result = {
        success: true,
        restaurant: { id: restaurant.id, name: restaurant.name, platform: restaurant.platform },
        date,
        partySize,
        preferredTime: timeStr,
        availableSlots: slots,
        selectedSlot: bestSlot || undefined,
    };
    // Book if requested
    if (autoBook && bestSlot) {
        const bookingParams = {
            restaurantId: restaurant.id,
            platform: parsed.platform,
            slotId: bestSlot.slotId,
            date,
            partySize,
            token: bestSlot.token,
        };
        try {
            const bookingResult = await client.makeReservation(bookingParams);
            result.booking = bookingResult;
            result.success = bookingResult.success;
            if (!bookingResult.success) {
                result.error = bookingResult.error;
            }
        }
        catch (error) {
            result.booking = {
                success: false,
                platform: parsed.platform,
                error: error instanceof Error ? error.message : 'Booking failed',
            };
            result.success = false;
            result.error = result.booking.error;
        }
    }
    return result;
}

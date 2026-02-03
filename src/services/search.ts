/**
 * Unified search service that queries all platforms
 */

import type {
  Restaurant,
  RestaurantDetails,
  SearchQuery,
  PlatformName,
  TimeSlot,
  AvailabilityResult,
  BookingOptions,
  ReservationError,
  ErrorCode,
} from '../types/restaurant.js';
import { PlatformClient, parseRestaurantId } from '../platforms/base.js';
import { resyClient } from '../platforms/resy.js';
import { openTableClient } from '../platforms/opentable.js';
import { tockClient } from '../platforms/tock.js';
import { cache, CacheKeys, CacheTTL, hashSearchQuery } from './cache.js';
import { matchRestaurants, findByName, deduplicateRestaurants, MatchedRestaurant } from './restaurant-matcher.js';
import { fuzzyMatch, findBestMatches } from '../utils/fuzzy.js';

// Platform clients registry
const platformClients: Record<PlatformName, PlatformClient> = {
  resy: resyClient,
  opentable: openTableClient,
  tock: tockClient,
};

/**
 * Get all available platform clients
 */
export function getAvailablePlatforms(): PlatformName[] {
  return Object.keys(platformClients) as PlatformName[];
}

/**
 * Get a specific platform client
 */
export function getPlatformClient(platform: PlatformName): PlatformClient {
  return platformClients[platform];
}

/**
 * Search result with merged restaurant data
 */
export interface UnifiedSearchResult {
  restaurants: MatchedRestaurant[];
  totalResults: number;
  platformsSearched: PlatformName[];
  platformErrors: Record<PlatformName, string>;
  cached: boolean;
}

/**
 * Search for restaurants across all platforms
 */
export async function searchRestaurants(query: SearchQuery): Promise<UnifiedSearchResult> {
  const platforms = query.platforms || getAvailablePlatforms();
  const platformErrors: Record<PlatformName, string> = {} as Record<PlatformName, string>;

  // Check cache
  const cacheKey = CacheKeys.search(hashSearchQuery(query.query, query.location, query.cuisine));
  const cached = cache.get<UnifiedSearchResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Search all platforms in parallel
  const searchPromises = platforms.map(async (platform): Promise<Restaurant[]> => {
    const client = platformClients[platform];
    if (!client) {
      platformErrors[platform] = 'Platform not available';
      return [];
    }

    try {
      // Check if platform is healthy
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        platformErrors[platform] = 'Platform temporarily unavailable';
        return [];
      }

      return await client.search(query);
    } catch (error) {
      platformErrors[platform] = error instanceof Error ? error.message : 'Search failed';
      return [];
    }
  });

  const results = await Promise.all(searchPromises);
  const allRestaurants = results.flat();

  // Apply fuzzy matching if enabled (default: true)
  let filteredRestaurants = allRestaurants;
  if (query.fuzzyMatch !== false && query.query) {
    // Score each result against the query
    filteredRestaurants = allRestaurants
      .map((r) => {
        const match = fuzzyMatch(query.query, r.name);
        return { ...r, matchScore: match.score };
      })
      .filter((r) => r.matchScore! >= 0.3) // Minimum score threshold
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  }

  // Match and deduplicate across platforms
  const { matched } = matchRestaurants(filteredRestaurants);

  // Sort by rating (descending), then by match score
  matched.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return (b.matchConfidence || 0) - (a.matchConfidence || 0);
  });

  const result: UnifiedSearchResult = {
    restaurants: matched,
    totalResults: matched.length,
    platformsSearched: platforms,
    platformErrors,
    cached: false,
  };

  // Cache the result
  cache.set(cacheKey, result, CacheTTL.SEARCH_RESULTS);

  return result;
}

/**
 * Find a restaurant by name with fuzzy matching
 */
export async function findRestaurantByName(
  name: string,
  location: string,
  platforms?: PlatformName[]
): Promise<{ results: Restaurant[]; suggestions: string[] }> {
  // First, do a regular search
  const searchResult = await searchRestaurants({
    query: name,
    location,
    platforms,
    fuzzyMatch: true,
  });

  // Convert matched restaurants back to Restaurant format for compatibility
  const restaurants = searchResult.restaurants.map((m): Restaurant => ({
    id: m.id,
    platform: m.platforms[0],
    platformId: Object.values(m.platformIds)[0] as string | number,
    name: m.name,
    location: m.location,
    neighborhood: m.neighborhood,
    cuisine: m.cuisine,
    cuisines: m.cuisines,
    priceRange: m.priceRange,
    rating: m.rating,
    reviewCount: m.reviewCount,
    imageUrl: m.imageUrl,
    matchScore: m.matchConfidence,
  }));

  // Find best matches using fuzzy search
  const matches = findByName(name, location, restaurants);

  // Generate suggestions if no exact matches
  const suggestions: string[] = [];
  if (matches.length === 0 && restaurants.length > 0) {
    // Suggest top restaurants by rating
    const topByRating = [...restaurants]
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5)
      .map((r) => r.name);
    suggestions.push(...topByRating);
  } else if (matches.length > 0 && matches[0].matchScore && matches[0].matchScore < 0.8) {
    // Suggest similar names
    const similarNames = findBestMatches(name, restaurants.map((r) => r.name), {
      minScore: 0.4,
      limit: 5,
    });
    suggestions.push(...similarNames.map((m) => m.target));
  }

  return { results: matches, suggestions };
}

/**
 * Get detailed information about a restaurant
 */
export async function getRestaurantDetails(
  restaurantId?: string,
  name?: string,
  location?: string
): Promise<RestaurantDetails | null> {
  // If we have a restaurant ID, look it up directly
  if (restaurantId) {
    const parsed = parseRestaurantId(restaurantId);
    if (parsed) {
      const client = platformClients[parsed.platform];
      return client.getDetails(parsed.id);
    }
  }

  // Otherwise, search by name
  if (name && location) {
    const { results } = await findRestaurantByName(name, location);
    if (results.length > 0) {
      const best = results[0];
      const parsed = parseRestaurantId(best.id);
      if (parsed) {
        const client = platformClients[parsed.platform];
        return client.getDetails(parsed.id);
      }
    }
  }

  return null;
}

/**
 * Check availability across platforms for a restaurant
 */
export async function checkAvailability(
  restaurantId: string,
  date: string,
  partySize: number
): Promise<AvailabilityResult> {
  const parsed = parseRestaurantId(restaurantId);
  if (!parsed) {
    throw new Error(`Invalid restaurant ID: ${restaurantId}`) as ReservationError;
  }

  const client = platformClients[parsed.platform];
  const slots = await client.getAvailability(parsed.id, date, partySize);

  // Get restaurant name if possible
  let restaurantName: string | undefined;
  try {
    const details = await client.getDetails(parsed.id);
    restaurantName = details?.name;
  } catch {
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
 * Check availability across all platforms where restaurant exists
 */
export async function checkAvailabilityAllPlatforms(
  matched: MatchedRestaurant,
  date: string,
  partySize: number
): Promise<TimeSlot[]> {
  const allSlots: TimeSlot[] = [];

  const promises = matched.platforms.map(async (platform) => {
    const id = matched.platformIds[platform];
    if (!id) return [];

    try {
      const client = platformClients[platform];
      return await client.getAvailability(id, date, partySize);
    } catch {
      return [];
    }
  });

  const results = await Promise.all(promises);
  for (const slots of results) {
    allSlots.push(...slots);
  }

  // Sort by time
  allSlots.sort((a, b) => a.time.localeCompare(b.time));

  // Remove duplicates (same time from different platforms)
  const seen = new Set<string>();
  return allSlots.filter((slot) => {
    const key = `${slot.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Get all booking options for a restaurant
 */
export async function getBookingOptions(restaurantId: string): Promise<BookingOptions> {
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
  const platformOptions = await Promise.all(
    Object.entries(platformClients).map(async ([platform, client]) => {
      const platName = platform as PlatformName;

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
    })
  );

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
export async function getPlatformHealth(): Promise<Record<PlatformName, boolean>> {
  const health: Record<PlatformName, boolean> = {} as Record<PlatformName, boolean>;

  await Promise.all(
    Object.entries(platformClients).map(async ([platform, client]) => {
      health[platform as PlatformName] = await client.isAvailable();
    })
  );

  return health;
}

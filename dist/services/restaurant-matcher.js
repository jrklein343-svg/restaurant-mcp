/**
 * Cross-platform restaurant matching service
 * Identifies the same restaurant across different reservation platforms
 */
import { fuzzyMatch } from '../utils/fuzzy.js';
import { normalizeName, normalizeLocation, createDedupeKey, extractCoreName } from '../utils/normalize.js';
/**
 * Match restaurants across platforms
 * Groups restaurants that appear to be the same entity
 */
export function matchRestaurants(restaurants) {
    const matched = [];
    const unmatched = [];
    const processed = new Set();
    // Sort by platform priority (Resy > OpenTable > Tock for data quality)
    const sorted = [...restaurants].sort((a, b) => {
        const priority = { resy: 0, opentable: 1, tock: 2 };
        return priority[a.platform] - priority[b.platform];
    });
    for (const restaurant of sorted) {
        if (processed.has(restaurant.id))
            continue;
        // Find potential matches from other platforms
        const candidates = sorted.filter((r) => !processed.has(r.id) &&
            r.platform !== restaurant.platform);
        const matches = findMatchingRestaurants(restaurant, candidates);
        if (matches.length > 0) {
            // Create merged result
            const merged = mergeRestaurants(restaurant, matches);
            matched.push(merged);
            // Mark all as processed
            processed.add(restaurant.id);
            for (const match of matches) {
                processed.add(match.id);
            }
        }
        else if (!processed.has(restaurant.id)) {
            // No matches found, add as standalone
            processed.add(restaurant.id);
            // Convert to MatchedRestaurant format
            matched.push({
                id: restaurant.id,
                name: restaurant.name,
                location: restaurant.location,
                neighborhood: restaurant.neighborhood,
                cuisine: restaurant.cuisine,
                cuisines: restaurant.cuisines || [],
                priceRange: restaurant.priceRange,
                rating: restaurant.rating,
                reviewCount: restaurant.reviewCount,
                imageUrl: restaurant.imageUrl,
                platformIds: { [restaurant.platform]: restaurant.platformId },
                platforms: [restaurant.platform],
                platformResults: new Map([[restaurant.platform, restaurant]]),
                matchConfidence: 1,
            });
        }
    }
    return { matched, unmatched };
}
/**
 * Find restaurants that match the given restaurant
 */
function findMatchingRestaurants(target, candidates) {
    const matches = [];
    const targetNormName = normalizeName(target.name);
    const targetNormLocation = normalizeLocation(target.location);
    for (const candidate of candidates) {
        // Quick rejection: different cities
        const candidateNormLocation = normalizeLocation(candidate.location);
        const locationMatch = fuzzyMatch(targetNormLocation, candidateNormLocation);
        if (locationMatch.score < 0.5)
            continue;
        // Check name match
        const candidateNormName = normalizeName(candidate.name);
        const nameMatch = fuzzyMatch(targetNormName, candidateNormName);
        // Also check core names (without location suffixes, etc.)
        const targetCore = extractCoreName(target.name);
        const candidateCore = extractCoreName(candidate.name);
        const coreMatch = fuzzyMatch(targetCore, candidateCore);
        const bestNameScore = Math.max(nameMatch.score, coreMatch.score);
        // High confidence match
        if (bestNameScore >= 0.8 && locationMatch.score >= 0.6) {
            matches.push({
                restaurant: candidate,
                score: (bestNameScore * 0.7) + (locationMatch.score * 0.3),
            });
        }
        // Medium confidence match - require higher location match
        else if (bestNameScore >= 0.6 && locationMatch.score >= 0.8) {
            matches.push({
                restaurant: candidate,
                score: (bestNameScore * 0.6) + (locationMatch.score * 0.4),
            });
        }
    }
    // Sort by score and return
    return matches
        .sort((a, b) => b.score - a.score)
        .map((m) => m.restaurant);
}
/**
 * Merge multiple restaurant records into one
 */
function mergeRestaurants(primary, others) {
    const all = [primary, ...others];
    // Build platform IDs map
    const platformIds = {};
    const platformResults = new Map();
    for (const r of all) {
        if (r.platform === 'resy') {
            platformIds.resy = typeof r.platformId === 'number' ? r.platformId : parseInt(String(r.platformId), 10);
        }
        else if (r.platform === 'opentable') {
            platformIds.opentable = typeof r.platformId === 'number' ? r.platformId : parseInt(String(r.platformId), 10);
        }
        else if (r.platform === 'tock') {
            platformIds.tock = String(r.platformId);
        }
        platformResults.set(r.platform, r);
    }
    // Merge cuisines
    const cuisineSet = new Set();
    for (const r of all) {
        if (r.cuisines) {
            for (const c of r.cuisines)
                cuisineSet.add(c);
        }
        else if (r.cuisine) {
            for (const c of r.cuisine.split(/[,/]/)) {
                const trimmed = c.trim().toLowerCase();
                if (trimmed)
                    cuisineSet.add(trimmed);
            }
        }
    }
    // Use best data for each field
    // Priority: Resy > OpenTable > Tock
    const best = all.reduce((acc, r) => {
        const priority = { resy: 3, opentable: 2, tock: 1 };
        const accPriority = priority[acc.platform];
        const rPriority = priority[r.platform];
        // Use higher priority for most fields
        if (rPriority > accPriority) {
            return {
                ...acc,
                name: r.name || acc.name,
                location: r.location || acc.location,
                neighborhood: r.neighborhood || acc.neighborhood,
                imageUrl: r.imageUrl || acc.imageUrl,
            };
        }
        // Always use highest rating
        if (r.rating > acc.rating) {
            acc.rating = r.rating;
        }
        // Use highest review count
        if ((r.reviewCount || 0) > (acc.reviewCount || 0)) {
            acc.reviewCount = r.reviewCount;
        }
        return acc;
    }, { ...primary });
    // Calculate match confidence based on how many platforms agreed
    const matchConfidence = all.length > 1
        ? Math.min(0.95, 0.6 + (all.length - 1) * 0.15)
        : 1;
    return {
        id: primary.id, // Use primary's prefixed ID
        name: best.name,
        location: best.location,
        neighborhood: best.neighborhood,
        cuisine: Array.from(cuisineSet).join(', '),
        cuisines: Array.from(cuisineSet),
        priceRange: best.priceRange,
        rating: best.rating,
        reviewCount: best.reviewCount,
        imageUrl: best.imageUrl,
        platformIds,
        platforms: all.map((r) => r.platform),
        platformResults,
        matchConfidence,
    };
}
/**
 * Find a restaurant by name across all platforms
 */
export function findByName(name, location, restaurants) {
    const normName = normalizeName(name);
    const normLocation = normalizeLocation(location);
    const scored = restaurants
        .map((r) => {
        const rNormName = normalizeName(r.name);
        const rNormLocation = normalizeLocation(r.location);
        const nameMatch = fuzzyMatch(normName, rNormName);
        const locationMatch = fuzzyMatch(normLocation, rNormLocation);
        // Weight name more heavily
        const score = (nameMatch.score * 0.7) + (locationMatch.score * 0.3);
        return { restaurant: r, score, nameMatch, locationMatch };
    })
        .filter((s) => s.score >= 0.5)
        .sort((a, b) => b.score - a.score);
    return scored.map((s) => ({
        ...s.restaurant,
        matchScore: s.score,
    }));
}
/**
 * Deduplicate restaurants from multiple platform searches
 */
export function deduplicateRestaurants(restaurants) {
    const seen = new Map();
    for (const r of restaurants) {
        const key = createDedupeKey(r.name, r.location.split(',')[0] || r.location);
        const existing = seen.get(key);
        if (!existing) {
            seen.set(key, r);
        }
        else {
            // Keep the one with better data (higher rating or more reviews)
            if (r.rating > existing.rating ||
                (r.rating === existing.rating && (r.reviewCount || 0) > (existing.reviewCount || 0))) {
                seen.set(key, r);
            }
        }
    }
    return Array.from(seen.values());
}

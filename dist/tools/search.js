import { z } from 'zod';
import { resyClient } from '../resy/client.js';
import { openTableClient } from '../opentable/client.js';
export const searchRestaurantsSchema = z.object({
    query: z.string().min(1).max(100).describe('Restaurant name or search term'),
    location: z.string().min(1).max(100).describe('City or neighborhood'),
    cuisine: z.string().optional().describe('Type of cuisine (optional)'),
    platform: z.enum(['resy', 'opentable', 'both']).default('both').describe('Which platform to search'),
    date: z.string().optional().describe('Date for availability (YYYY-MM-DD). Defaults to today.'),
    party_size: z.number().int().min(1).max(20).default(2).describe('Number of guests'),
});
export async function searchRestaurants(input) {
    const date = input.date || new Date().toISOString().split('T')[0];
    const results = [];
    const searchResy = input.platform === 'resy' || input.platform === 'both';
    const searchOpenTable = input.platform === 'opentable' || input.platform === 'both';
    const promises = [];
    if (searchResy) {
        promises.push(resyClient
            .search(input.query, input.location, date, input.party_size)
            .then((resyResults) => {
            for (const r of resyResults) {
                results.push({
                    platform: 'resy',
                    id: `resy-${r.id}`,
                    name: r.name,
                    location: `${r.neighborhood}, ${r.location}`,
                    cuisine: r.cuisine,
                    priceRange: r.priceRange,
                    rating: r.rating,
                    imageUrl: r.imageUrl,
                });
            }
        })
            .catch(() => {
            // Silently fail for this platform
        }));
    }
    if (searchOpenTable) {
        promises.push(openTableClient
            .search(input.query, input.location, input.cuisine)
            .then((otResults) => {
            for (const r of otResults) {
                results.push({
                    platform: 'opentable',
                    id: `opentable-${r.id}`,
                    name: r.name,
                    location: `${r.address}, ${r.city}`,
                    cuisine: r.cuisine,
                    priceRange: r.priceRange,
                    rating: r.rating,
                    imageUrl: r.imageUrl,
                });
            }
        })
            .catch(() => {
            // Silently fail for this platform
        }));
    }
    await Promise.all(promises);
    // Sort by rating descending
    results.sort((a, b) => b.rating - a.rating);
    return results;
}

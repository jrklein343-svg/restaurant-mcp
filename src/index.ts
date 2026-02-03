import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  setCredential,
  getCredential,
  getResyAuthStatus,
  getOpenTableAuthStatus,
} from './credentials.js';
import { resyClient } from './platforms/resy.js';
import { openTableClient } from './platforms/opentable.js';
import { tockClient } from './platforms/tock.js';
import { parseRestaurantId } from './platforms/base.js';
import {
  searchRestaurants,
  findRestaurantByName,
  getRestaurantDetails,
  checkAvailability,
  getBookingOptions,
  getPlatformHealth,
  getAvailablePlatforms,
  getPlatformClient,
} from './services/search.js';
import { rateLimiter } from './services/rate-limiter.js';
import { cache } from './services/cache.js';
import type { PlatformName, ReservationParams } from './types/restaurant.js';
import {
  snipeReservation,
  snipeReservationSchema,
  listScheduledSnipes,
  listSnipesSchema,
  cancelSnipe,
  cancelSnipeSchema,
} from './tools/snipe.js';
import { startScheduler, stopScheduler } from './sniper/scheduler.js';

// Schemas for tool inputs
const searchRestaurantsSchema = z.object({
  query: z.string().min(1).max(100).describe('Restaurant name or search term'),
  location: z.string().min(1).max(100).describe('City, neighborhood, or address'),
  cuisine: z.string().optional().describe('Type of cuisine to filter by'),
  date: z.string().optional().describe('Check availability for date (YYYY-MM-DD)'),
  party_size: z.number().int().min(1).max(20).default(2).describe('Number of guests'),
  price_range: z.array(z.number().int().min(1).max(4)).optional().describe('Filter by price (1-4, $ to $$$$)'),
  platforms: z.array(z.enum(['resy', 'opentable', 'tock'])).optional().describe('Limit to specific platforms'),
  fuzzy_match: z.boolean().default(true).describe('Enable fuzzy name matching for typos'),
});

const getRestaurantDetailsSchema = z.object({
  restaurant_id: z.string().optional().describe('Direct restaurant ID (e.g., resy-12345)'),
  name: z.string().optional().describe('Restaurant name for fuzzy search'),
  location: z.string().optional().describe('Location (required if using name)'),
  include_menu: z.boolean().default(false).describe('Include menu information'),
  include_hours: z.boolean().default(true).describe('Include operating hours'),
});

const checkAvailabilitySchema = z.object({
  restaurant_id: z.string().min(1).describe('Restaurant ID (e.g., resy-12345, opentable-67890, tock-abc)'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date to check (YYYY-MM-DD)'),
  party_size: z.number().int().min(1).max(20).describe('Number of guests'),
});

const makeReservationSchema = z.object({
  restaurant_id: z.string().min(1).describe('Restaurant ID'),
  slot_id: z.string().min(1).describe('Time slot ID from check_availability'),
  party_size: z.number().int().min(1).max(20).describe('Number of guests'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Reservation date (YYYY-MM-DD)'),
});

const findRestaurantByNameSchema = z.object({
  name: z.string().min(1).max(100).describe('Restaurant name (supports typos and variations)'),
  location: z.string().min(1).max(100).describe('City or neighborhood'),
  platforms: z.array(z.enum(['resy', 'opentable', 'tock'])).optional().describe('Platforms to search'),
});

const getBookingOptionsSchema = z.object({
  restaurant_id: z.string().min(1).describe('Restaurant ID'),
});

const listReservationsSchema = z.object({
  platform: z.enum(['resy', 'opentable', 'tock', 'all']).default('all').describe('Platform filter'),
});

const cancelReservationSchema = z.object({
  reservation_id: z.string().min(1).describe('Reservation ID to cancel'),
  platform: z.enum(['resy', 'opentable', 'tock']).describe('Platform'),
});

const setCredentialsSchema = z.object({
  platform: z.enum(['resy', 'opentable']).describe('Platform to set credentials for'),
  api_key: z.string().optional().describe('API key (required for Resy)'),
  auth_token: z.string().optional().describe('Authentication token'),
});

const setLoginSchema = z.object({
  platform: z.enum(['resy']).describe('Platform (currently only Resy supported)'),
  email: z.string().email().describe('Account email'),
  password: z.string().min(1).describe('Account password'),
});

const checkAuthStatusSchema = z.object({
  platform: z.enum(['resy', 'opentable', 'tock', 'all']).default('all').describe('Platform to check'),
});

const refreshTokenSchema = z.object({
  platform: z.enum(['resy']).describe('Platform to refresh token for'),
});

// Create server
const server = new Server(
  {
    name: 'restaurant-reservations',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const tools = [
  {
    name: 'search_restaurants',
    description: 'Search for restaurants across Resy, OpenTable, and Tock. Supports fuzzy matching for typos (e.g., "carbonne" finds "Carbone"). Returns unified results with ratings, cuisine, price range, and which platforms each restaurant is available on.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Restaurant name or search term' },
        location: { type: 'string', description: 'City, neighborhood, or address' },
        cuisine: { type: 'string', description: 'Type of cuisine to filter by' },
        date: { type: 'string', description: 'Check availability for date (YYYY-MM-DD)' },
        party_size: { type: 'number', default: 2, description: 'Number of guests' },
        price_range: { type: 'array', items: { type: 'number' }, description: 'Filter by price (1-4)' },
        platforms: { type: 'array', items: { type: 'string', enum: ['resy', 'opentable', 'tock'] }, description: 'Limit to specific platforms' },
        fuzzy_match: { type: 'boolean', default: true, description: 'Enable fuzzy matching for typos' },
      },
      required: ['query', 'location'],
    },
  },
  {
    name: 'get_restaurant_details',
    description: 'Get comprehensive details about a restaurant including hours, contact info, menu highlights, and all booking options.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Direct restaurant ID (e.g., resy-12345)' },
        name: { type: 'string', description: 'Restaurant name for fuzzy search' },
        location: { type: 'string', description: 'Location (required if using name)' },
        include_menu: { type: 'boolean', default: false, description: 'Include menu info' },
        include_hours: { type: 'boolean', default: true, description: 'Include operating hours' },
      },
    },
  },
  {
    name: 'check_availability',
    description: 'Get available time slots for a specific restaurant on a given date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID (e.g., resy-12345)' },
        date: { type: 'string', description: 'Date to check (YYYY-MM-DD)' },
        party_size: { type: 'number', description: 'Number of guests' },
      },
      required: ['restaurant_id', 'date', 'party_size'],
    },
  },
  {
    name: 'make_reservation',
    description: 'Book a reservation. For Resy, completes booking directly. For OpenTable/Tock, returns a booking URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID' },
        slot_id: { type: 'string', description: 'Time slot ID from check_availability' },
        party_size: { type: 'number', description: 'Number of guests' },
        date: { type: 'string', description: 'Reservation date (YYYY-MM-DD)' },
      },
      required: ['restaurant_id', 'slot_id', 'party_size', 'date'],
    },
  },
  {
    name: 'find_restaurant_by_name',
    description: 'Find a restaurant by name with fuzzy matching. Handles typos, variations, and different naming conventions across platforms.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Restaurant name (typos OK)' },
        location: { type: 'string', description: 'City or neighborhood' },
        platforms: { type: 'array', items: { type: 'string', enum: ['resy', 'opentable', 'tock'] }, description: 'Platforms to search' },
      },
      required: ['name', 'location'],
    },
  },
  {
    name: 'get_booking_options',
    description: 'Get all ways to book a restaurant: API booking, website URLs, and phone number.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID' },
      },
      required: ['restaurant_id'],
    },
  },
  {
    name: 'list_reservations',
    description: 'View your upcoming reservations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['resy', 'opentable', 'tock', 'all'], default: 'all', description: 'Platform filter' },
      },
    },
  },
  {
    name: 'cancel_reservation',
    description: 'Cancel an existing reservation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID to cancel' },
        platform: { type: 'string', enum: ['resy', 'opentable', 'tock'], description: 'Platform' },
      },
      required: ['reservation_id', 'platform'],
    },
  },
  {
    name: 'set_credentials',
    description: 'Securely store API credentials for Resy or OpenTable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
        api_key: { type: 'string', description: 'API key (required for Resy)' },
        auth_token: { type: 'string', description: 'Authentication token' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'set_login',
    description: 'Store email/password for automatic token refresh. Credentials are encrypted.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['resy'], description: 'Platform (currently only Resy)' },
        email: { type: 'string', description: 'Account email' },
        password: { type: 'string', description: 'Account password' },
      },
      required: ['platform', 'email', 'password'],
    },
  },
  {
    name: 'check_auth_status',
    description: 'Check if credentials are configured and valid for each platform.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['resy', 'opentable', 'tock', 'all'], default: 'all', description: 'Platform to check' },
      },
    },
  },
  {
    name: 'refresh_token',
    description: 'Manually refresh authentication token using stored login credentials.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['resy'], description: 'Platform' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'snipe_reservation',
    description: 'Schedule an automatic booking attempt for when slots become available. Perfect for popular restaurants.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID' },
        platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
        date: { type: 'string', description: 'Target reservation date (YYYY-MM-DD)' },
        party_size: { type: 'number', description: 'Number of guests' },
        preferred_times: { type: 'array', items: { type: 'string' }, description: 'Preferred times in order' },
        release_time: { type: 'string', description: 'When slots open (ISO 8601)' },
      },
      required: ['restaurant_id', 'platform', 'date', 'party_size', 'preferred_times', 'release_time'],
    },
  },
  {
    name: 'list_snipes',
    description: 'View all scheduled snipe attempts and their status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'cancel_snipe',
    description: 'Cancel a scheduled snipe attempt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        snipe_id: { type: 'string', description: 'Snipe ID to cancel' },
      },
      required: ['snipe_id'],
    },
  },
  {
    name: 'get_platform_status',
    description: 'Check the health and rate limit status of all platforms.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_restaurants': {
        const input = searchRestaurantsSchema.parse(args);
        const results = await searchRestaurants({
          query: input.query,
          location: input.location,
          cuisine: input.cuisine,
          date: input.date,
          partySize: input.party_size,
          priceRange: input.price_range as (1 | 2 | 3 | 4)[] | undefined,
          platforms: input.platforms as PlatformName[] | undefined,
          fuzzyMatch: input.fuzzy_match,
        });

        // Format for output
        const output = {
          results: results.restaurants.map((r) => ({
            id: r.id,
            name: r.name,
            location: r.location,
            neighborhood: r.neighborhood,
            cuisine: r.cuisine,
            priceRange: r.priceRange,
            rating: r.rating,
            reviewCount: r.reviewCount,
            platforms: r.platforms,
            imageUrl: r.imageUrl,
            matchConfidence: r.matchConfidence,
          })),
          totalResults: results.totalResults,
          platformsSearched: results.platformsSearched,
          cached: results.cached,
          ...(Object.keys(results.platformErrors).length > 0 && { platformErrors: results.platformErrors }),
        };

        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
      }

      case 'get_restaurant_details': {
        const input = getRestaurantDetailsSchema.parse(args);

        if (!input.restaurant_id && !input.name) {
          return { content: [{ type: 'text', text: 'Either restaurant_id or name is required' }] };
        }

        if (input.name && !input.location) {
          return { content: [{ type: 'text', text: 'Location is required when searching by name' }] };
        }

        const details = await getRestaurantDetails(input.restaurant_id, input.name, input.location);

        if (!details) {
          return { content: [{ type: 'text', text: 'Restaurant not found. Try searching with different terms.' }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
      }

      case 'check_availability': {
        const input = checkAvailabilitySchema.parse(args);
        const result = await checkAvailability(input.restaurant_id, input.date, input.party_size);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'make_reservation': {
        const input = makeReservationSchema.parse(args);
        const parsed = parseRestaurantId(input.restaurant_id);

        if (!parsed) {
          return { content: [{ type: 'text', text: `Invalid restaurant ID: ${input.restaurant_id}` }] };
        }

        const client = getPlatformClient(parsed.platform);
        const params: ReservationParams = {
          restaurantId: input.restaurant_id,
          platform: parsed.platform,
          slotId: input.slot_id,
          date: input.date,
          partySize: input.party_size,
        };

        const result = await client.makeReservation(params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'find_restaurant_by_name': {
        const input = findRestaurantByNameSchema.parse(args);
        const result = await findRestaurantByName(
          input.name,
          input.location,
          input.platforms as PlatformName[] | undefined
        );

        const output = {
          results: result.results.map((r) => ({
            id: r.id,
            name: r.name,
            location: r.location,
            platform: r.platform,
            rating: r.rating,
            matchScore: r.matchScore,
          })),
          suggestions: result.suggestions,
        };

        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
      }

      case 'get_booking_options': {
        const input = getBookingOptionsSchema.parse(args);
        const options = await getBookingOptions(input.restaurant_id);
        return { content: [{ type: 'text', text: JSON.stringify(options, null, 2) }] };
      }

      case 'list_reservations': {
        const input = listReservationsSchema.parse(args);
        const results: Array<{
          platform: string;
          reservationId: string;
          restaurantName: string;
          location: string;
          date: string;
          time: string;
          partySize: number;
          status: string;
        }> = [];

        if (input.platform === 'resy' || input.platform === 'all') {
          try {
            const resyReservations = await resyClient.getReservations();
            for (const r of resyReservations) {
              results.push({
                platform: 'resy',
                reservationId: r.reservationId,
                restaurantName: r.venue.name,
                location: r.venue.location,
                date: r.date,
                time: r.time,
                partySize: r.partySize,
                status: r.status,
              });
            }
          } catch {
            // Skip if not authenticated
          }
        }

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'cancel_reservation': {
        const input = cancelReservationSchema.parse(args);

        if (input.platform === 'resy') {
          try {
            await resyClient.cancelReservation(input.reservation_id);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Reservation cancelled successfully' }, null, 2) }] };
          } catch (error) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : 'Failed to cancel' }, null, 2) }] };
          }
        } else {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: `${input.platform} reservations must be cancelled on their website` }, null, 2) }] };
        }
      }

      case 'set_credentials': {
        const input = setCredentialsSchema.parse(args);
        const stored: string[] = [];

        if (input.platform === 'resy') {
          if (input.api_key) {
            await setCredential('resy-api-key', input.api_key);
            stored.push('API key');
          }
          if (input.auth_token) {
            await setCredential('resy-auth-token', input.auth_token);
            stored.push('auth token');
          }
        } else {
          if (input.auth_token) {
            await setCredential('opentable-token', input.auth_token);
            stored.push('auth token');
          }
        }

        return {
          content: [{
            type: 'text',
            text: stored.length > 0
              ? `Stored ${stored.join(' and ')} for ${input.platform}.`
              : 'No credentials provided to store.',
          }],
        };
      }

      case 'set_login': {
        const input = setLoginSchema.parse(args);

        if (input.platform === 'resy') {
          try {
            await resyClient.login(input.email, input.password);
            return {
              content: [{
                type: 'text',
                text: 'Login successful! Credentials stored securely. Token will auto-refresh when needed.',
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `Login failed: ${error instanceof Error ? error.message : 'Invalid credentials'}`,
              }],
            };
          }
        }

        return { content: [{ type: 'text', text: 'Only Resy login is currently supported.' }] };
      }

      case 'check_auth_status': {
        const input = checkAuthStatusSchema.parse(args);
        const statuses: Record<string, unknown>[] = [];

        if (input.platform === 'resy' || input.platform === 'all') {
          const status = await getResyAuthStatus();
          const isValid = status.hasAuthToken ? await resyClient.isAuthenticated() : false;
          statuses.push({ ...status, isValid });
        }

        if (input.platform === 'opentable' || input.platform === 'all') {
          const status = await getOpenTableAuthStatus();
          statuses.push({ ...status, isValid: true });
        }

        if (input.platform === 'tock' || input.platform === 'all') {
          statuses.push({
            platform: 'tock',
            hasApiKey: false,
            hasAuthToken: false,
            hasLogin: false,
            isValid: true, // Tock works without auth
          });
        }

        return { content: [{ type: 'text', text: JSON.stringify(statuses, null, 2) }] };
      }

      case 'refresh_token': {
        const input = refreshTokenSchema.parse(args);

        if (input.platform === 'resy') {
          const email = await getCredential('resy-email');
          const password = await getCredential('resy-password');

          if (!email || !password) {
            return {
              content: [{
                type: 'text',
                text: 'No login credentials stored. Use set_login first.',
              }],
            };
          }

          try {
            await resyClient.login(email, password);
            return { content: [{ type: 'text', text: 'Token refreshed successfully!' }] };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              }],
            };
          }
        }

        return { content: [{ type: 'text', text: 'Only Resy token refresh is supported.' }] };
      }

      case 'snipe_reservation': {
        const input = snipeReservationSchema.parse(args);
        const result = await snipeReservation(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'list_snipes': {
        const input = listSnipesSchema.parse(args);
        const results = await listScheduledSnipes(input);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'cancel_snipe': {
        const input = cancelSnipeSchema.parse(args);
        const result = await cancelSnipe(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'get_platform_status': {
        const health = await getPlatformHealth();
        const rateLimits = rateLimiter.getAllStatus();
        const cacheStats = cache.stats();

        const status = {
          platforms: Object.entries(health).map(([platform, available]) => ({
            platform,
            available,
            rateLimit: rateLimits.find((r) => r.platform === platform),
          })),
          cache: cacheStats,
        };

        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [{
          type: 'text',
          text: `Invalid input: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
    };
  }
});

// Start server
async function main() {
  // Start the snipe scheduler
  await startScheduler();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cleanup on exit
  process.on('SIGINT', () => {
    cache.destroy();
    stopScheduler();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cache.destroy();
    stopScheduler();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

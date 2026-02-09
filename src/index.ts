import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
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
  findTable,
  searchRestaurant,
  getRestaurantById,
  getRestaurantsByIds,
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
const findTableSchema = z.object({
  restaurant: z.string().min(1).max(100).describe('Restaurant name'),
  location: z.string().min(1).max(100).describe('City or neighborhood'),
  date: z.string().describe('Date (YYYY-MM-DD) or relative like "friday", "tomorrow"'),
  time: z.string().describe('Preferred time like "noon", "7pm", "around 8"'),
  party_size: z.number().int().min(1).max(20).default(2).describe('Number of guests'),
  book: z.boolean().default(true).describe('Automatically book the best available slot'),
});

const searchRestaurantSchema = z.object({
  name: z.string().min(1).max(100).describe('Restaurant name to search for'),
  location: z.string().min(1).max(100).describe('City or neighborhood'),
  date: z.string().optional().describe('Optional date for availability context (YYYY-MM-DD)'),
  party_size: z.number().int().min(1).max(20).default(2).describe('Party size'),
});

const getRestaurantSchema = z.object({
  restaurant_id: z.string().min(1).describe('Restaurant ID in format "platform-id" (e.g., resy-12345, opentable-67890, tock-venue-slug)'),
});

const getRestaurantsSchema = z.object({
  restaurant_ids: z.array(z.string()).min(1).max(20).describe('Array of restaurant IDs to look up'),
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

// Create servers - one for SSE transport, one for HTTP transport
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

const serverHTTP = new Server(
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
    name: 'find_table',
    description: 'Find and book a table at a restaurant. Searches by name, checks availability for your date/time/party size, and books the best matching slot. Returns confirmation or booking URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant: { type: 'string', description: 'Restaurant name (e.g., "Carbone", "The Grill")' },
        location: { type: 'string', description: 'City or neighborhood (e.g., "New York", "Manhattan")' },
        date: { type: 'string', description: 'Date - YYYY-MM-DD or relative like "friday", "tomorrow"' },
        time: { type: 'string', description: 'Preferred time like "noon", "7pm", "around 8"' },
        party_size: { type: 'number', default: 2, description: 'Number of guests' },
        book: { type: 'boolean', default: true, description: 'Auto-book best slot (true) or just show options (false)' },
      },
      required: ['restaurant', 'location', 'date', 'time', 'party_size'],
    },
  },
  {
    name: 'search_restaurant',
    description: 'Search for a restaurant by name and location. Returns matching restaurants with their IDs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Restaurant name to search for' },
        location: { type: 'string', description: 'City or neighborhood' },
        date: { type: 'string', description: 'Optional date for context (YYYY-MM-DD)' },
        party_size: { type: 'number', default: 2, description: 'Party size' },
      },
      required: ['name', 'location'],
    },
  },
  {
    name: 'get_restaurant',
    description: 'Look up a restaurant by its platform-specific ID. Returns full details including name, address, cuisine, hours, contact info, and booking options.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID (e.g., resy-12345, opentable-67890, tock-venue-slug)' },
      },
      required: ['restaurant_id'],
    },
  },
  {
    name: 'get_restaurants',
    description: 'Look up multiple restaurants by their IDs in a single call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_ids: { type: 'array', items: { type: 'string' }, description: 'Array of restaurant IDs to look up' },
      },
      required: ['restaurant_ids'],
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

// Handler functions shared by both transports
const listToolsHandler = async () => {
  return { tools };
};

const callToolHandler = async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'find_table': {
        const input = findTableSchema.parse(args);
        const result = await findTable(
          input.restaurant,
          input.location,
          input.date,
          input.time,
          input.party_size,
          input.book
        );

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'search_restaurant': {
        const input = searchRestaurantSchema.parse(args);
        const result = await searchRestaurant(
          input.name,
          input.location,
          input.date,
          input.party_size
        );

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'get_restaurant': {
        const input = getRestaurantSchema.parse(args);
        const result = await getRestaurantById(input.restaurant_id);

        if (result.error) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }] };
        }

        if (!result.restaurant) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Restaurant not found' }, null, 2) }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(result.restaurant, null, 2) }] };
      }

      case 'get_restaurants': {
        const input = getRestaurantsSchema.parse(args);
        const results = await getRestaurantsByIds(input.restaurant_ids);

        const output = results.map((r) => ({
          id: r.restaurant?.id,
          name: r.restaurant?.name,
          platform: r.platform,
          found: r.restaurant !== null,
          error: r.error,
          details: r.restaurant,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
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
};

// Register handlers on both servers
server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
server.setRequestHandler(CallToolRequestSchema, callToolHandler as Parameters<typeof server.setRequestHandler>[1]);
serverHTTP.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
serverHTTP.setRequestHandler(CallToolRequestSchema, callToolHandler as Parameters<typeof serverHTTP.setRequestHandler>[1]);

// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);
const MCP_API_KEY = process.env.MCP_API_KEY || '';

const app = express();

// CORS middleware for Poke
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'restaurant-mcp', version: '2.0.0' });
});

// SSE Transport (what Poke uses)
const sseTransports = new Map<string, SSEServerTransport>();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;
  sseTransports.set(sessionId, transport);

  res.on('close', () => {
    sseTransports.delete(sessionId);
  });

  try {
    await server.connect(transport);
  } catch (err) {
    console.error('SSE connect error:', err);
  }
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports.get(sessionId);

  if (transport) {
    try {
      await transport.handlePostMessage(req, res);
    } catch (err) {
      console.error('Message handle error:', err);
      res.status(500).json({ error: 'Message handling failed' });
    }
  } else {
    res.status(400).json({ error: 'No active session' });
  }
});

// Stateless HTTP transport for MCP (Poke-compatible)
const httpTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

// API key auth: checks Authorization: Bearer <MCP_API_KEY>. Skips if no key configured.
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!MCP_API_KEY) return next();
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== MCP_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - invalid or missing API key' });
  }
  next();
}

app.post('/mcp', requireApiKey, async (req, res) => {
  try {
    await httpTransport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP POST error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP request failed' });
    }
  }
});

app.get('/mcp', requireApiKey, async (req, res) => {
  try {
    await httpTransport.handleRequest(req, res);
  } catch (err) {
    console.error('MCP GET error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP request failed' });
    }
  }
});

async function main() {
  // Start the snipe scheduler
  await startScheduler();

  // Connect HTTP transport
  await serverHTTP.connect(httpTransport);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Restaurant MCP server running on port ${PORT}`);
    console.log(`MCP HTTP: http://localhost:${PORT}/mcp`);
    console.log(`MCP SSE: http://localhost:${PORT}/sse`);
  });

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

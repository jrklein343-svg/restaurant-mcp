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
import { resyClient } from './resy/client.js';
import { searchRestaurants, searchRestaurantsSchema } from './tools/search.js';
import { checkAvailability, checkAvailabilitySchema } from './tools/availability.js';
import { makeReservation, makeReservationSchema } from './tools/reserve.js';
import {
  listReservations,
  listReservationsSchema,
  cancelReservation,
  cancelReservationSchema,
} from './tools/manage.js';
import {
  snipeReservation,
  snipeReservationSchema,
  listScheduledSnipes,
  listSnipesSchema,
  cancelSnipe,
  cancelSnipeSchema,
} from './tools/snipe.js';
import { startScheduler, stopScheduler } from './sniper/scheduler.js';

// Rate limiting
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60000;

function checkRateLimit(platform: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(platform);

  if (!record || now > record.resetTime) {
    requestCounts.set(platform, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

// Credential schemas
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
  platform: z.enum(['resy', 'opentable', 'all']).default('all').describe('Platform to check'),
});

const refreshTokenSchema = z.object({
  platform: z.enum(['resy']).describe('Platform to refresh token for'),
});

// Create server
const server = new Server(
  {
    name: 'restaurant-reservations',
    version: '1.0.0',
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
    description: 'Search for restaurants by name, cuisine, or location. Searches BOTH Resy and OpenTable by default, so you can find any restaurant regardless of which platform it uses. Each result includes a "platform" field showing where to book. Returns matching restaurants with ratings, cuisine type, and price range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Restaurant name or search term' },
        location: { type: 'string', description: 'City or neighborhood' },
        cuisine: { type: 'string', description: 'Type of cuisine (optional)' },
        platform: { type: 'string', enum: ['resy', 'opentable', 'both'], default: 'both', description: 'Which platform to search (defaults to both - just search once to find any restaurant)' },
        date: { type: 'string', description: 'Date for availability (YYYY-MM-DD)' },
        party_size: { type: 'number', default: 2, description: 'Number of guests' },
      },
      required: ['query', 'location'],
    },
  },
  {
    name: 'check_availability',
    description: 'Get available time slots for a specific restaurant on a given date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID (e.g., resy-12345)' },
        platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
        date: { type: 'string', description: 'Date to check (YYYY-MM-DD)' },
        party_size: { type: 'number', description: 'Number of guests' },
      },
      required: ['restaurant_id', 'platform', 'date', 'party_size'],
    },
  },
  {
    name: 'make_reservation',
    description: 'Book a reservation at a restaurant. For Resy, completes booking directly. For OpenTable, returns a booking URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID' },
        platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
        slot_id: { type: 'string', description: 'Time slot ID from check_availability' },
        party_size: { type: 'number', description: 'Number of guests' },
        date: { type: 'string', description: 'Reservation date (YYYY-MM-DD)' },
      },
      required: ['restaurant_id', 'platform', 'slot_id', 'party_size', 'date'],
    },
  },
  {
    name: 'list_reservations',
    description: 'View your upcoming reservations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['resy', 'opentable', 'all'], default: 'all', description: 'Platform filter' },
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
        platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
      },
      required: ['reservation_id', 'platform'],
    },
  },
  {
    name: 'set_credentials',
    description: 'Securely store API credentials for Resy or OpenTable in Windows Credential Manager.',
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
    description: 'Store email/password for automatic token refresh. Credentials are encrypted in Windows Credential Manager.',
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
        platform: { type: 'string', enum: ['resy', 'opentable', 'all'], default: 'all', description: 'Platform to check' },
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
    description: 'Schedule an automatic booking attempt for the exact moment slots become available. Perfect for popular restaurants that release reservations at specific times.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID' },
        platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
        date: { type: 'string', description: 'Target reservation date (YYYY-MM-DD)' },
        party_size: { type: 'number', description: 'Number of guests' },
        preferred_times: { type: 'array', items: { type: 'string' }, description: 'Preferred times in order (e.g., ["7:00 PM", "7:30 PM"])' },
        release_time: { type: 'string', description: 'When slots open (ISO 8601, e.g., "2025-02-01T09:00:00")' },
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
        if (!checkRateLimit(input.platform)) {
          return { content: [{ type: 'text', text: 'Rate limit exceeded. Please wait before making more requests.' }] };
        }
        const results = await searchRestaurants(input);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'check_availability': {
        const input = checkAvailabilitySchema.parse(args);
        if (!checkRateLimit(input.platform)) {
          return { content: [{ type: 'text', text: 'Rate limit exceeded. Please wait before making more requests.' }] };
        }
        const result = await checkAvailability(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'make_reservation': {
        const input = makeReservationSchema.parse(args);
        if (!checkRateLimit(input.platform)) {
          return { content: [{ type: 'text', text: 'Rate limit exceeded. Please wait before making more requests.' }] };
        }
        const result = await makeReservation(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'list_reservations': {
        const input = listReservationsSchema.parse(args);
        const results = await listReservations(input);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'cancel_reservation': {
        const input = cancelReservationSchema.parse(args);
        const result = await cancelReservation(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
              ? `Stored ${stored.join(' and ')} for ${input.platform} in Windows Credential Manager.`
              : 'No credentials provided to store.',
          }],
        };
      }

      case 'set_login': {
        const input = setLoginSchema.parse(args);

        if (input.platform === 'resy') {
          // Verify login works before storing
          try {
            await resyClient.login(input.email, input.password);
            return {
              content: [{
                type: 'text',
                text: `Login successful! Credentials stored securely. Token will auto-refresh when needed.`,
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
          const isValid = status.hasAuthToken ? await resyClient.verifyAuth() : false;
          statuses.push({ ...status, isValid });
        }

        if (input.platform === 'opentable' || input.platform === 'all') {
          const status = await getOpenTableAuthStatus();
          statuses.push({ ...status, isValid: true }); // OpenTable search works without auth
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
    stopScheduler();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopScheduler();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

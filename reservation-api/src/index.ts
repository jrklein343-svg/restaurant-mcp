import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { z } from 'zod';
import { resyClient } from './resy-client.js';
import { openTableClient } from './opentable-client.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Store active transports for cleanup
const transports = new Map<string, SSEServerTransport>();

// Tool schemas
const searchSchema = z.object({
  query: z.string().min(1).describe('Restaurant name or search term'),
  location: z.string().min(1).describe('City or neighborhood'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date in YYYY-MM-DD format'),
  partySize: z.number().int().min(1).max(20).default(2).describe('Number of guests'),
  platform: z.enum(['resy', 'opentable', 'both']).default('both').describe('Platform to search'),
});

const availabilitySchema = z.object({
  restaurantId: z.string().min(1).describe('Restaurant ID (e.g., resy-12345 or opentable-67890)'),
  platform: z.enum(['resy', 'opentable']).describe('Platform (resy or opentable)'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format'),
  partySize: z.number().int().min(1).max(20).describe('Number of guests'),
});

const reserveSchema = z.object({
  restaurantId: z.string().min(1).describe('Restaurant ID'),
  platform: z.enum(['resy', 'opentable']).describe('Platform'),
  slotId: z.string().min(1).describe('Time slot ID from availability check'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format'),
  partySize: z.number().int().min(1).max(20).describe('Number of guests'),
});

const cancelSchema = z.object({
  reservationId: z.string().min(1).describe('Reservation ID to cancel'),
});

// Create MCP server
function createServer(): Server {
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

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_restaurants',
        description: 'Search for restaurants on Resy and/or OpenTable by name, cuisine, or location',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Restaurant name or search term' },
            location: { type: 'string', description: 'City or neighborhood' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD format (optional)' },
            partySize: { type: 'number', description: 'Number of guests (default: 2)' },
            platform: { type: 'string', enum: ['resy', 'opentable', 'both'], description: 'Platform to search (default: both)' },
          },
          required: ['query', 'location'],
        },
      },
      {
        name: 'check_availability',
        description: 'Get available time slots for a specific restaurant on a specific date',
        inputSchema: {
          type: 'object',
          properties: {
            restaurantId: { type: 'string', description: 'Restaurant ID (e.g., resy-12345)' },
            platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            partySize: { type: 'number', description: 'Number of guests' },
          },
          required: ['restaurantId', 'platform', 'date', 'partySize'],
        },
      },
      {
        name: 'make_reservation',
        description: 'Book a reservation at a restaurant. For OpenTable, returns a booking URL to complete on their site.',
        inputSchema: {
          type: 'object',
          properties: {
            restaurantId: { type: 'string', description: 'Restaurant ID' },
            platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform' },
            slotId: { type: 'string', description: 'Time slot ID from availability check' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            partySize: { type: 'number', description: 'Number of guests' },
          },
          required: ['restaurantId', 'platform', 'slotId', 'date', 'partySize'],
        },
      },
      {
        name: 'list_reservations',
        description: 'List your upcoming Resy reservations',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cancel_reservation',
        description: 'Cancel a Resy reservation',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: 'Reservation ID to cancel' },
          },
          required: ['reservationId'],
        },
      },
      {
        name: 'check_auth_status',
        description: 'Check if Resy authentication is valid',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'search_restaurants': {
          const input = searchSchema.parse(args);
          const date = input.date || new Date().toISOString().split('T')[0];
          const results: any[] = [];

          const promises: Promise<void>[] = [];

          if (input.platform === 'resy' || input.platform === 'both') {
            promises.push(
              resyClient.search(input.query, input.location, date, input.partySize)
                .then((r) => r.forEach((x) => results.push({ ...x, platform: 'resy', id: `resy-${x.id}` })))
                .catch(() => {})
            );
          }

          if (input.platform === 'opentable' || input.platform === 'both') {
            promises.push(
              openTableClient.search(input.query, input.location)
                .then((r) => r.forEach((x) => results.push({ ...x, platform: 'opentable', id: `opentable-${x.id}` })))
                .catch(() => {})
            );
          }

          await Promise.all(promises);
          return {
            content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }],
          };
        }

        case 'check_availability': {
          const input = availabilitySchema.parse(args);
          const numericId = parseInt(input.restaurantId.replace(/^(resy|opentable)-/, ''), 10);

          if (input.platform === 'resy') {
            const slots = await resyClient.getAvailability(numericId, input.date, input.partySize);
            return {
              content: [{ type: 'text', text: JSON.stringify({ platform: 'resy', slots }, null, 2) }],
            };
          } else {
            const slots = await openTableClient.getAvailability(numericId, input.date, input.partySize);
            return {
              content: [{ type: 'text', text: JSON.stringify({ platform: 'opentable', slots }, null, 2) }],
            };
          }
        }

        case 'make_reservation': {
          const input = reserveSchema.parse(args);

          if (input.platform === 'opentable') {
            const numericId = parseInt(input.restaurantId.replace(/^opentable-/, ''), 10);
            const bookingUrl = `https://www.opentable.com/booking/experiences-availability?rid=${numericId}&datetime=${input.date}T${input.slotId}&covers=${input.partySize}`;
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  platform: 'opentable',
                  bookingUrl,
                  message: 'Complete booking at the URL above',
                }, null, 2),
              }],
            };
          }

          const details = await resyClient.getBookingDetails(input.slotId, input.date, input.partySize);
          const result = await resyClient.makeReservation(details.bookToken, details.paymentMethodId);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                platform: 'resy',
                reservationId: result.reservationId,
              }, null, 2),
            }],
          };
        }

        case 'list_reservations': {
          const reservations = await resyClient.getReservations();
          return {
            content: [{ type: 'text', text: JSON.stringify({ reservations }, null, 2) }],
          };
        }

        case 'cancel_reservation': {
          const input = cancelSchema.parse(args);
          await resyClient.cancelReservation(input.reservationId);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
          };
        }

        case 'check_auth_status': {
          try {
            await resyClient.ensureAuth();
            return {
              content: [{ type: 'text', text: JSON.stringify({ authenticated: true }, null, 2) }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  authenticated: false,
                  error: error instanceof Error ? error.message : 'Unknown error',
                }, null, 2),
              }],
            };
          }
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          content: [{ type: 'text', text: `Invalid input: ${JSON.stringify(error.errors)}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SSE endpoint for MCP
app.get('/sse', async (req, res) => {
  console.log('[MCP] New SSE connection');

  const transport = new SSEServerTransport('/message', res);
  const sessionId = Math.random().toString(36).substring(7);
  transports.set(sessionId, transport);

  const server = createServer();

  res.on('close', () => {
    console.log('[MCP] SSE connection closed');
    transports.delete(sessionId);
  });

  await server.connect(transport);
});

// Message endpoint for MCP
app.post('/message', express.json(), async (req, res) => {
  // Find the transport that matches this session
  // The SSE transport handles message routing internally
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (transport) {
    // The transport handles the message
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: 'No active session' });
  }
});

async function main() {
  console.log('[MCP Server] Starting Restaurant Reservation MCP Server...');

  try {
    await resyClient.ensureAuth();
    console.log('[MCP Server] Resy authentication successful');
  } catch (error) {
    console.warn('[MCP Server] Resy auth failed:', error instanceof Error ? error.message : error);
    console.warn('[MCP Server] Set RESY_EMAIL and RESY_PASSWORD environment variables');
  }

  app.listen(PORT, () => {
    console.log(`[MCP Server] Listening on port ${PORT}`);
    console.log('[MCP Server] MCP SSE endpoint: /sse');
    console.log('[MCP Server] Health check: /health');
  });
}

main().catch(console.error);

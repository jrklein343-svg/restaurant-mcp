import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { z } from 'zod';
import { resyClient } from './resy-client.js';
import { openTableClient } from './opentable-client.js';
import { randomUUID } from 'crypto';
import axios from 'axios';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Helper: Parse date from various formats
function parseDate(input: string | undefined): string {
  if (!input) return new Date().toISOString().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${input}. Use YYYY-MM-DD format or natural language.`);
  }
  return date.toISOString().split('T')[0];
}

// Helper: Parse restaurant ID
function parseRestaurantId(input: string | number): { id: number; platform: 'resy' | 'opentable' | null } {
  const str = String(input);
  if (str.toLowerCase().startsWith('resy-')) {
    return { id: parseInt(str.slice(5), 10), platform: 'resy' };
  }
  if (str.toLowerCase().startsWith('opentable-')) {
    return { id: parseInt(str.slice(10), 10), platform: 'opentable' };
  }
  return { id: parseInt(str, 10), platform: null };
}

// Helper: Parse party size
function parsePartySize(input: string | number | undefined): number {
  if (!input) return 2;
  const size = typeof input === 'string' ? parseInt(input, 10) : input;
  if (isNaN(size) || size < 1 || size > 20) return 2;
  return size;
}

// Flexible schemas
const searchSchema = z.object({
  query: z.string().min(1),
  location: z.string().min(1),
  date: z.string().optional(),
  partySize: z.union([z.string(), z.number()]).optional(),
  party_size: z.union([z.string(), z.number()]).optional(), // alias
  platform: z.enum(['resy', 'opentable', 'both']).optional(),
});

const availabilitySchema = z.object({
  restaurantId: z.union([z.string(), z.number()]),
  restaurant_id: z.union([z.string(), z.number()]).optional(), // alias
  platform: z.enum(['resy', 'opentable']).optional(),
  date: z.string(),
  partySize: z.union([z.string(), z.number()]).optional(),
  party_size: z.union([z.string(), z.number()]).optional(), // alias
});

const reserveSchema = z.object({
  restaurantId: z.union([z.string(), z.number()]),
  restaurant_id: z.union([z.string(), z.number()]).optional(), // alias
  platform: z.enum(['resy', 'opentable']).optional(),
  slotId: z.string(),
  slot_id: z.string().optional(), // alias
  date: z.string(),
  partySize: z.union([z.string(), z.number()]).optional(),
  party_size: z.union([z.string(), z.number()]).optional(), // alias
});

const cancelSchema = z.object({
  reservationId: z.string(),
  reservation_id: z.string().optional(), // alias
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_restaurants',
        description: `Search for restaurants on Resy and OpenTable.

EXAMPLES:
- search_restaurants(query: "Italian", location: "New York")
- search_restaurants(query: "Carbone", location: "NYC", partySize: 4)
- search_restaurants(query: "sushi", location: "Los Angeles", platform: "resy")

DEFAULTS: partySize=2, platform=both (searches Resy + OpenTable), date=today`,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Restaurant name, cuisine, or search term' },
            location: { type: 'string', description: 'City or neighborhood (e.g., "New York", "SF", "Los Angeles")' },
            date: { type: 'string', description: 'Date for availability (optional, defaults to today)' },
            partySize: { type: ['string', 'number'], description: 'Number of guests (optional, defaults to 2)' },
            platform: { type: 'string', enum: ['resy', 'opentable', 'both'], description: 'Where to search (optional, defaults to both)' },
          },
          required: ['query', 'location'],
        },
      },
      {
        name: 'check_availability',
        description: `Get available time slots for a restaurant.

EXAMPLES:
- check_availability(restaurantId: "resy-12345", date: "2026-02-15", partySize: 2)
- check_availability(restaurantId: 12345, platform: "resy", date: "2026-02-15")

The restaurantId comes from search_restaurants results.`,
        inputSchema: {
          type: 'object',
          properties: {
            restaurantId: { type: ['string', 'number'], description: 'Restaurant ID from search results (e.g., "resy-12345" or 12345)' },
            platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform (can be auto-detected from restaurantId prefix)' },
            date: { type: 'string', description: 'Date (YYYY-MM-DD or natural language)' },
            partySize: { type: ['string', 'number'], description: 'Number of guests (defaults to 2)' },
          },
          required: ['restaurantId', 'date'],
        },
      },
      {
        name: 'make_reservation',
        description: `Book a reservation. For Resy: books directly. For OpenTable: returns booking URL.

EXAMPLE:
- make_reservation(restaurantId: "resy-12345", slotId: "config_token_here", date: "2026-02-15", partySize: 2)

The slotId comes from check_availability results.`,
        inputSchema: {
          type: 'object',
          properties: {
            restaurantId: { type: ['string', 'number'], description: 'Restaurant ID' },
            platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform (auto-detected from ID prefix)' },
            slotId: { type: 'string', description: 'Time slot ID from availability check' },
            date: { type: 'string', description: 'Reservation date' },
            partySize: { type: ['string', 'number'], description: 'Number of guests' },
          },
          required: ['restaurantId', 'slotId', 'date'],
        },
      },
      {
        name: 'list_reservations',
        description: 'List your upcoming Resy reservations. No parameters needed.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'cancel_reservation',
        description: 'Cancel a Resy reservation by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: 'The reservation ID to cancel' },
          },
          required: ['reservationId'],
        },
      },
      {
        name: 'check_auth_status',
        description: 'Check if Resy authentication is working. No parameters needed.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_venue_availability',
        description: `Get availability for a known Resy venue ID directly (bypasses search).

EXAMPLES:
- get_venue_availability(venueId: 1505, date: "2026-02-15", partySize: 2)  // Carbone NYC
- get_venue_availability(venueId: 25973, date: "2026-02-15", partySize: 4) // 4 Charles Prime Rib

Common NYC venue IDs:
- Carbone: 1505
- Don Angie: 5765
- Via Carota: 2567
- 4 Charles Prime Rib: 25973
- Le Coucou: 3013`,
        inputSchema: {
          type: 'object',
          properties: {
            venueId: { type: 'number', description: 'Resy venue ID (numeric)' },
            date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
            partySize: { type: ['string', 'number'], description: 'Number of guests (defaults to 2)' },
          },
          required: ['venueId', 'date'],
        },
      },
      {
        name: 'lookup_venue_id',
        description: `Look up a Resy venue ID from a restaurant name or Resy URL.

EXAMPLES:
- lookup_venue_id(url: "https://resy.com/cities/ny/carbone")
- lookup_venue_id(name: "Carbone", city: "ny")
- lookup_venue_id(name: "Bestia", city: "la")

City codes: ny, la, sf, chi, mia, dc, las-vegas, austin, denver, seattle, boston, etc.`,
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Full Resy URL (e.g., https://resy.com/cities/ny/carbone)' },
            name: { type: 'string', description: 'Restaurant name (use with city)' },
            city: { type: 'string', description: 'City code: ny, la, sf, chi, mia, dc, etc.' },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'search_restaurants': {
          const raw = searchSchema.parse(args);
          const date = parseDate(raw.date);
          const partySize = parsePartySize(raw.partySize || raw.party_size);
          const platform = raw.platform || 'both';

          const results: any[] = [];
          const errors: string[] = [];

          const promises: Promise<void>[] = [];

          if (platform === 'resy' || platform === 'both') {
            promises.push(
              resyClient.search(raw.query, raw.location, date, partySize)
                .then((r) => r.forEach((x) => results.push({
                  id: `resy-${x.id}`,
                  name: x.name,
                  location: x.location,
                  neighborhood: x.neighborhood,
                  cuisine: x.cuisine,
                  priceRange: x.priceRange,
                  rating: x.rating,
                  platform: 'resy',
                })))
                .catch((e) => { errors.push(`Resy: ${e.message}`); })
            );
          }

          if (platform === 'opentable' || platform === 'both') {
            promises.push(
              openTableClient.search(raw.query, raw.location)
                .then((r) => r.forEach((x) => results.push({
                  id: `opentable-${x.id}`,
                  name: x.name,
                  address: x.address,
                  city: x.city,
                  cuisine: x.cuisine,
                  priceRange: x.priceRange,
                  rating: x.rating,
                  platform: 'opentable',
                })))
                .catch((e) => { errors.push(`OpenTable: ${e.message}`); })
            );
          }

          await Promise.all(promises);

          if (results.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `No restaurants found for "${raw.query}" in ${raw.location}.${errors.length ? ` Errors: ${errors.join(', ')}` : ''} Try a different search term or location.`,
              }],
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query: raw.query,
                location: raw.location,
                date,
                partySize,
                resultCount: results.length,
                results: results.slice(0, 20), // Limit to 20 results
                note: results.length > 20 ? `Showing first 20 of ${results.length} results.` : undefined,
              }, null, 2),
            }],
          };
        }

        case 'check_availability': {
          const raw = availabilitySchema.parse(args);
          const restaurantIdRaw = raw.restaurantId || raw.restaurant_id;
          const { id: numericId, platform: detectedPlatform } = parseRestaurantId(restaurantIdRaw!);
          const platform = raw.platform || detectedPlatform;
          const date = parseDate(raw.date);
          const partySize = parsePartySize(raw.partySize || raw.party_size);

          if (!platform) {
            return {
              content: [{ type: 'text', text: 'Platform required. Use "resy" or "opentable", or prefix ID like "resy-12345".' }],
              isError: true,
            };
          }

          if (platform === 'resy') {
            const slots = await resyClient.getAvailability(numericId, date, partySize);
            if (slots.length === 0) {
              return {
                content: [{ type: 'text', text: `No availability found for restaurant ${numericId} on ${date} for ${partySize} guests.` }],
              };
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  platform: 'resy',
                  restaurantId: numericId,
                  date,
                  partySize,
                  slotCount: slots.length,
                  slots: slots.map(s => ({
                    time: s.time,
                    slotId: s.slotId,
                    type: s.type,
                  })),
                  note: 'Use the slotId with make_reservation to book.',
                }, null, 2),
              }],
            };
          } else {
            const slots = await openTableClient.getAvailability(numericId, date, partySize);
            if (slots.length === 0) {
              return {
                content: [{ type: 'text', text: `No availability found for restaurant ${numericId} on ${date} for ${partySize} guests.` }],
              };
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  platform: 'opentable',
                  restaurantId: numericId,
                  date,
                  partySize,
                  slotCount: slots.length,
                  slots: slots.map(s => ({
                    time: s.time,
                    bookingUrl: s.bookingUrl,
                  })),
                  note: 'OpenTable requires completing booking on their website. Use the bookingUrl.',
                }, null, 2),
              }],
            };
          }
        }

        case 'make_reservation': {
          const raw = reserveSchema.parse(args);
          const restaurantIdRaw = raw.restaurantId || raw.restaurant_id;
          const slotId = raw.slotId || raw.slot_id;
          const { id: numericId, platform: detectedPlatform } = parseRestaurantId(restaurantIdRaw!);
          const platform = raw.platform || detectedPlatform;
          const date = parseDate(raw.date);
          const partySize = parsePartySize(raw.partySize || raw.party_size);

          if (!platform) {
            return {
              content: [{ type: 'text', text: 'Platform required. Use "resy" or "opentable", or prefix ID like "resy-12345".' }],
              isError: true,
            };
          }

          if (!slotId) {
            return {
              content: [{ type: 'text', text: 'slotId required. Get it from check_availability results.' }],
              isError: true,
            };
          }

          if (platform === 'opentable') {
            const bookingUrl = `https://www.opentable.com/booking/experiences-availability?rid=${numericId}&datetime=${date}T${slotId}&covers=${partySize}`;
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  platform: 'opentable',
                  message: '⚠️ OpenTable requires completing booking on their website.',
                  bookingUrl,
                  instructions: 'Click the booking URL to complete your reservation on OpenTable.',
                }, null, 2),
              }],
            };
          }

          const details = await resyClient.getBookingDetails(slotId, date, partySize);
          const result = await resyClient.makeReservation(details.bookToken, details.paymentMethodId);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: '✅ Reservation confirmed!',
                platform: 'resy',
                reservationId: result.reservationId,
                date,
                partySize,
              }, null, 2),
            }],
          };
        }

        case 'list_reservations': {
          const reservations = await resyClient.getReservations();
          if (reservations.length === 0) {
            return {
              content: [{ type: 'text', text: 'No upcoming reservations found.' }],
            };
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                count: reservations.length,
                reservations,
              }, null, 2),
            }],
          };
        }

        case 'cancel_reservation': {
          const raw = cancelSchema.parse(args);
          const reservationId = raw.reservationId || raw.reservation_id;
          if (!reservationId) {
            return {
              content: [{ type: 'text', text: 'reservationId required.' }],
              isError: true,
            };
          }
          await resyClient.cancelReservation(reservationId);
          return {
            content: [{ type: 'text', text: `✅ Reservation ${reservationId} cancelled.` }],
          };
        }

        case 'check_auth_status': {
          try {
            await resyClient.ensureAuth();
            return {
              content: [{ type: 'text', text: '✅ Resy authentication is working.' }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ Resy authentication failed: ${error instanceof Error ? error.message : 'Unknown'}`,
              }],
              isError: true,
            };
          }
        }

        case 'get_venue_availability': {
          const venueId = (args as any).venueId || (args as any).venue_id;
          const date = parseDate((args as any).date);
          const partySize = parsePartySize((args as any).partySize || (args as any).party_size);

          if (!venueId || typeof venueId !== 'number') {
            return {
              content: [{ type: 'text', text: 'venueId (number) is required. Example: venueId: 1505 for Carbone NYC' }],
              isError: true,
            };
          }

          console.log(`[Resy] Direct venue lookup: venueId=${venueId}, date=${date}, partySize=${partySize}`);
          const slots = await resyClient.getAvailability(venueId, date, partySize);

          if (slots.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `No availability found for venue ${venueId} on ${date} for ${partySize} guests. The restaurant may be fully booked or not taking reservations for this date.`,
              }],
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                platform: 'resy',
                venueId,
                restaurantId: `resy-${venueId}`,
                date,
                partySize,
                slotCount: slots.length,
                slots: slots.map(s => ({
                  time: s.time,
                  slotId: s.slotId,
                  type: s.type,
                })),
                note: 'Use slotId with make_reservation to book.',
              }, null, 2),
            }],
          };
        }

        case 'lookup_venue_id': {
          const url = (args as any).url;
          const name = (args as any).name;
          const city = (args as any).city;

          let targetUrl: string;

          if (url) {
            targetUrl = url;
          } else if (name && city) {
            // Convert name to URL slug: "Don Angie" -> "don-angie"
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            targetUrl = `https://resy.com/cities/${city.toLowerCase()}/${slug}`;
          } else {
            return {
              content: [{ type: 'text', text: 'Provide either url, or both name and city. Example: name: "Carbone", city: "ny"' }],
              isError: true,
            };
          }

          console.log(`[Resy] Looking up venue ID from: ${targetUrl}`);

          try {
            const response = await axios.get(targetUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              },
              timeout: 10000,
            });

            const html = response.data as string;

            // Try multiple patterns to extract venue ID
            let venueId: number | null = null;
            let venueName: string | null = null;

            // Pattern 1: Look for venue ID in JSON data
            const jsonMatch = html.match(/"venue":\s*\{[^}]*"id":\s*\{[^}]*"resy":\s*(\d+)/);
            if (jsonMatch) {
              venueId = parseInt(jsonMatch[1], 10);
            }

            // Pattern 2: Look for data-venue-id attribute
            if (!venueId) {
              const attrMatch = html.match(/data-venue-id="(\d+)"/);
              if (attrMatch) {
                venueId = parseInt(attrMatch[1], 10);
              }
            }

            // Pattern 3: Look for venue_id in script tags
            if (!venueId) {
              const scriptMatch = html.match(/venue_id['":\s]+(\d+)/);
              if (scriptMatch) {
                venueId = parseInt(scriptMatch[1], 10);
              }
            }

            // Pattern 4: Look for "resy": followed by number
            if (!venueId) {
              const resyMatch = html.match(/"resy":\s*(\d+)/);
              if (resyMatch) {
                venueId = parseInt(resyMatch[1], 10);
              }
            }

            // Try to extract venue name
            const nameMatch = html.match(/<title>([^<|]+)/);
            if (nameMatch) {
              venueName = nameMatch[1].trim();
            }

            if (venueId) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    venueId,
                    restaurantId: `resy-${venueId}`,
                    name: venueName,
                    url: targetUrl,
                    note: 'Use this venueId with get_venue_availability to check availability.',
                  }, null, 2),
                }],
              };
            } else {
              return {
                content: [{
                  type: 'text',
                  text: `Could not find venue ID at ${targetUrl}. The restaurant may not exist on Resy or the URL format may be different. Try the exact URL from resy.com.`,
                }],
              };
            }
          } catch (error) {
            const status = (error as any).response?.status;
            if (status === 404) {
              return {
                content: [{
                  type: 'text',
                  text: `Restaurant not found at ${targetUrl}. Check the URL or try a different name/city combination.`,
                }],
              };
            }
            return {
              content: [{
                type: 'text',
                text: `Error fetching ${targetUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
              }],
              isError: true,
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
        const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return {
          content: [{ type: 'text', text: `Invalid input: ${issues}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown'}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Session management
const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  next();
});

app.options('*', (_req, res) => res.status(200).end());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.all('/mcp', express.json(), async (req, res) => {
  if (req.method === 'GET') {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid session' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    return;
  }

  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.server.close();
      sessions.delete(sessionId);
    }
    res.status(200).json({ success: true });
    return;
  }

  if (req.method === 'POST') {
    let sessionId = req.headers['mcp-session-id'] as string;
    if (!sessionId || !sessions.has(sessionId)) {
      sessionId = randomUUID();
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
      sessions.set(sessionId, { server, transport });
      await server.connect(transport);
    }
    try {
      await sessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});

async function main() {
  console.log('[MCP] Starting Restaurant Reservation Server...');
  try {
    await resyClient.ensureAuth();
    console.log('[MCP] Resy auth successful');
  } catch (e) {
    console.warn('[MCP] Resy auth failed:', e instanceof Error ? e.message : e);
  }
  app.listen(PORT, () => console.log(`[MCP] Listening on port ${PORT}`));
}

main().catch(console.error);

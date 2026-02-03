import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { z } from 'zod';
import { createSnipe, listSnipes, getSnipe, updateSnipe, deleteSnipe } from './store.js';
import { scheduleSnipe, cancelSnipe, isSnipeScheduled, loadPendingSnipes } from './sniper.js';
import { resyClient } from './resy-client.js';
import { randomUUID } from 'crypto';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Helper: Parse restaurant ID from various formats
function parseRestaurantId(input: string | number): number {
  if (typeof input === 'number') return input;
  // Remove prefixes like "resy-" or "opentable-"
  const cleaned = String(input).replace(/^(resy|opentable)-/i, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) throw new Error(`Invalid restaurant ID: ${input}. Must be a number or "resy-12345" format.`);
  return num;
}

// Helper: Parse date from various formats
function parseDate(input: string): string {
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

  // Try parsing common formats
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${input}. Use YYYY-MM-DD format (e.g., "2026-02-15") or natural language like "February 15, 2026".`);
  }
  return date.toISOString().split('T')[0];
}

// Helper: Parse release time from various formats
function parseReleaseTime(input: string, targetDate: string): string {
  // Already valid ISO format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input)) {
    return new Date(input).toISOString();
  }

  // Try parsing as date
  let date = new Date(input);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // Try parsing as time only (e.g., "9:00 AM", "09:00")
  const timeMatch = input.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2] || '0', 10);
    const meridiem = (timeMatch[3] || '').toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    // Default to today or tomorrow for release
    const today = new Date();
    today.setHours(hours, minutes, 0, 0);

    // If time already passed today, use tomorrow
    if (today.getTime() < Date.now()) {
      today.setDate(today.getDate() + 1);
    }

    return today.toISOString();
  }

  throw new Error(`Invalid release time: ${input}. Use ISO format "2026-02-01T09:00:00" or simple time like "9:00 AM".`);
}

// Helper: Normalize preferred times
function normalizePreferredTimes(input: string | string[]): string[] {
  if (Array.isArray(input)) return input;
  // Single time as string
  if (typeof input === 'string') {
    // Check if comma-separated
    if (input.includes(',')) {
      return input.split(',').map(t => t.trim());
    }
    return [input];
  }
  return ['7:00 PM']; // Default
}

// Helper: Detect platform from restaurant ID
function detectPlatform(restaurantId: string | number): 'resy' | 'opentable' {
  const str = String(restaurantId).toLowerCase();
  if (str.startsWith('opentable-')) return 'opentable';
  return 'resy'; // Default to resy
}

// Flexible schema - accepts many input formats
const createSnipeSchema = z.object({
  restaurantId: z.union([z.string(), z.number()]),
  restaurantName: z.string().min(1),
  platform: z.enum(['resy', 'opentable']).optional(),
  date: z.string().min(1),
  partySize: z.union([z.string(), z.number()]).optional().default(2),
  preferredTimes: z.union([z.string(), z.array(z.string())]).optional().default(['7:00 PM', '7:30 PM', '8:00 PM']),
  releaseTime: z.string().min(1),
});

const snipeIdSchema = z.object({
  snipeId: z.string().min(1),
});

// Create MCP server
function createServer(): Server {
  const server = new Server(
    {
      name: 'restaurant-sniper',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'create_snipe',
        description: `Schedule an automatic reservation snipe. The sniper will book instantly when slots open.

EXAMPLES:
- Simple: create_snipe(restaurantId: 12345, restaurantName: "Carbone", date: "2026-02-15", releaseTime: "9:00 AM")
- Full: create_snipe(restaurantId: "resy-12345", restaurantName: "Carbone", platform: "resy", date: "2026-02-15", partySize: 2, preferredTimes: ["7:00 PM", "7:30 PM"], releaseTime: "2026-02-01T09:00:00")

DEFAULTS: partySize=2, preferredTimes=["7:00 PM", "7:30 PM", "8:00 PM"], platform=resy`,
        inputSchema: {
          type: 'object',
          properties: {
            restaurantId: {
              type: ['string', 'number'],
              description: 'Restaurant ID. Can be number (12345) or string ("resy-12345")'
            },
            restaurantName: {
              type: 'string',
              description: 'Restaurant name (for notifications)'
            },
            platform: {
              type: 'string',
              enum: ['resy', 'opentable'],
              description: 'Platform (optional, defaults to resy)'
            },
            date: {
              type: 'string',
              description: 'Reservation date. Accepts "2026-02-15" or "February 15, 2026"'
            },
            partySize: {
              type: ['string', 'number'],
              description: 'Number of guests (optional, defaults to 2)'
            },
            preferredTimes: {
              type: ['string', 'array'],
              description: 'Preferred times. Can be single "7:00 PM" or array ["7:00 PM", "7:30 PM"] or comma-separated "7:00 PM, 7:30 PM". Defaults to dinner times.'
            },
            releaseTime: {
              type: 'string',
              description: 'When reservations open. Accepts "9:00 AM" or "2026-02-01T09:00:00"'
            },
          },
          required: ['restaurantId', 'restaurantName', 'date', 'releaseTime'],
        },
      },
      {
        name: 'list_snipes',
        description: 'List all scheduled and completed snipes. No parameters needed.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_snipe',
        description: 'Get details about a specific snipe by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            snipeId: { type: 'string', description: 'The snipe ID returned when you created the snipe' },
          },
          required: ['snipeId'],
        },
      },
      {
        name: 'cancel_snipe',
        description: 'Cancel a pending snipe by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            snipeId: { type: 'string', description: 'The snipe ID to cancel' },
          },
          required: ['snipeId'],
        },
      },
      {
        name: 'check_auth_status',
        description: 'Check if Resy authentication is working. No parameters needed.',
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
        case 'create_snipe': {
          // Parse with flexible schema
          const raw = createSnipeSchema.parse(args);

          // Normalize all inputs
          const restaurantId = parseRestaurantId(raw.restaurantId);
          const date = parseDate(raw.date);
          const releaseTime = parseReleaseTime(raw.releaseTime, date);
          const platform = raw.platform || detectPlatform(raw.restaurantId);
          const partySize = typeof raw.partySize === 'string' ? parseInt(raw.partySize, 10) : (raw.partySize || 2);
          const preferredTimes = normalizePreferredTimes(raw.preferredTimes);

          // Validate party size
          if (partySize < 1 || partySize > 20) {
            return {
              content: [{ type: 'text', text: `Party size must be between 1 and 20. Got: ${partySize}` }],
              isError: true,
            };
          }

          // Check release time is in future
          const releaseDate = new Date(releaseTime);
          if (releaseDate.getTime() < Date.now()) {
            return {
              content: [{ type: 'text', text: `Release time must be in the future. Got: ${releaseTime} (${releaseDate.toLocaleString()})` }],
              isError: true,
            };
          }

          const snipe = await createSnipe({
            restaurantId,
            restaurantName: raw.restaurantName,
            date,
            partySize,
            preferredTimes,
            releaseTime,
          });

          scheduleSnipe(snipe, platform);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `✅ Snipe scheduled!`,
                details: {
                  id: snipe.id,
                  restaurant: raw.restaurantName,
                  restaurantId,
                  platform,
                  date,
                  partySize,
                  preferredTimes,
                  releaseTime: releaseDate.toLocaleString(),
                },
                note: `The sniper will attempt to book at ${releaseDate.toLocaleString()} for ${preferredTimes.join(' or ')}.`
              }, null, 2),
            }],
          };
        }

        case 'list_snipes': {
          const snipes = await listSnipes();
          if (snipes.length === 0) {
            return {
              content: [{ type: 'text', text: 'No snipes scheduled. Use create_snipe to schedule one.' }],
            };
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                count: snipes.length,
                snipes: snipes.map(s => ({
                  id: s.id,
                  restaurant: s.restaurantName,
                  date: s.date,
                  status: s.status,
                  isScheduled: isSnipeScheduled(s.id),
                  releaseTime: new Date(s.releaseTime).toLocaleString(),
                })),
              }, null, 2),
            }],
          };
        }

        case 'get_snipe': {
          const { snipeId } = snipeIdSchema.parse(args);
          const snipe = await getSnipe(snipeId);

          if (!snipe) {
            return {
              content: [{ type: 'text', text: `Snipe not found with ID: ${snipeId}. Use list_snipes to see all snipes.` }],
              isError: true,
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ...snipe,
                isScheduled: isSnipeScheduled(snipe.id),
                releaseTimeFormatted: new Date(snipe.releaseTime).toLocaleString(),
              }, null, 2),
            }],
          };
        }

        case 'cancel_snipe': {
          const { snipeId } = snipeIdSchema.parse(args);
          const snipe = await getSnipe(snipeId);

          if (!snipe) {
            return {
              content: [{ type: 'text', text: `Snipe not found with ID: ${snipeId}. Use list_snipes to see all snipes.` }],
              isError: true,
            };
          }

          if (snipe.status !== 'pending') {
            return {
              content: [{ type: 'text', text: `Cannot cancel snipe - status is "${snipe.status}". Only pending snipes can be cancelled.` }],
              isError: true,
            };
          }

          cancelSnipe(snipeId);
          await updateSnipe(snipeId, 'cancelled');
          await deleteSnipe(snipeId);

          return {
            content: [{ type: 'text', text: `✅ Snipe cancelled for ${snipe.restaurantName} on ${snipe.date}.` }],
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
                text: `❌ Resy authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure RESY_EMAIL and RESY_PASSWORD are set.`,
              }],
              isError: true,
            };
          }
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}. Available: create_snipe, list_snipes, get_snipe, cancel_snipe, check_auth_status` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (error instanceof z.ZodError) {
        const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return {
          content: [{ type: 'text', text: `Invalid input: ${issues}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Store active sessions
const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

// Enable CORS for all routes
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  next();
});

app.options('*', (_req, res) => {
  res.status(200).end();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MCP endpoint - Streamable HTTP transport
app.all('/mcp', express.json(), async (req, res) => {
  console.log(`[MCP] ${req.method} /mcp from:`, req.ip);

  if (req.method === 'GET') {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    req.on('close', () => sessions.delete(sessionId));
    return;
  }

  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.server.close();
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
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });
      sessions.set(sessionId, { server, transport });
      await server.connect(transport);
    }

    const session = sessions.get(sessionId)!;
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[MCP] Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal error' });
      }
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});

async function main() {
  console.log('[MCP Sniper] Starting Restaurant Sniper MCP Server v1.1...');

  try {
    await resyClient.ensureAuth();
    console.log('[MCP Sniper] Resy authentication successful');
  } catch (error) {
    console.warn('[MCP Sniper] Resy auth failed:', error instanceof Error ? error.message : error);
  }

  await loadPendingSnipes();

  app.listen(PORT, () => {
    console.log(`[MCP Sniper] Listening on port ${PORT}`);
    console.log('[MCP Sniper] MCP endpoint: /mcp');
  });
}

main().catch(console.error);

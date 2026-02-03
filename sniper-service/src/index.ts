import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { z } from 'zod';
import { createSnipe, listSnipes, getSnipe, updateSnipe, deleteSnipe } from './store.js';
import { scheduleSnipe, cancelSnipe, isSnipeScheduled, loadPendingSnipes } from './sniper.js';
import { resyClient } from './resy-client.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Store active transports
const transports = new Map<string, SSEServerTransport>();

// Schemas
const createSnipeSchema = z.object({
  restaurantId: z.number().int().positive().describe('Numeric restaurant ID'),
  restaurantName: z.string().min(1).describe('Restaurant name for notifications'),
  platform: z.enum(['resy', 'opentable']).describe('Platform (resy or opentable)'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Target date YYYY-MM-DD'),
  partySize: z.number().int().min(1).max(20).describe('Number of guests'),
  preferredTimes: z.array(z.string()).min(1).max(10).describe('Preferred times like ["7:00 PM", "7:30 PM"]'),
  releaseTime: z.string().describe('When reservations open (ISO 8601)'),
});

const snipeIdSchema = z.object({
  snipeId: z.string().min(1).describe('Snipe ID to operate on'),
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
        description: 'Schedule a snipe to automatically book a reservation the instant slots open. The sniper will poll aggressively at release time and book the first available slot from your preferred times.',
        inputSchema: {
          type: 'object',
          properties: {
            restaurantId: { type: 'number', description: 'Numeric restaurant ID' },
            restaurantName: { type: 'string', description: 'Restaurant name for notifications' },
            platform: { type: 'string', enum: ['resy', 'opentable'], description: 'Platform (resy or opentable)' },
            date: { type: 'string', description: 'Target date YYYY-MM-DD' },
            partySize: { type: 'number', description: 'Number of guests' },
            preferredTimes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Preferred times like ["7:00 PM", "7:30 PM"]'
            },
            releaseTime: { type: 'string', description: 'When reservations open (ISO 8601 datetime)' },
          },
          required: ['restaurantId', 'restaurantName', 'platform', 'date', 'partySize', 'preferredTimes', 'releaseTime'],
        },
      },
      {
        name: 'list_snipes',
        description: 'List all scheduled and completed snipes',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_snipe',
        description: 'Get details about a specific snipe',
        inputSchema: {
          type: 'object',
          properties: {
            snipeId: { type: 'string', description: 'Snipe ID' },
          },
          required: ['snipeId'],
        },
      },
      {
        name: 'cancel_snipe',
        description: 'Cancel a pending snipe',
        inputSchema: {
          type: 'object',
          properties: {
            snipeId: { type: 'string', description: 'Snipe ID to cancel' },
          },
          required: ['snipeId'],
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
        case 'create_snipe': {
          const input = createSnipeSchema.parse(args);

          const releaseDate = new Date(input.releaseTime);
          if (releaseDate.getTime() < Date.now()) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Release time must be in the future' }) }],
              isError: true,
            };
          }

          const snipe = await createSnipe({
            restaurantId: input.restaurantId,
            restaurantName: input.restaurantName,
            date: input.date,
            partySize: input.partySize,
            preferredTimes: input.preferredTimes,
            releaseTime: input.releaseTime,
          });

          scheduleSnipe(snipe, input.platform);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                snipe: {
                  ...snipe,
                  platform: input.platform,
                  isScheduled: true,
                },
                message: `Snipe scheduled for ${input.restaurantName} on ${input.date}. Will attempt booking at ${input.releaseTime}`,
              }, null, 2),
            }],
          };
        }

        case 'list_snipes': {
          const snipes = await listSnipes();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                snipes: snipes.map(s => ({
                  ...s,
                  isScheduled: isSnipeScheduled(s.id),
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
              content: [{ type: 'text', text: JSON.stringify({ error: 'Snipe not found' }) }],
              isError: true,
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ...snipe,
                isScheduled: isSnipeScheduled(snipe.id),
              }, null, 2),
            }],
          };
        }

        case 'cancel_snipe': {
          const { snipeId } = snipeIdSchema.parse(args);
          const snipe = await getSnipe(snipeId);

          if (!snipe) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Snipe not found' }) }],
              isError: true,
            };
          }

          if (snipe.status !== 'pending') {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: `Cannot cancel snipe with status: ${snipe.status}` }) }],
              isError: true,
            };
          }

          cancelSnipe(snipeId);
          await updateSnipe(snipeId, 'cancelled');
          await deleteSnipe(snipeId);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: 'Snipe cancelled' }, null, 2),
            }],
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

// Health check
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
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: 'No active session' });
  }
});

async function main() {
  console.log('[MCP Sniper] Starting Restaurant Sniper MCP Server...');

  // Verify Resy credentials on startup
  try {
    await resyClient.ensureAuth();
    console.log('[MCP Sniper] Resy authentication successful');
  } catch (error) {
    console.warn('[MCP Sniper] Resy auth failed:', error instanceof Error ? error.message : error);
    console.warn('[MCP Sniper] Set RESY_EMAIL and RESY_PASSWORD environment variables');
  }

  // Load pending snipes from database
  await loadPendingSnipes();

  app.listen(PORT, () => {
    console.log(`[MCP Sniper] Listening on port ${PORT}`);
    console.log('[MCP Sniper] MCP SSE endpoint: /sse');
    console.log('[MCP Sniper] Health check: /health');
  });
}

main().catch((error) => {
  console.error('[MCP Sniper] Fatal error:', error);
  process.exit(1);
});

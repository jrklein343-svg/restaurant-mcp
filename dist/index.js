import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { setCredential, getCredential, getResyAuthStatus, getOpenTableAuthStatus, } from './credentials.js';
import { resyClient } from './platforms/resy.js';
import { parseRestaurantId } from './platforms/base.js';
import { findTable, searchRestaurant, getRestaurantById, getRestaurantsByIds, checkAvailability, getBookingOptions, getPlatformHealth, getPlatformClient, } from './services/search.js';
import { rateLimiter } from './services/rate-limiter.js';
import { cache } from './services/cache.js';
import { snipeReservation, snipeReservationSchema, listScheduledSnipes, listSnipesSchema, cancelSnipe, cancelSnipeSchema, } from './tools/snipe.js';
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
function registerTools(server) {
    server.tool('find_table', 'Find and book a table at a restaurant.', findTableSchema.shape, async (args) => {
        const input = findTableSchema.parse(args);
        const result = await findTable(input.restaurant, input.location, input.date, input.time, input.party_size, input.book);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('search_restaurant', 'Search for a restaurant by name and location.', searchRestaurantSchema.shape, async (args) => {
        const input = searchRestaurantSchema.parse(args);
        const result = await searchRestaurant(input.name, input.location, input.date, input.party_size);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('get_restaurant', 'Look up a restaurant by its platform-specific ID.', getRestaurantSchema.shape, async (args) => {
        const input = getRestaurantSchema.parse(args);
        const result = await getRestaurantById(input.restaurant_id);
        if (result.error || !result.restaurant) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: result.error || 'Restaurant not found' }, null, 2) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.restaurant, null, 2) }] };
    });
    server.tool('get_restaurants', 'Look up multiple restaurants by their IDs.', getRestaurantsSchema.shape, async (args) => {
        const input = getRestaurantsSchema.parse(args);
        const results = await getRestaurantsByIds(input.restaurant_ids);
        const output = results.map((r) => ({ id: r.restaurant?.id, name: r.restaurant?.name, platform: r.platform, found: r.restaurant !== null, error: r.error, details: r.restaurant }));
        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    });
    server.tool('check_availability', 'Get available time slots for a restaurant on a given date.', checkAvailabilitySchema.shape, async (args) => {
        const input = checkAvailabilitySchema.parse(args);
        const result = await checkAvailability(input.restaurant_id, input.date, input.party_size);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('make_reservation', 'Book a reservation.', makeReservationSchema.shape, async (args) => {
        const input = makeReservationSchema.parse(args);
        const parsed = parseRestaurantId(input.restaurant_id);
        if (!parsed) return { content: [{ type: 'text', text: `Invalid restaurant ID: ${input.restaurant_id}` }] };
        const client = getPlatformClient(parsed.platform);
        const params = { restaurantId: input.restaurant_id, platform: parsed.platform, slotId: input.slot_id, date: input.date, partySize: input.party_size };
        const result = await client.makeReservation(params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('get_booking_options', 'Get all ways to book a restaurant.', getBookingOptionsSchema.shape, async (args) => {
        const input = getBookingOptionsSchema.parse(args);
        const options = await getBookingOptions(input.restaurant_id);
        return { content: [{ type: 'text', text: JSON.stringify(options, null, 2) }] };
    });
    server.tool('list_reservations', 'View your upcoming reservations.', listReservationsSchema.shape, async (args) => {
        const input = listReservationsSchema.parse(args);
        const results = [];
        if (input.platform === 'resy' || input.platform === 'all') {
            try {
                const resyReservations = await resyClient.getReservations();
                for (const r of resyReservations) {
                    results.push({ platform: 'resy', reservationId: r.reservationId, restaurantName: r.venue.name, location: r.venue.location, date: r.date, time: r.time, partySize: r.partySize, status: r.status });
                }
            } catch {}
        }
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    });
    server.tool('cancel_reservation', 'Cancel an existing reservation.', cancelReservationSchema.shape, async (args) => {
        const input = cancelReservationSchema.parse(args);
        if (input.platform === 'resy') {
            try {
                await resyClient.cancelReservation(input.reservation_id);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Reservation cancelled successfully' }, null, 2) }] };
            } catch (error) {
                return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: error instanceof Error ? error.message : 'Failed to cancel' }, null, 2) }] };
            }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: `${input.platform} reservations must be cancelled on their website` }, null, 2) }] };
    });
    server.tool('set_credentials', 'Securely store API credentials.', setCredentialsSchema.shape, async (args) => {
        const input = setCredentialsSchema.parse(args);
        const stored = [];
        if (input.platform === 'resy') {
            if (input.api_key) { await setCredential('resy-api-key', input.api_key); stored.push('API key'); }
            if (input.auth_token) { await setCredential('resy-auth-token', input.auth_token); stored.push('auth token'); }
        } else {
            if (input.auth_token) { await setCredential('opentable-token', input.auth_token); stored.push('auth token'); }
        }
        return { content: [{ type: 'text', text: stored.length > 0 ? `Stored ${stored.join(' and ')} for ${input.platform}.` : 'No credentials provided to store.' }] };
    });
    server.tool('set_login', 'Store email/password for automatic token refresh.', setLoginSchema.shape, async (args) => {
        const input = setLoginSchema.parse(args);
        if (input.platform === 'resy') {
            try {
                await resyClient.login(input.email, input.password);
                return { content: [{ type: 'text', text: 'Login successful! Token will auto-refresh when needed.' }] };
            } catch (error) {
                return { content: [{ type: 'text', text: `Login failed: ${error instanceof Error ? error.message : 'Invalid credentials'}` }] };
            }
        }
        return { content: [{ type: 'text', text: 'Only Resy login is currently supported.' }] };
    });
    server.tool('check_auth_status', 'Check if credentials are configured and valid.', checkAuthStatusSchema.shape, async (args) => {
        const input = checkAuthStatusSchema.parse(args);
        const statuses = [];
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
            statuses.push({ platform: 'tock', hasApiKey: false, hasAuthToken: false, hasLogin: false, isValid: true });
        }
        return { content: [{ type: 'text', text: JSON.stringify(statuses, null, 2) }] };
    });
    server.tool('refresh_token', 'Manually refresh authentication token.', refreshTokenSchema.shape, async (args) => {
        const input = refreshTokenSchema.parse(args);
        if (input.platform === 'resy') {
            const email = await getCredential('resy-email');
            const password = await getCredential('resy-password');
            if (!email || !password) return { content: [{ type: 'text', text: 'No login credentials stored. Use set_login first.' }] };
            try {
                await resyClient.login(email, password);
                return { content: [{ type: 'text', text: 'Token refreshed successfully!' }] };
            } catch (error) {
                return { content: [{ type: 'text', text: `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}` }] };
            }
        }
        return { content: [{ type: 'text', text: 'Only Resy token refresh is supported.' }] };
    });
    server.tool('snipe_reservation', 'Schedule an automatic booking attempt.', snipeReservationSchema.shape, async (args) => {
        const input = snipeReservationSchema.parse(args);
        const result = await snipeReservation(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('list_snipes', 'View all scheduled snipe attempts.', listSnipesSchema.shape, async (args) => {
        const input = listSnipesSchema.parse(args);
        const results = await listScheduledSnipes(input);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    });
    server.tool('cancel_snipe', 'Cancel a scheduled snipe attempt.', cancelSnipeSchema.shape, async (args) => {
        const input = cancelSnipeSchema.parse(args);
        const result = await cancelSnipe(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('get_platform_status', 'Check health and rate limit status of all platforms.', {}, async () => {
        const health = await getPlatformHealth();
        const rateLimits = rateLimiter.getAllStatus();
        const cacheStats = cache.stats();
        const status = { platforms: Object.entries(health).map(([platform, available]) => ({ platform, available, rateLimit: rateLimits.find((r) => r.platform === platform) })), cache: cacheStats };
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    });
}
// Create single MCP server instance (stateless, matches working schwab pattern)
const mcpServer = new McpServer({ name: 'restaurant-reservations', version: '2.0.0' });
registerTools(mcpServer);
// Stateless HTTP transport — single shared instance (Poke-compatible)
const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
});
// Connect once at startup
(async () => {
    await mcpServer.connect(httpTransport);
    console.log('[MCP] HTTP transport connected');
})();
// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);
const MCP_API_KEY = process.env.MCP_API_KEY || '';
const app = express();
// CORS middleware for Poke
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
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
// API key auth
function requireApiKey(req, res, next) {
    if (!MCP_API_KEY) return next();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== MCP_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized - invalid or missing API key' });
    }
    next();
}
// Handle all MCP requests via POST /mcp
app.post('/mcp', requireApiKey, async (req, res) => {
    try {
        await httpTransport.handleRequest(req, res, req.body);
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'MCP request failed' });
        }
    }
});
// Handle GET /mcp for SSE streaming
app.get('/mcp', requireApiKey, async (req, res) => {
    try {
        await httpTransport.handleRequest(req, res);
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'MCP request failed' });
        }
    }
});
async function main() {
    await startScheduler();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Restaurant MCP server running on port ${PORT}`);
        console.log(`MCP: http://localhost:${PORT}/mcp`);
    });
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

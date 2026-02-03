import express from 'express';
import { z } from 'zod';
import { resyClient } from './resy-client.js';
import { openTableClient } from './opentable-client.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.API_KEY || '';

// Auth middleware
function auth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
}

app.use('/api', auth);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Search restaurants
const searchSchema = z.object({
  query: z.string().min(1),
  location: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  partySize: z.number().int().min(1).max(20).default(2),
  platform: z.enum(['resy', 'opentable', 'both']).default('both'),
});

app.post('/api/search', async (req, res) => {
  try {
    const input = searchSchema.parse(req.body);
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
    res.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Search failed' });
  }
});

// Check availability
const availabilitySchema = z.object({
  restaurantId: z.string().min(1),
  platform: z.enum(['resy', 'opentable']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.number().int().min(1).max(20),
});

app.post('/api/availability', async (req, res) => {
  try {
    const input = availabilitySchema.parse(req.body);
    const numericId = parseInt(input.restaurantId.replace(/^(resy|opentable)-/, ''), 10);

    if (input.platform === 'resy') {
      const slots = await resyClient.getAvailability(numericId, input.date, input.partySize);
      res.json({ platform: 'resy', slots });
    } else {
      const slots = await openTableClient.getAvailability(numericId, input.date, input.partySize);
      res.json({ platform: 'opentable', slots });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// Make reservation (Resy only - OpenTable returns booking URL)
const reserveSchema = z.object({
  restaurantId: z.string().min(1),
  platform: z.enum(['resy', 'opentable']),
  slotId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.number().int().min(1).max(20),
});

app.post('/api/reserve', async (req, res) => {
  try {
    const input = reserveSchema.parse(req.body);

    if (input.platform === 'opentable') {
      const numericId = parseInt(input.restaurantId.replace(/^opentable-/, ''), 10);
      const bookingUrl = `https://www.opentable.com/booking/experiences-availability?rid=${numericId}&datetime=${input.date}T${input.slotId}&covers=${input.partySize}`;
      res.json({ success: true, platform: 'opentable', bookingUrl, message: 'Complete booking at URL' });
      return;
    }

    const details = await resyClient.getBookingDetails(input.slotId, input.date, input.partySize);
    const result = await resyClient.makeReservation(details.bookToken, details.paymentMethodId);
    res.json({ success: true, platform: 'resy', reservationId: result.reservationId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Reservation failed', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// List reservations
app.get('/api/reservations', async (_req, res) => {
  try {
    const reservations = await resyClient.getReservations();
    res.json({ reservations });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list reservations' });
  }
});

// Cancel reservation
const cancelSchema = z.object({
  reservationId: z.string().min(1),
});

app.post('/api/cancel', async (req, res) => {
  try {
    const input = cancelSchema.parse(req.body);
    await resyClient.cancelReservation(input.reservationId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Cancel failed' });
  }
});

// Auth status
app.get('/api/auth/status', async (_req, res) => {
  try {
    await resyClient.ensureAuth();
    res.json({ authenticated: true });
  } catch (error) {
    res.json({ authenticated: false, error: error instanceof Error ? error.message : 'Unknown' });
  }
});

async function main() {
  console.log('[Server] Starting Restaurant Reservation API...');

  try {
    await resyClient.ensureAuth();
    console.log('[Server] Resy authentication successful');
  } catch (error) {
    console.error('[Server] Resy auth failed:', error instanceof Error ? error.message : error);
  }

  app.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
    console.log('[Server] Endpoints:');
    console.log('  POST /api/search - Search restaurants');
    console.log('  POST /api/availability - Check availability');
    console.log('  POST /api/reserve - Make reservation');
    console.log('  GET  /api/reservations - List reservations');
    console.log('  POST /api/cancel - Cancel reservation');
  });
}

main().catch(console.error);

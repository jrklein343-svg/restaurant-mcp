import express from 'express';
import { z } from 'zod';
import { createSnipe, listSnipes, getSnipe, updateSnipe, deleteSnipe } from './store.js';
import { scheduleSnipe, cancelSnipe, isSnipeScheduled, loadPendingSnipes } from './sniper.js';
import { resyClient } from './resy-client.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.API_KEY || '';

// Simple API key auth middleware
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
}

app.use('/api', authMiddleware);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create snipe schema
const createSnipeSchema = z.object({
  restaurantId: z.number().int().positive(),
  restaurantName: z.string().min(1),
  platform: z.enum(['resy', 'opentable']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.number().int().min(1).max(20),
  preferredTimes: z.array(z.string()).min(1).max(10),
  releaseTime: z.string(), // ISO 8601 datetime
});

// Create a new snipe
app.post('/api/snipes', async (req, res) => {
  try {
    const input = createSnipeSchema.parse(req.body);

    const releaseDate = new Date(input.releaseTime);
    if (releaseDate.getTime() < Date.now()) {
      res.status(400).json({ error: 'Release time must be in the future' });
      return;
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

    res.status(201).json({
      success: true,
      snipe: {
        ...snipe,
        platform: input.platform,
        isScheduled: true,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('[API] Create snipe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all snipes
app.get('/api/snipes', async (_req, res) => {
  try {
    const snipes = await listSnipes();
    res.json({
      snipes: snipes.map(s => ({
        ...s,
        isScheduled: isSnipeScheduled(s.id),
      })),
    });
  } catch (error) {
    console.error('[API] List snipes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single snipe
app.get('/api/snipes/:id', async (req, res) => {
  try {
    const snipe = await getSnipe(req.params.id);
    if (!snipe) {
      res.status(404).json({ error: 'Snipe not found' });
      return;
    }
    res.json({
      ...snipe,
      isScheduled: isSnipeScheduled(snipe.id),
    });
  } catch (error) {
    console.error('[API] Get snipe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel a snipe
app.delete('/api/snipes/:id', async (req, res) => {
  try {
    const snipe = await getSnipe(req.params.id);
    if (!snipe) {
      res.status(404).json({ error: 'Snipe not found' });
      return;
    }

    if (snipe.status !== 'pending') {
      res.status(400).json({ error: `Cannot cancel snipe with status: ${snipe.status}` });
      return;
    }

    cancelSnipe(req.params.id);
    await updateSnipe(req.params.id, 'cancelled');
    await deleteSnipe(req.params.id);

    res.json({ success: true, message: 'Snipe cancelled' });
  } catch (error) {
    console.error('[API] Cancel snipe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check Resy auth status
app.get('/api/auth/status', async (_req, res) => {
  try {
    await resyClient.ensureAuth();
    res.json({ authenticated: true });
  } catch (error) {
    res.json({
      authenticated: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start server
async function main() {
  console.log('[Server] Starting Restaurant Sniper Service...');

  // Verify Resy credentials on startup
  try {
    await resyClient.ensureAuth();
    console.log('[Server] Resy authentication successful');
  } catch (error) {
    console.error('[Server] Resy authentication failed:', error instanceof Error ? error.message : error);
    console.error('[Server] Set RESY_EMAIL and RESY_PASSWORD environment variables');
  }

  // Load pending snipes from database
  await loadPendingSnipes();

  app.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
    console.log('[Server] Endpoints:');
    console.log('  GET  /health - Health check');
    console.log('  POST /api/snipes - Create snipe');
    console.log('  GET  /api/snipes - List snipes');
    console.log('  GET  /api/snipes/:id - Get snipe');
    console.log('  DELETE /api/snipes/:id - Cancel snipe');
    console.log('  GET  /api/auth/status - Check Resy auth');
  });
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});

import initSqlJs, { Database } from 'sql.js';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface Snipe {
  id: string;
  restaurantId: number;
  restaurantName: string;
  date: string;
  partySize: number;
  preferredTimes: string[];
  releaseTime: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  createdAt: string;
  result?: string;
}

// Use /tmp for Render free tier (ephemeral storage)
const DATA_DIR = '/tmp/sniper-data';
const DB_PATH = join(DATA_DIR, 'snipes.db');

let db: Database | null = null;
let dbInitPromise: Promise<void> | null = null;

async function ensureDb(): Promise<Database> {
  if (db) return db;

  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });

      const SQL = await initSqlJs();

      try {
        const fileBuffer = await fs.readFile(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('[DB] Loaded existing database');
      } catch {
        db = new SQL.Database();
        console.log('[DB] Created new database');
      }

      db.run(`
        CREATE TABLE IF NOT EXISTS snipes (
          id TEXT PRIMARY KEY,
          restaurant_id INTEGER NOT NULL,
          restaurant_name TEXT NOT NULL,
          date TEXT NOT NULL,
          party_size INTEGER NOT NULL,
          preferred_times TEXT NOT NULL,
          release_time TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          result TEXT
        )
      `);

      await saveDb();
    })();
  }

  await dbInitPromise;
  return db!;
}

async function saveDb(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  await fs.writeFile(DB_PATH, buffer);
}

export async function createSnipe(config: Omit<Snipe, 'id' | 'createdAt' | 'status'>): Promise<Snipe> {
  const database = await ensureDb();
  const id = `snipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  database.run(
    `INSERT INTO snipes (id, restaurant_id, restaurant_name, date, party_size, preferred_times, release_time, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, config.restaurantId, config.restaurantName, config.date, config.partySize,
     JSON.stringify(config.preferredTimes), config.releaseTime, createdAt]
  );

  await saveDb();

  return { id, ...config, status: 'pending', createdAt };
}

export async function getSnipe(id: string): Promise<Snipe | null> {
  const database = await ensureDb();
  const stmt = database.prepare('SELECT * FROM snipes WHERE id = ?');
  stmt.bind([id]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();

  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as number,
    restaurantName: row.restaurant_name as string,
    date: row.date as string,
    partySize: row.party_size as number,
    preferredTimes: JSON.parse(row.preferred_times as string),
    releaseTime: row.release_time as string,
    status: row.status as Snipe['status'],
    createdAt: row.created_at as string,
    result: (row.result as string) || undefined,
  };
}

export async function listSnipes(status?: Snipe['status']): Promise<Snipe[]> {
  const database = await ensureDb();

  let query = 'SELECT * FROM snipes';
  const params: string[] = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY release_time ASC';

  const results: Snipe[] = [];
  const stmt = database.prepare(query);
  if (params.length) stmt.bind(params);

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push({
      id: row.id as string,
      restaurantId: row.restaurant_id as number,
      restaurantName: row.restaurant_name as string,
      date: row.date as string,
      partySize: row.party_size as number,
      preferredTimes: JSON.parse(row.preferred_times as string),
      releaseTime: row.release_time as string,
      status: row.status as Snipe['status'],
      createdAt: row.created_at as string,
      result: (row.result as string) || undefined,
    });
  }

  stmt.free();
  return results;
}

export async function updateSnipe(id: string, status: Snipe['status'], result?: string): Promise<void> {
  const database = await ensureDb();
  database.run('UPDATE snipes SET status = ?, result = ? WHERE id = ?', [status, result || null, id]);
  await saveDb();
}

export async function deleteSnipe(id: string): Promise<boolean> {
  const database = await ensureDb();
  database.run('DELETE FROM snipes WHERE id = ?', [id]);
  await saveDb();
  return database.getRowsModified() > 0;
}

export async function getPendingSnipes(): Promise<Snipe[]> {
  return listSnipes('pending');
}

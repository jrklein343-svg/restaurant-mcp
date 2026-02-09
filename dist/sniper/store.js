import initSqlJs from 'sql.js';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
const DB_DIR = join(homedir(), '.restaurant-mcp');
const DB_PATH = join(DB_DIR, 'snipes.db');
let db = null;
let dbInitPromise = null;
async function ensureDb() {
    if (db)
        return db;
    if (!dbInitPromise) {
        dbInitPromise = (async () => {
            await fs.mkdir(DB_DIR, { recursive: true });
            const SQL = await initSqlJs();
            try {
                const fileBuffer = await fs.readFile(DB_PATH);
                db = new SQL.Database(fileBuffer);
            }
            catch {
                db = new SQL.Database();
            }
            db.run(`
        CREATE TABLE IF NOT EXISTS snipes (
          id TEXT PRIMARY KEY,
          restaurant_id TEXT NOT NULL,
          platform TEXT NOT NULL,
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
    return db;
}
async function saveDb() {
    if (!db)
        return;
    const data = db.export();
    const buffer = Buffer.from(data);
    await fs.writeFile(DB_PATH, buffer);
}
export async function createSnipe(config) {
    const database = await ensureDb();
    const id = `snipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    database.run(`INSERT INTO snipes (id, restaurant_id, platform, date, party_size, preferred_times, release_time, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`, [id, config.restaurantId, config.platform, config.date, config.partySize,
        JSON.stringify(config.preferredTimes), config.releaseTime, createdAt]);
    await saveDb();
    return {
        id,
        ...config,
        status: 'pending',
        createdAt,
    };
}
export async function getSnipe(id) {
    const database = await ensureDb();
    const stmt = database.prepare('SELECT * FROM snipes WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) {
        stmt.free();
        return null;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return {
        id: row.id,
        restaurantId: row.restaurant_id,
        platform: row.platform,
        date: row.date,
        partySize: row.party_size,
        preferredTimes: JSON.parse(row.preferred_times),
        releaseTime: row.release_time,
        status: row.status,
        createdAt: row.created_at,
        result: row.result || undefined,
    };
}
export async function listSnipes(status) {
    const database = await ensureDb();
    let query = 'SELECT * FROM snipes';
    const params = [];
    if (status) {
        query += ' WHERE status = ?';
        params.push(status);
    }
    query += ' ORDER BY release_time ASC';
    const results = [];
    const stmt = database.prepare(query);
    if (params.length)
        stmt.bind(params);
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            id: row.id,
            restaurantId: row.restaurant_id,
            platform: row.platform,
            date: row.date,
            partySize: row.party_size,
            preferredTimes: JSON.parse(row.preferred_times),
            releaseTime: row.release_time,
            status: row.status,
            createdAt: row.created_at,
            result: row.result || undefined,
        });
    }
    stmt.free();
    return results;
}
export async function updateSnipeStatus(id, status, result) {
    const database = await ensureDb();
    database.run('UPDATE snipes SET status = ?, result = ? WHERE id = ?', [status, result || null, id]);
    await saveDb();
}
export async function deleteSnipe(id) {
    const database = await ensureDb();
    database.run('DELETE FROM snipes WHERE id = ?', [id]);
    await saveDb();
    return database.getRowsModified() > 0;
}
export async function getPendingSnipes() {
    return listSnipes('pending');
}
export async function closeDb() {
    if (db) {
        await saveDb();
        db.close();
        db = null;
        dbInitPromise = null;
    }
}

import * as SQLite from 'expo-sqlite';
import type {
  Duration, IntakeEntry, Location, Meal, PainEntry, PainType, Recommendation,
} from './types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function open(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('mitte.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS pain_entry (
          id INTEGER PRIMARY KEY NOT NULL,
          timestamp INTEGER NOT NULL,
          locations TEXT NOT NULL,
          types TEXT NOT NULL,
          vas INTEGER NOT NULL,
          duration TEXT,
          note TEXT
        );
        CREATE TABLE IF NOT EXISTS intake_entry (
          id INTEGER PRIMARY KEY NOT NULL,
          timestamp INTEGER NOT NULL,
          meal TEXT NOT NULL,
          kind TEXT NOT NULL,
          category TEXT NOT NULL,
          amount INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS recommendation (
          id INTEGER PRIMARY KEY NOT NULL,
          date TEXT NOT NULL,
          ruleId TEXT NOT NULL,
          text TEXT NOT NULL,
          done INTEGER NOT NULL DEFAULT 0,
          UNIQUE(date, ruleId)
        );
        CREATE TABLE IF NOT EXISTS custom_tile (
          id INTEGER PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          label TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pain_ts ON pain_entry(timestamp);
        CREATE INDEX IF NOT EXISTS idx_intake_ts ON intake_entry(timestamp);
      `);
      return db;
    });
  }
  return dbPromise;
}

type PainRow = {
  id: number; timestamp: number; locations: string; types: string;
  vas: number; duration: string | null; note: string | null;
};

function toPain(r: PainRow): PainEntry {
  return {
    id: r.id,
    timestamp: r.timestamp,
    locations: JSON.parse(r.locations) as Location[],
    types: JSON.parse(r.types) as PainType[],
    vas: r.vas,
    duration: (r.duration as Duration | null) ?? null,
    note: r.note,
  };
}

export async function addPainEntry(e: Omit<PainEntry, 'id'>): Promise<number> {
  const db = await open();
  const res = await db.runAsync(
    'INSERT INTO pain_entry (timestamp, locations, types, vas, duration, note) VALUES (?, ?, ?, ?, ?, ?)',
    e.timestamp, JSON.stringify(e.locations), JSON.stringify(e.types), e.vas, e.duration, e.note,
  );
  return res.lastInsertRowId;
}

export async function updatePainEntry(e: PainEntry): Promise<void> {
  const db = await open();
  await db.runAsync(
    'UPDATE pain_entry SET timestamp = ?, locations = ?, types = ?, vas = ?, duration = ?, note = ? WHERE id = ?',
    e.timestamp, JSON.stringify(e.locations), JSON.stringify(e.types), e.vas, e.duration, e.note, e.id,
  );
}

export async function deletePainEntry(id: number): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM pain_entry WHERE id = ?', id);
}

export async function getPainEntry(id: number): Promise<PainEntry | null> {
  const db = await open();
  const row = await db.getFirstAsync<PainRow>('SELECT * FROM pain_entry WHERE id = ?', id);
  return row ? toPain(row) : null;
}

export async function painEntriesBetween(from: number, to: number): Promise<PainEntry[]> {
  const db = await open();
  const rows = await db.getAllAsync<PainRow>(
    'SELECT * FROM pain_entry WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp DESC',
    from, to,
  );
  return rows.map(toPain);
}

export async function lastPainEntry(): Promise<PainEntry | null> {
  const db = await open();
  const row = await db.getFirstAsync<PainRow>('SELECT * FROM pain_entry ORDER BY timestamp DESC LIMIT 1');
  return row ? toPain(row) : null;
}

export async function addIntake(e: Omit<IntakeEntry, 'id'>): Promise<number> {
  const db = await open();
  const res = await db.runAsync(
    'INSERT INTO intake_entry (timestamp, meal, kind, category, amount) VALUES (?, ?, ?, ?, ?)',
    e.timestamp, e.meal, e.kind, e.category, e.amount,
  );
  return res.lastInsertRowId;
}

export async function deleteIntake(id: number): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM intake_entry WHERE id = ?', id);
}

export async function intakeBetween(from: number, to: number): Promise<IntakeEntry[]> {
  const db = await open();
  const rows = await db.getAllAsync<IntakeEntry & { meal: Meal }>(
    'SELECT * FROM intake_entry WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp DESC',
    from, to,
  );
  return rows;
}

export async function saveRecommendations(
  date: string, items: { ruleId: string; text: string }[],
): Promise<void> {
  const db = await open();
  for (const it of items) {
    await db.runAsync(
      'INSERT OR IGNORE INTO recommendation (date, ruleId, text, done) VALUES (?, ?, ?, 0)',
      date, it.ruleId, it.text,
    );
  }
}

export async function recommendationsFor(date: string): Promise<Recommendation[]> {
  const db = await open();
  const rows = await db.getAllAsync<Omit<Recommendation, 'done'> & { done: number }>(
    'SELECT * FROM recommendation WHERE date = ? ORDER BY id', date,
  );
  return rows.map((r) => ({ ...r, done: r.done === 1 }));
}

export async function setRecommendationDone(id: number, done: boolean): Promise<void> {
  const db = await open();
  await db.runAsync('UPDATE recommendation SET done = ? WHERE id = ?', done ? 1 : 0, id);
}

export async function customTiles(kind: 'food' | 'drink'): Promise<{ id: number; label: string }[]> {
  const db = await open();
  return db.getAllAsync<{ id: number; label: string }>(
    'SELECT id, label FROM custom_tile WHERE kind = ? ORDER BY label', kind,
  );
}

export async function addCustomTile(kind: 'food' | 'drink', label: string): Promise<void> {
  const db = await open();
  await db.runAsync('INSERT INTO custom_tile (kind, label) VALUES (?, ?)', kind, label);
}

export async function deleteCustomTile(id: number): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM custom_tile WHERE id = ?', id);
}

/** Loescht alle Daten - fuer die DSGVO-Loeschfunktion im Profil. */
export async function wipeAllData(): Promise<void> {
  const db = await open();
  await db.execAsync(
    'DELETE FROM pain_entry; DELETE FROM intake_entry; DELETE FROM recommendation; DELETE FROM custom_tile;',
  );
}

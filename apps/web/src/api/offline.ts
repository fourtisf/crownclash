/**
 * IndexedDB cache + offline write queue.
 *
 * Handoff §7 forbids localStorage and permits IndexedDB "for offline cache" — the emphasis
 * matters. Nothing here is authoritative: it holds the device id, the last save the server
 * sent, and intents that failed to send. On reconnect the queue is replayed and the server's
 * response overwrites the cache.
 *
 * Everything degrades to an in-memory map when IndexedDB is unavailable (private-mode
 * Safari, hardened browsers) so the game still runs for one session.
 */
const DB_NAME = 'crownclash';
const STORE = 'kv';
const memory = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Never let a hung IndexedDB stall boot.
    setTimeout(() => resolve(null), 2000);
  });
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return (memory.get(key) as T) ?? null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      if (value === null) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* --------------------------------------------------------------- write queue */

const QUEUE_KEY = 'crownclash:queue';

export interface QueuedIntent {
  id: string;
  kind: 'match' | 'profile';
  payload: unknown;
  at: number;
}

export async function queueIntent(kind: QueuedIntent['kind'], payload: unknown): Promise<void> {
  const q = (await idbGet<QueuedIntent[]>(QUEUE_KEY)) || [];
  q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, payload, at: Date.now() });
  // Bounded: an offline player who plays 50 matches gets their oldest intents dropped
  // rather than an unbounded store that can never be flushed.
  await idbSet(QUEUE_KEY, q.slice(-25));
}

export async function drainQueue(send: (i: QueuedIntent) => Promise<void>): Promise<number> {
  const q = (await idbGet<QueuedIntent[]>(QUEUE_KEY)) || [];
  if (!q.length) return 0;
  const remaining: QueuedIntent[] = [];
  let sent = 0;
  for (const intent of q) {
    try {
      await send(intent);
      sent++;
    } catch {
      remaining.push(intent);
    }
  }
  await idbSet(QUEUE_KEY, remaining);
  return sent;
}

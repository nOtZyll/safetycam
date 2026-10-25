// Violation log kept in IndexedDB so it survives a refresh or a closed tab.
// When IndexedDB is unavailable (private window, blocked site data) every call still resolves
// and the log simply lives in memory for this page.

const DB_NAME = 'safetycam';
const STORE = 'violations';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export class LogStore {
  constructor() {
    this.db = (typeof indexedDB === 'undefined' ? Promise.reject() : openDB()).catch(() => null);
  }

  /** All entries, newest first. */
  async all() {
    const db = await this.db;
    if (!db) return [];
    try {
      const rows = await run(db, 'readonly', (s) => s.getAll());
      return rows.sort((a, b) => b.time - a.time);
    } catch {
      return [];
    }
  }

  /** Store an entry; sets entry.key when it was saved. */
  async add(entry) {
    const db = await this.db;
    if (!db) return;
    try {
      entry.key = await run(db, 'readwrite', (s) => s.add(entry));
    } catch { /* keep it in memory only */ }
  }

  async remove(entries) {
    const db = await this.db;
    const keys = entries.map((e) => e.key).filter((k) => k !== undefined);
    if (!db || !keys.length) return;
    try {
      await run(db, 'readwrite', (s) => keys.forEach((k) => s.delete(k)));
    } catch { /* ignore */ }
  }

  async clear() {
    const db = await this.db;
    if (!db) return;
    try {
      await run(db, 'readwrite', (s) => s.clear());
    } catch { /* ignore */ }
  }
}

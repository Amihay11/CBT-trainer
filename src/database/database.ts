/**
 * Database bootstrap — the encrypted Offline-First Source of Truth.
 *
 * Because the SQLCipher passphrase is fetched asynchronously from secure hardware, the
 * `Database` cannot be constructed at module-eval time. `initializeDatabase()` performs the
 * async mount exactly once (idempotent singleton) and the app gates its UI on the returned
 * instance (see `App.tsx`). This guarantees no query ever runs against an unencrypted store.
 */
import { Database } from '@nozbe/watermelondb';

import { createEncryptedAdapter } from './adapter';
import { ClinicalTask } from './models/ClinicalTask';
import { ThoughtRecord } from './models/ThoughtRecord';
import { User } from './models/User';
import type { KeyProvider } from '../security/encryptionKey';

let databaseSingleton: Database | null = null;
let initializationInFlight: Promise<Database> | null = null;

/**
 * Mounts the encrypted database exactly once. Concurrent callers share a single in-flight
 * promise so a race (e.g. UI + background sync starting together) cannot open two handles.
 *
 * @param provider optional key provider override (used by tests).
 */
export async function initializeDatabase(provider?: KeyProvider): Promise<Database> {
  if (databaseSingleton) return databaseSingleton;
  if (initializationInFlight) return initializationInFlight;

  initializationInFlight = (async () => {
    const adapter = await createEncryptedAdapter(provider);
    const database = new Database({
      adapter,
      modelClasses: [User, ThoughtRecord, ClinicalTask],
    });
    databaseSingleton = database;
    return database;
  })();

  try {
    return await initializationInFlight;
  } finally {
    initializationInFlight = null;
  }
}

/**
 * Returns the already-initialized database or throws. Use in non-async call sites (e.g. the
 * XState save actor) that are only reachable after `initializeDatabase()` has resolved.
 */
export function getDatabase(): Database {
  if (!databaseSingleton) {
    throw new Error('Database accessed before initializeDatabase() resolved. Gate UI on init.');
  }
  return databaseSingleton;
}

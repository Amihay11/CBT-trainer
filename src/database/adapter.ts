/**
 * SQLite / SQLCipher Adapter Factory
 * ==================================
 *
 * This is the single integration point where the AES-256 passphrase (owned by the
 * `KeyProvider`) is handed to the native SQLite engine so that the *entire* WatermelonDB
 * file is transparently encrypted at rest — the technical control demanded by HIPAA
 * §164.312 and Israeli Amendment 13 High-security classification.
 *
 * IMPORTANT — Native build requirement:
 * WatermelonDB's default `SQLiteAdapter` links against the system SQLite, which is NOT
 * compiled with the SQLCipher extension. To honor encryption you must build the Dev Client
 * against a SQLCipher-enabled SQLite. Two supported paths:
 *   1. `@nozbe/watermelondb` JSI adapter + a SQLCipher pod/AAR override (see README).
 *   2. A community SQLCipher build of the adapter that accepts a `passphrase` option.
 * Either way, the passphrase plumbing below is identical; only the native link differs.
 * This file therefore centralizes the key handoff so the rest of the app is agnostic to it.
 */
import { Platform } from 'react-native';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import type { SQLiteAdapterOptions } from '@nozbe/watermelondb/adapters/sqlite/type';

import { keyProvider, type KeyProvider } from '../security/encryptionKey';
import { migrations } from './migrations';
import { schema } from './schema';

/** Logical database file name. The `.db` file lives in the app sandbox, fully encrypted. */
const DATABASE_NAME = 'cbt_trainer.db';

/**
 * Builds a SQLCipher-enabled adapter. The passphrase is fetched from secure hardware and
 * passed to the native layer; it is never written to JS-accessible storage or logs.
 *
 * @param provider  Key source (Dependency Inversion — defaults to the process key provider,
 *                   overridable in tests with an in-memory fake).
 */
export async function createEncryptedAdapter(
  provider: KeyProvider = keyProvider,
): Promise<SQLiteAdapter> {
  const passphrase = await provider.getOrCreateDatabaseKey();

  /**
   * `passphrase` is consumed by the SQLCipher-linked native adapter (`PRAGMA key = ...`).
   * It is intentionally NOT part of WatermelonDB's public `SQLiteAdapterOptions` type, so we
   * extend the options object in a single, audited place rather than scattering `any` casts.
   */
  const options: SQLiteAdapterOptions & { passphrase: string } = {
    schema,
    migrations,
    dbName: DATABASE_NAME,
    // JSI unlocks synchronous, sub-millisecond reads on the UI thread (the Offline-First
    // "zero-latency" promise). Falls back to the async bridge where JSI is unavailable.
    jsi: Platform.OS === 'ios' || Platform.OS === 'android',
    passphrase,
    onSetUpError: (error: Error) => {
      // A setup failure most often means schema corruption or a wrong passphrase. We must
      // NOT silently recreate the DB (that would destroy the patient's offline records);
      // surface it so the app can trigger a supervised recovery flow.
      console.error('[db] SQLCipher adapter setup failed', error);
    },
  };

  return new SQLiteAdapter(options);
}

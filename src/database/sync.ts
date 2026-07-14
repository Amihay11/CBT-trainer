/**
 * Delta-Sync Loop — Pull → Apply → Push
 * =====================================
 *
 * The reconciliation half of the Offline-First architecture. The device is authoritative for
 * locally-created data; the cloud (a FHIR R4 backend) is authoritative for clinician-authored
 * data. WatermelonDB's `synchronize()` orchestrates the three phases against a `lastPulledAt`
 * high-water mark so only the *delta* crosses the network:
 *
 *   1. PULL  — request { changes, timestamp } for everything modified server-side since
 *              `lastPulledAt`. First sync (`lastPulledAt === null`) is a full snapshot.
 *   2. APPLY — WatermelonDB merges server changes into the local DB and resolves conflicts.
 *              Deletes are tombstones; local soft-deletes are reconciled here.
 *   3. PUSH  — send locally-dirty rows (created/updated/deleted) up. The server MUST treat
 *              these idempotently (keyed by the client-generated id / `server_id`) so a
 *              retry after a mid-flight disconnect never double-applies a write.
 *
 * Idempotency contract: a push can be committed server-side while its ack is lost in transit,
 * so the client may resend. The FHIR endpoint therefore upserts on a stable key rather than
 * blindly inserting. This is what makes sync safe over unreliable mobile links.
 */
import {
  synchronize,
  type SyncDatabaseChangeSet,
  type SyncPullArgs,
  type SyncPushArgs,
} from '@nozbe/watermelondb/sync';

import { getDatabase } from './database';

/** Server response for the Pull phase. */
export interface PullResponse {
  readonly changes: SyncDatabaseChangeSet;
  readonly timestamp: number;
}

/** Injected transport so the endpoint is configurable per environment and mockable in tests. */
export interface SyncTransport {
  /** Fetch server-side changes newer than `lastPulledAt` (null on first sync). */
  pull(args: SyncPullArgs): Promise<PullResponse>;
  /** Upload locally-dirty changes. Must resolve only on durable, idempotent server commit. */
  push(args: SyncPushArgs): Promise<void>;
}

export interface SyncResult {
  readonly ok: boolean;
  readonly error?: unknown;
}

/**
 * Runs one full Delta-Sync cycle. Never throws: a failed sync is a normal offline condition,
 * so the result is returned as data and the caller decides on backoff/retry scheduling.
 */
export async function runDeltaSync(transport: SyncTransport): Promise<SyncResult> {
  const database = getDatabase();

  try {
    await synchronize({
      database,
      // ---- PULL ------------------------------------------------------------------------
      pullChanges: (args) => transport.pull(args),
      // ---- PUSH ------------------------------------------------------------------------
      pushChanges: (args) => transport.push(args),
      // Treat locally-created rows as updates on the server, hardening against clock skew
      // where the server may already hold a row the client believes it just created.
      sendCreatedAsUpdated: true,
    });

    return { ok: true };
  } catch (error) {
    console.warn('[sync] delta cycle failed; will retry on next connectivity signal', error);
    return { ok: false, error };
  }
}

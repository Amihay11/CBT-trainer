/**
 * WatermelonDB Schema — Offline-First Source of Truth
 * ===================================================
 *
 * Architectural stance: the on-device SQLite (SQLCipher-encrypted) database is the
 * *Source of Truth*. The UI reads/writes locally first (optimistic, sub-millisecond),
 * and a background Delta-Sync loop reconciles with the FHIR cloud (see `sync.ts`).
 *
 * Every table carries the Offline-First control columns:
 *  - `server_id`      : nullable server-assigned id. Absent until first successful push.
 *                       Used for idempotent upserts (the Push half of the Delta-Sync loop).
 *  - `sync_status`    : 'created' | 'updated' | 'deleted' | 'synced'. Drives which local
 *                       rows are dirty and must be pushed. 'deleted' is a SOFT delete —
 *                       the row is retained until the server acknowledges the tombstone,
 *                       preventing data loss on flaky connections.
 *  - `created_at` /   : client-generated epoch millis. `updated_at` is the high-water mark
 *    `updated_at`       compared against `lastPulledAt` during Pull.
 *
 * Note: WatermelonDB always maintains its own primary key `id` (a client-generated string),
 * which is what makes writes possible fully offline without server round-trips.
 */
import { appSchema, tableSchema } from '@nozbe/watermelondb';

/** Canonical table names, exported so models and queries never stringly-type table access. */
export const TableName = {
  USERS: 'users',
  THOUGHT_RECORDS: 'thought_records',
  CLINICAL_TASKS: 'clinical_tasks',
} as const;

export type TableNameValue = (typeof TableName)[keyof typeof TableName];

/**
 * Sync status lifecycle for a locally-persisted row.
 * `synced` rows are clean; the other three are dirty and eligible for Push.
 */
export const SyncStatus = {
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  SYNCED: 'synced',
} as const;

export type SyncStatusValue = (typeof SyncStatus)[keyof typeof SyncStatus];

/**
 * Schema version. Increment on ANY column/table change and ship a matching migration in
 * `migrations.ts`; WatermelonDB refuses to open a DB whose stored version is unknown.
 */
export const SCHEMA_VERSION = 1;

export const schema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    /**
     * users — the patient/account row.
     * `encrypted_meta` holds an application-layer-encrypted JSON blob of *non-queryable*
     * sensitive attributes (biometric templates, demographics, psychiatric history flags).
     * Storing them pre-encrypted means they are protected even from a query that dumps the
     * table, and they are never used in a WHERE clause (defense in depth over SQLCipher).
     */
    tableSchema({
      name: TableName.USERS,
      columns: [
        { name: 'server_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'display_name', type: 'string' },
        { name: 'locale', type: 'string' },
        { name: 'encrypted_meta', type: 'string', isOptional: true },
        { name: 'sync_status', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    /**
     * thought_records — the CBT ABC-model artifact produced by `thoughtRecordMachine`.
     * `distortion_tags` is a JSON-encoded string array of cognitive-distortion identifiers
     * (kept denormalized for offline simplicity; a join table is a valid future migration).
     * `emotion_intensity` is the 0–100 SUDS-style rating captured before restructuring.
     */
    tableSchema({
      name: TableName.THOUGHT_RECORDS,
      columns: [
        { name: 'server_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'situation', type: 'string' },
        { name: 'emotion', type: 'string' },
        { name: 'emotion_intensity', type: 'number' },
        { name: 'automatic_thought', type: 'string' },
        { name: 'distortion_tags', type: 'string' },
        { name: 'balanced_thought', type: 'string', isOptional: true },
        { name: 'recorded_at', type: 'number', isIndexed: true },
        { name: 'sync_status', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    /**
     * clinical_tasks — Behavioral Activation / homework assignments and their completion.
     * `task_type` is a clinician-defined protocol code; `completion_status` tracks progress.
     * `due_date` drives the personalized reminder engine (COM-B / Fogg trigger scheduling).
     */
    tableSchema({
      name: TableName.CLINICAL_TASKS,
      columns: [
        { name: 'server_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'task_type', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'completion_status', type: 'string', isIndexed: true },
        { name: 'due_date', type: 'number', isOptional: true, isIndexed: true },
        { name: 'sync_status', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});

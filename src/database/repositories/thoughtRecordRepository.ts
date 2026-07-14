/**
 * ThoughtRecord repository — the single writer for `thought_records`.
 *
 * Centralizing persistence here (rather than inside the XState actor or the component) keeps
 * the write path DRY and testable: the machine's save actor and any future bulk importer both
 * call `createThoughtRecord`. All writes go through `database.write()` so they are atomic and
 * correctly stamped for the Offline-First sync engine.
 */
import { Q } from '@nozbe/watermelondb';

import { getDatabase } from '../database';
import { ThoughtRecord } from '../models/ThoughtRecord';
import { SyncStatus, TableName } from '../schema';
import type { PersistableThoughtRecord } from '../../domain/thoughtRecord';

/**
 * Persists a completed thought record to the encrypted local store.
 *
 * The new row is stamped `sync_status = 'created'` so the next Delta-Sync push uploads it.
 * `recorded_at` is the clinical event time; `created_at`/`updated_at` are managed by
 * WatermelonDB's `@readonly @date` decorators. Returns the persisted model.
 */
export async function createThoughtRecord(
  input: PersistableThoughtRecord,
  recordedAt: Date,
): Promise<ThoughtRecord> {
  const database = getDatabase();
  const collection = database.get<ThoughtRecord>(TableName.THOUGHT_RECORDS);

  return database.write(async () =>
    collection.create((record) => {
      record.userId = input.userId;
      record.situation = input.situation;
      record.emotion = input.emotion;
      record.emotionIntensity = input.emotionIntensity;
      record.automaticThought = input.automaticThought;
      record.distortionTags = [...input.distortionTags];
      record.balancedThought = input.balancedThought;
      record.recordedAt = recordedAt;
      record.syncState = SyncStatus.CREATED;
    }),
  );
}

/** Reactive query of a patient's records, newest first — feeds the trends/insights dashboard. */
export function observePatientThoughtRecords(userId: string) {
  const database = getDatabase();
  return database
    .get<ThoughtRecord>(TableName.THOUGHT_RECORDS)
    .query(Q.where('user_id', userId), Q.where('sync_status', Q.notEq(SyncStatus.DELETED)))
    .observe();
}

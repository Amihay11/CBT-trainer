/**
 * ThoughtRecord model — the persisted CBT ABC-model artifact.
 *
 * Decorated fields map 1:1 to `thought_records` columns in `schema.ts`. The `@json`
 * decorator transparently (de)serializes `distortion_tags` between the SQLite TEXT column
 * and a typed `string[]` in JS, with a sanitizer that hardens against corrupt/legacy rows.
 */
import { Model } from '@nozbe/watermelondb';
import { date, field, json, readonly, text } from '@nozbe/watermelondb/decorators';

import { TableName, type SyncStatusValue } from '../schema';

/**
 * Sanitizer for the JSON `distortion_tags` column. WatermelonDB calls this on read; it must
 * never throw and must always return a well-formed `string[]` even if the stored blob is
 * malformed, so a single bad row cannot crash the offline UI.
 */
function sanitizeDistortionTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((tag): tag is string => typeof tag === 'string');
}

export class ThoughtRecord extends Model {
  static override table = TableName.THOUGHT_RECORDS;

  @text('server_id') serverId?: string;
  @text('user_id') userId!: string;
  @text('situation') situation!: string;
  @text('emotion') emotion!: string;
  @field('emotion_intensity') emotionIntensity!: number;
  @text('automatic_thought') automaticThought!: string;
  @json('distortion_tags', sanitizeDistortionTags) distortionTags!: string[];
  @text('balanced_thought') balancedThought?: string;
  @date('recorded_at') recordedAt!: Date;
  // Explicit server-sync lifecycle column required by the spec. Named `syncState` to avoid
  // shadowing WatermelonDB's built-in `syncStatus` accessor (which tracks the library's own
  // internal `_status`); this column records our FHIR push/pull intent.
  @text('sync_status') syncState!: SyncStatusValue;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}

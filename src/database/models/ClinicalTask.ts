/**
 * ClinicalTask model — Behavioral Activation / homework assignment.
 *
 * `taskType` is a clinician-defined protocol code; `completionStatus` is a small closed set
 * modeled as a string union for exhaustive handling in the UI reminder engine.
 */
import { Model } from '@nozbe/watermelondb';
import { date, readonly, text } from '@nozbe/watermelondb/decorators';

import { TableName, type SyncStatusValue } from '../schema';

/** Lifecycle of a homework/activation task. */
export const TaskCompletionStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
} as const;

export type TaskCompletionStatusValue =
  (typeof TaskCompletionStatus)[keyof typeof TaskCompletionStatus];

export class ClinicalTask extends Model {
  static override table = TableName.CLINICAL_TASKS;

  @text('server_id') serverId?: string;
  @text('user_id') userId!: string;
  @text('task_type') taskType!: string;
  @text('title') title!: string;
  @text('completion_status') completionStatus!: TaskCompletionStatusValue;
  @date('due_date') dueDate?: Date;
  // See ThoughtRecord: `syncState` avoids colliding with Model's built-in `syncStatus`.
  @text('sync_status') syncState!: SyncStatusValue;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}

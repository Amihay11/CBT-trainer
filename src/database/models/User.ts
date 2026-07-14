/**
 * User model — the patient/account row.
 *
 * `encrypted_meta` stores an application-layer-encrypted JSON string (biometrics,
 * demographics, psychiatric-history flags). It is deliberately typed as an opaque string
 * here: decryption is the caller's responsibility so ciphertext is never accidentally
 * logged or rendered. The `children` relation exposes the patient's thought records.
 */
import { Model, type Query } from '@nozbe/watermelondb';
import { children, date, readonly, text } from '@nozbe/watermelondb/decorators';

import { TableName, type SyncStatusValue } from '../schema';
import type { ThoughtRecord } from './ThoughtRecord';

export class User extends Model {
  static override table = TableName.USERS;

  static override associations = {
    [TableName.THOUGHT_RECORDS]: { type: 'has_many', foreignKey: 'user_id' },
    [TableName.CLINICAL_TASKS]: { type: 'has_many', foreignKey: 'user_id' },
  } as const;

  @text('server_id') serverId?: string;
  @text('display_name') displayName!: string;
  @text('locale') locale!: string;
  /** Opaque ciphertext blob — decrypt via the security layer, never render directly. */
  @text('encrypted_meta') encryptedMeta?: string;
  // See ThoughtRecord: `syncState` avoids colliding with Model's built-in `syncStatus`.
  @text('sync_status') syncState!: SyncStatusValue;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;

  @children(TableName.THOUGHT_RECORDS) thoughtRecords!: Query<ThoughtRecord>;
}

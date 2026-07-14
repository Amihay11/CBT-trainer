/**
 * User repository — bootstrap and lookup for the local patient account.
 *
 * In a full build the local user is provisioned during authenticated onboarding and linked to
 * a server id on first sync. For the foundational scaffold, `ensureLocalUser` guarantees a
 * single local account exists so the Thought Record flow has an owner to attach records to.
 */
import { getDatabase } from '../database';
import { User } from '../models/User';
import { SyncStatus, TableName } from '../schema';

/**
 * Returns the existing local user's id, creating one on first launch. The write is atomic and
 * stamped `sync_status = 'created'` so the account is pushed on the next Delta-Sync cycle.
 */
export async function ensureLocalUser(displayName = 'You', locale = 'he-IL'): Promise<string> {
  const database = getDatabase();
  const users = database.get<User>(TableName.USERS);

  const existing = await users.query().fetch();
  if (existing.length > 0 && existing[0]) {
    return existing[0].id;
  }

  const created = await database.write(async () =>
    users.create((user) => {
      user.displayName = displayName;
      user.locale = locale;
      user.syncState = SyncStatus.CREATED;
    }),
  );

  return created.id;
}

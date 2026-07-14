/**
 * Schema migrations.
 *
 * WatermelonDB applies these incrementally when an installed DB's version is lower than
 * `SCHEMA_VERSION`. On a clinical app, migrations must be additive and non-destructive so
 * that offline records created on an old build survive the upgrade (data integrity is a
 * regulatory requirement, not a nicety). The list is empty at v1 and grows with each bump.
 */
import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    // Example for the next release:
    // {
    //   toVersion: 2,
    //   steps: [
    //     addColumns({
    //       table: 'thought_records',
    //       columns: [{ name: 'therapist_note', type: 'string', isOptional: true }],
    //     }),
    //   ],
    // },
  ],
});

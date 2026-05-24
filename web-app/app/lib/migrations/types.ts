// Migration types for browser SQLite (per [[data-migrations]] playbook).
//
// Each migration is a class with a stable id and an async `up`. We do not
// write `down` migrations — per the playbook, untested rollbacks are worse
// than no rollback. If we need to undo, we roll forward with a new migration.

import type { TransactionHandle } from 'sqlocal';

export interface Migration {
  // Matches the filename, e.g. "0001-create-conversations". Frozen once
  // shipped — never edit an applied migration. New schema = new migration.
  id: string;
  up(tx: TransactionHandle): Promise<void>;
}

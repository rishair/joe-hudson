// Migration registry — ordered list. Every migration file in this directory
// must appear here. Per [[data-migrations]] playbook: order matches filename
// number order, never edit an applied migration, new schema = new migration.

import { CreateConversations } from './0001-create-conversations';
import { CreateMessages } from './0002-create-messages';
import type { Migration } from './types';

export const ALL_MIGRATIONS: Migration[] = [
  new CreateConversations(),
  new CreateMessages(),
];

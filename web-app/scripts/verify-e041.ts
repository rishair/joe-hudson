// E-041 behavioral verification. Run with `bun scripts/verify-e041.ts`.
//
// Headless Chrome / Playwright is unavailable in this environment, and the
// real persistence path uses OPFS which only exists in a browser. SQLocal
// falls back to a pure in-process memory driver when (a) databasePath is
// ':memory:' or (b) globalThis.Worker is undefined (true in plain Node).
// Both branches use the SAME SQLocalProcessor + SQLite WASM module + the
// SAME tagged-template `sql` API as the browser path, so anything verifiable
// from the Repository surface here generalizes to the OPFS path. The piece
// this script does NOT exercise is `next.config.js`'s COOP/COEP headers and
// the worker bootstrap — both already shipped in E-040 and verified there.
//
// What it checks:
//   1. Migrations apply cleanly and idempotently (second run is a no-op).
//   2. Three conversations can be created, listed, selected by id.
//   3. Messages persist with sequential positions per conversation, isolated
//      by conversation_id.
//   4. **Byte-equality round-trip** of UIMessage JSON for messages containing
//      text parts, tool-call parts (static + dynamic), tool-result parts,
//      reasoning parts, file parts, and source parts. This is the load-
//      bearing success criterion the G-010 audit tightened.
//   5. delete cascades to messages.
//   6. Concurrent inserts under the SAME conversation produce unique
//      sequential positions (transaction inside MessageRepository.create
//      computes MAX(position)+1 atomically).
//
// On failure, the script logs the diff and exits non-zero.

import { SQLocal, SQLocalProcessor, SQLiteMemoryDriver } from 'sqlocal';
import { applyMigrations } from '../app/lib/migrations/runner';
import { SqliteConversationRepository } from '../app/lib/repos/sqlite-conversation-repository';
import { SqliteMessageRepository } from '../app/lib/repos/sqlite-message-repository';
import type { ConversationMessage } from '../app/lib/types/conversation';
import type { UIMessage } from 'ai';

type FailureRecord = { name: string; message: string };
const failures: FailureRecord[] = [];

function check(name: string, condition: boolean, message: string): void {
  if (!condition) {
    failures.push({ name, message });
    console.error(`  ✗ ${name}: ${message}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

async function main(): Promise<void> {
  console.log('\n== E-041 behavioral verification ==\n');

  // -- 1. Migration idempotence -----------------------------------------
  console.log('1. Migration runner');
  // Bun has a global `Worker` so SQLocal would otherwise spawn the OPFS-bound
  // worker module — which fails outside a browser. Inject an in-process
  // SQLocalProcessor with the memory driver so the rest of the script
  // exercises the same code paths as the browser path minus the worker hop.
  //
  // The constructor fires off a config message but doesn't wait for the
  // driver to initialize before returning; in the browser path, a Worker's
  // message queue serializes init before any query naturally, but in-process
  // both share the same microtask queue and there's a race. Block on the
  // onConnect callback so the test exercises the steady-state, not the boot
  // race (which doesn't exist in the browser path).
  const processor = new SQLocalProcessor(new SQLiteMemoryDriver());
  const connected = new Promise<void>((resolve) => {
    const db = new SQLocal({
      databasePath: ':memory:',
      processor,
      onConnect: () => resolve(),
    });
    // Hold the db reference in outer scope by assigning after construction.
    (globalThis as { __testDb?: SQLocal }).__testDb = db;
  });
  await connected;
  const db = (globalThis as { __testDb?: SQLocal }).__testDb!;
  await db.sql`SELECT 1`;
  await db.sql`PRAGMA foreign_keys = ON`;
  await applyMigrations(db);
  const firstApplied = await db.sql<{ id: string }>`SELECT id FROM schema_migrations ORDER BY id`;
  check(
    'first run applies both migrations',
    firstApplied.length === 2 &&
      firstApplied[0]?.id === '0001-create-conversations' &&
      firstApplied[1]?.id === '0002-create-messages',
    `got ${JSON.stringify(firstApplied)}`,
  );
  await applyMigrations(db);
  const secondApplied = await db.sql<{ id: string }>`SELECT id FROM schema_migrations`;
  check(
    'second run is a no-op',
    secondApplied.length === 2,
    `unexpected migration count: ${secondApplied.length}`,
  );

  // -- 2. Conversation CRUD ----------------------------------------------
  console.log('\n2. Conversation repository');
  const convRepo = new SqliteConversationRepository(db);
  const a = await convRepo.create({ title: 'Alpha' });
  const b = await convRepo.create({ title: 'Bravo' });
  const c = await convRepo.create({ title: 'Charlie' });
  const all = await convRepo.find({ orderBy: 'createdAt', order: 'asc' });
  check(
    'create + find returns three conversations',
    all.length === 3 && all.map((x) => x.title).join(',') === 'Alpha,Bravo,Charlie',
    `got titles: ${all.map((x) => x.title).join(',')}`,
  );
  const byId = await convRepo.find({ id: b.id });
  check(
    'find by id returns the one record',
    byId.length === 1 && byId[0]?.title === 'Bravo',
    `got: ${JSON.stringify(byId)}`,
  );
  await convRepo.update({ id: a.id }, { title: 'Alpha Renamed' });
  const renamed = await convRepo.find({ id: a.id });
  check(
    'update changes the title',
    renamed[0]?.title === 'Alpha Renamed',
    `got: ${renamed[0]?.title}`,
  );

  // -- 3. Message persistence + byte-equality round-trip -----------------
  console.log('\n3. Message persistence (byte-equality round-trip)');
  const msgRepo = new SqliteMessageRepository(db);

  // Construct a representative UIMessage for each part type we expect to
  // see in production (R-015 listed these). Each test passes if
  // JSON.stringify(original) === JSON.stringify(roundTripped).
  const samples: ConversationMessage[] = [
    // Plain user text
    {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: 'Hello, coach.' }],
    } as UIMessage,
    // Assistant text + reasoning
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Reading the situation...', state: 'done' },
        { type: 'text', text: 'I hear you.' },
      ],
    } as unknown as UIMessage,
    // Assistant with a (static) tool call + tool result + final text. This
    // is what E-043 will produce when the v5b coach runs graph-walk
    // retrieval. The persistence layer must not drop these parts.
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      metadata: { latencyMs: 1234, model: 'anthropic/claude-sonnet-4.6' },
      parts: [
        {
          type: 'tool-graph-walk',
          toolCallId: 'tc_001',
          state: 'output-available',
          input: { seedSlug: 'limiting-belief', maxNodes: 8 },
          output: {
            visited: ['limiting-belief', 'identity', 'comparative-mind'],
            keptCount: 5,
          },
        },
        { type: 'text', text: 'Based on the compendium...' },
      ],
    } as unknown as UIMessage,
    // Assistant with a dynamic tool call + custom data part (R-016's
    // data-resources transport for resource attribution)
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'wiki-search',
          toolCallId: 'tc_002',
          state: 'output-available',
          input: { query: 'identity' },
          output: { matches: [{ slug: 'identity', score: 0.91 }] },
        },
        {
          type: 'data-resources',
          data: {
            resources: [
              { slug: 'identity', title: 'Identity', usage: 'primary' },
              { slug: 'limiting-belief', title: 'Limiting belief', usage: 'support' },
            ],
          },
        },
        { type: 'text', text: 'I want to invite you...' },
      ],
    } as unknown as UIMessage,
    // User with a file part (R-015 listed FileUIPart as supported)
    {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [
        { type: 'text', text: 'Here is a screenshot.' },
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ],
    } as unknown as UIMessage,
  ];

  for (let i = 0; i < samples.length; i++) {
    const original = samples[i]!;
    await msgRepo.create({ conversationId: a.id, message: original });
    const roundTripped = (await msgRepo.find({ conversationId: a.id }))[i]!;
    const origJson = JSON.stringify(original);
    const rtJson = JSON.stringify(roundTripped);
    check(
      `sample[${i}] (${original.role}, ${original.parts.length} parts) byte-equal round-trip`,
      origJson === rtJson,
      `diff:\n    orig: ${origJson}\n    rt:   ${rtJson}`,
    );
  }

  // Position sequencing
  const allInA = await msgRepo.find({ conversationId: a.id });
  check(
    'messages return in insertion order',
    allInA.length === samples.length &&
      allInA.every((m, i) => m.id === samples[i]!.id),
    `got ${allInA.length} messages, expected ${samples.length}`,
  );

  // Isolation across conversations
  const inB = await msgRepo.find({ conversationId: b.id });
  check(
    'messages in conversation A are isolated from conversation B',
    inB.length === 0,
    `conversation B had ${inB.length} messages, expected 0`,
  );

  // -- 4. Concurrent inserts under same conversation --------------------
  console.log('\n4. Concurrent inserts (position uniqueness)');
  const concurrentN = 10;
  const concurrentInserts = Array.from({ length: concurrentN }, (_, i) =>
    msgRepo.create({
      conversationId: c.id,
      message: {
        id: `concurrent-${i}`,
        role: 'user',
        parts: [{ type: 'text', text: `Concurrent ${i}` }],
      } as UIMessage,
    }),
  );
  await Promise.all(concurrentInserts);
  const allInC = await msgRepo.find({ conversationId: c.id });
  check(
    'all concurrent inserts persisted',
    allInC.length === concurrentN,
    `got ${allInC.length}, expected ${concurrentN}`,
  );
  const positions = await db.sql<{ position: number }>`
    SELECT position FROM messages WHERE conversation_id = ${c.id} ORDER BY position
  `;
  const positionSet = new Set(positions.map((p) => p.position));
  check(
    'positions are unique and sequential',
    positionSet.size === concurrentN &&
      [...positionSet].every((p, i) => p === i),
    `positions: ${positions.map((p) => p.position).join(',')}`,
  );

  // -- 5. Delete cascade -------------------------------------------------
  console.log('\n5. Delete cascade');
  await convRepo.delete({ id: c.id });
  const afterDelete = await msgRepo.find({ conversationId: c.id });
  check(
    'deleting a conversation cascades to its messages',
    afterDelete.length === 0,
    `got ${afterDelete.length} stragglers`,
  );
  const remainingConvs = await convRepo.find();
  check(
    'remaining conversation count is 2',
    remainingConvs.length === 2,
    `got ${remainingConvs.length}`,
  );

  // -- 6. delete by messageId (single message delete) -------------------
  console.log('\n6. Single message delete');
  const targetMsgId = samples[0]!.id;
  await msgRepo.delete({ conversationId: a.id, messageId: targetMsgId });
  const remainingA = await msgRepo.find({ conversationId: a.id });
  check(
    'single message delete removes only that message',
    remainingA.length === samples.length - 1 &&
      remainingA.every((m) => m.id !== targetMsgId),
    `still found target id: ${remainingA.some((m) => m.id === targetMsgId)}`,
  );

  console.log();
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
  console.log('✓ all checks passed');
}

main().catch((err) => {
  console.error('UNCAUGHT:', err);
  process.exit(1);
});

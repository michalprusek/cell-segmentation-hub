/**
 * Run the storage garbage collector once, now.
 *
 *   docker exec spheroseg-backend npx tsx src/db/runStorageGc.ts            # dry-run
 *   docker exec spheroseg-backend npx tsx src/db/runStorageGc.ts --delete
 *
 * Prints the per-reason summary; the full candidate list is in the JSONL
 * report under <LOG_DIR>/storage-gc/. See services/maintenance/storageGc.ts.
 */
import { prisma } from './index';
import { runStorageGc } from '../services/maintenance/storageGc';

async function main(): Promise<void> {
  const mode = process.argv.includes('--delete') ? 'delete' : 'dry-run';
  const summary = await runStorageGc(mode);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Mark already-added channels as `staticSource` where the stored frames PROVE
 * it, so containers that predate the flag get the segment-once path too.
 *
 * `staticSource` is normally written by `addChannelService` at add time, from
 * knowledge the pixels no longer carry: that the source had exactly one frame.
 * Channels added before that existed have no flag, so they still segment every
 * frame and then pay for tracking — which for one real 300-frame container
 * meant 299 identical segmentations and a tracking pass that overran its
 * timeout.
 *
 * This backfills that flag, but ONLY on evidence: every covered frame's PNG for
 * the channel must hash to the SAME value. That is not a heuristic. Byte-equal
 * inputs give byte-equal segmentations, so projecting one result onto the others
 * is exactly equivalent to segmenting each — which is the entire claim the flag
 * makes. A channel whose frames differ at all is left alone, including one that
 * differs only because it was aligned per frame: the shifts were never recorded
 * for it, and this script will not invent them.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-static-channels.ts [--apply] [--container <id>]
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db';

interface ChannelMetaLike {
  name: string;
  pngBacked?: boolean;
  staticSource?: boolean;
  frameIds?: string[];
  [key: string]: unknown;
}

const UPLOAD_ROOT = process.env.UPLOAD_DIR || '/app/uploads';

/** This is a CLI: stdout is the product, not a leftover debug statement. */
function out(...parts: unknown[]): void {
  process.stdout.write(`${parts.join(' ')}\n`);
}

function frameChannelPath(
  projectId: string,
  containerId: string,
  frameIndex: number,
  channelName: string
): string {
  return path.join(
    UPLOAD_ROOT,
    'projects',
    projectId,
    'images',
    containerId,
    'frames',
    String(frameIndex).padStart(4, '0'),
    `${channelName}.png`
  );
}

async function hashOrNull(file: string): Promise<string | null> {
  try {
    return createHash('md5').update(await readFile(file)).digest('hex');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const idFlag = process.argv.indexOf('--container');
  const onlyContainer = idFlag !== -1 ? process.argv[idFlag + 1] : null;

  const containers = await prisma.image.findMany({
    where: {
      isVideoContainer: true,
      ...(onlyContainer ? { id: onlyContainer } : {}),
    },
    select: { id: true, projectId: true, channels: true, name: true },
  });

  out(
    `${apply ? 'APPLY' : 'DRY RUN'} — inspecting ${containers.length} container(s)\n`
  );

  let flagged = 0;
  for (const container of containers) {
    const channels = container.channels as unknown as ChannelMetaLike[] | null;
    if (!Array.isArray(channels)) continue;

    const frames = await prisma.image.findMany({
      where: { parentVideoId: container.id },
      select: { id: true, frameIndex: true },
      orderBy: { frameIndex: 'asc' },
    });
    if (frames.length < 2) continue;

    let changed = false;
    for (const ch of channels) {
      if (!ch?.pngBacked || ch.staticSource) continue;

      const hashes = new Set<string>();
      const covered: string[] = [];
      let missing = 0;
      for (const f of frames) {
        if (f.frameIndex == null) continue;
        const h = await hashOrNull(
          frameChannelPath(container.projectId, container.id, f.frameIndex, ch.name)
        );
        if (h === null) {
          missing++;
          continue;
        }
        hashes.add(h);
        covered.push(f.id);
        // One differing frame is enough to disqualify the channel; stop paying
        // to hash the rest of a large container.
        if (hashes.size > 1) break;
      }

      const label = `${container.name ?? container.id} / ${ch.name}`;
      if (hashes.size !== 1 || covered.length < 2) {
        out(
          `  skip  ${label}: ${hashes.size} distinct image(s) across ${covered.length} frame(s)` +
            (missing ? `, ${missing} missing` : '')
        );
        continue;
      }

      out(
        `  STATIC ${label}: 1 distinct image across ${covered.length} frame(s)` +
          (missing ? `, ${missing} frame(s) without this channel` : '')
      );
      ch.staticSource = true;
      // Record coverage when it is partial, so projection does not try to fill
      // frames this channel never had.
      if (missing > 0) ch.frameIds = covered;
      changed = true;
      flagged++;
    }

    if (changed && apply) {
      await prisma.image.update({
        where: { id: container.id },
        data: { channels: channels as unknown as object },
      });
      out(`  written: ${container.id}`);
    }
  }

  out(
    `\n${flagged} channel(s) ${apply ? 'flagged' : 'would be flagged'} as staticSource.`
  );
  if (!apply && flagged > 0) out('Re-run with --apply to write.');
  await prisma.$disconnect();
}

main().catch(async err => {
  process.stderr.write(`${String(err)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});

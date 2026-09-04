/**
 * Grant (or revoke) the platform-administrator flag on an existing account.
 *
 *   docker exec spheroseg-backend npx tsx src/db/grantAdmin.ts admin@admin.com
 *   docker exec spheroseg-backend npx tsx src/db/grantAdmin.ts admin@admin.com --revoke
 *
 * With no argument it falls back to `ADMIN_EMAIL` from the environment, the
 * same variable `seed.ts` reads.
 *
 * Why this is a separate, explicit operator action and NOT part of the
 * migration: sign-up on this deployment is open and unverified, so a migration
 * that granted admin to a fixed address would hand the flag to whoever
 * registered that address first. The migration therefore only adds the column,
 * defaulted false. Running this is a deliberate act by someone with shell
 * access to the container.
 *
 * It refuses to create an account. If the address is not registered, register
 * it through the normal sign-up flow first — that way the password is chosen
 * by a human and never passes through this repository, which is public.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const email = args.find(a => !a.startsWith('--')) ?? process.env.ADMIN_EMAIL;

  if (!email) {
    logger.error(
      'Usage: tsx src/db/grantAdmin.ts <email> [--revoke]  (or set ADMIN_EMAIL)',
      undefined,
      'GrantAdmin'
    );
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isAdmin: true },
  });

  if (!user) {
    logger.error(
      `No account registered as ${email}. Register it through the normal sign-up flow first; this script deliberately does not create accounts.`,
      undefined,
      'GrantAdmin'
    );
    process.exitCode = 1;
    return;
  }

  const isAdmin = !revoke;

  if (user.isAdmin === isAdmin) {
    logger.info(
      `${email} already has isAdmin=${isAdmin}; nothing to do.`,
      'GrantAdmin'
    );
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { isAdmin } });

  logger.info(
    `${revoke ? 'Revoked' : 'Granted'} admin on ${email} (${user.id}).`,
    'GrantAdmin'
  );

  if (revoke) {
    // The flag is re-read on every request and on every token refresh, so any
    // impersonated session this account opened stops working immediately —
    // it does not linger until the token expires. Worth saying out loud,
    // because the operator revoking a compromised admin needs to know it.
    logger.info(
      'Any impersonated session opened by this account is now refused on its next request.',
      'GrantAdmin'
    );
  }
}

main()
  .catch(error => {
    logger.error('grantAdmin failed:', error as Error, 'GrantAdmin');
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

/**
 * Auth.js Prisma adapter wrapper that encrypts OAuth tokens at rest.
 */

import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterAccount } from "@auth/core/adapters";
import type { PrismaClient } from "@prisma/client";
import {
  decryptAccountTokens,
  encryptAccountTokens,
} from "@/lib/crypto";

export function EncryptedPrismaAdapter(prisma: PrismaClient): Adapter {
  const base = PrismaAdapter(prisma);

  return {
    ...base,
    async linkAccount(account) {
      const encrypted = encryptAccountTokens(
        account as AdapterAccount,
      ) as AdapterAccount;
      // Adapter typings vary across Auth.js versions; discard unused return.
      await base.linkAccount!(encrypted);
    },
  };
}

/** Load + decrypt Google tokens for API calls (Gmail / Sheets). */
export async function getDecryptedGoogleAccount(
  prisma: PrismaClient,
  userId: string,
) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) return null;
  return decryptAccountTokens(account);
}

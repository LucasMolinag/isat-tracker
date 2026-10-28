import type { EntryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Status transitions. Submitted never downgrades.
 * Unread → Read → Submitted (or Unread → Submitted if matcher wins first).
 */
const RANK: Record<EntryStatus, number> = {
  Unread: 0,
  Read: 1,
  Submitted: 2,
};

export function canTransition(
  from: EntryStatus,
  to: EntryStatus,
): boolean {
  return RANK[to] > RANK[from];
}

/**
 * Apply a status change if allowed; always append a StatusEvent on change.
 * Idempotent for same/lower target status.
 */
export async function transitionEntryStatus(
  entryId: string,
  toStatus: EntryStatus,
  note?: string,
): Promise<{ changed: boolean; status: EntryStatus }> {
  const entry = await prisma.emailEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw new Error(`EmailEntry not found: ${entryId}`);
  }

  if (!canTransition(entry.status, toStatus)) {
    return { changed: false, status: entry.status };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.emailEntry.update({
      where: { id: entryId },
      data: { status: toStatus },
    });
    await tx.statusEvent.create({
      data: {
        entryId,
        fromStatus: entry.status,
        toStatus,
        note,
      },
    });
    return row;
  });

  return { changed: true, status: updated.status };
}

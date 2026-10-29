import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { StatusChip } from "@/components/status-chip";
import { SyncButton } from "@/components/sync-button";
import { LocalDateTime } from "@/components/local-datetime";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const userId = session.user.id;

  let entries: Array<{
    id: string;
    subject: string;
    fromAddress: string;
    receivedAt: Date;
    trackingId: string;
    formUrl: string | null;
    status: "Unread" | "Read" | "Submitted";
  }> = [];
  let user: { lastSyncAt: Date | null; lastSyncError: string | null } | null =
    null;
  let dbError: string | null = null;

  try {
    [entries, user] = await Promise.all([
      prisma.emailEntry.findMany({
        where: { userId },
        orderBy: { receivedAt: "desc" },
        take: 100,
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          receivedAt: true,
          trackingId: true,
          formUrl: true,
          status: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { lastSyncAt: true, lastSyncError: true },
      }),
    ]);
  } catch (e) {
    dbError =
      e instanceof Error
        ? e.message
        : "Database unavailable — set DATABASE_URL and run prisma migrate.";
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-stone-600">
            Matching emails with status chips. Open form goes through the
            tracked redirect.
          </p>
        </div>
        <SyncButton />
      </div>

      <section className="mb-6 rounded-md border border-stone-200 bg-white p-4 text-sm">
        <h2 className="font-medium text-stone-900">Last sync</h2>
        <p className="mt-1 text-stone-600">
          {user?.lastSyncAt ? (
            <LocalDateTime value={user.lastSyncAt} />
          ) : (
            "Never synced"
          )}
        </p>
        {user?.lastSyncError && (
          <p className="mt-1 text-amber-800">{user.lastSyncError}</p>
        )}
        {dbError && <p className="mt-1 text-red-700">{dbError}</p>}
      </section>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="text-stone-700">No email entries yet.</p>
          <p className="mt-2 text-sm text-stone-500">
            Configure subject rules and form URL in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            , then Sync now. Gmail API calls are stubbed until credentials are
            live.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-md border border-stone-200 bg-white">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={entry.status} />
                  <span className="truncate font-medium text-stone-900">
                    {entry.subject}
                  </span>
                </div>
                <p className="truncate text-xs text-stone-500">
                  {entry.fromAddress} ·{" "}
                  <LocalDateTime value={entry.receivedAt} />
                  {entry.formUrl ? " · form linked" : " · no form URL in body"}
                </p>
              </div>
              <a
                href={`/r/${entry.trackingId}`}
                className="shrink-0 rounded-md border border-stone-300 px-3 py-1.5 text-center text-sm text-stone-800 hover:bg-stone-50"
              >
                Open form
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

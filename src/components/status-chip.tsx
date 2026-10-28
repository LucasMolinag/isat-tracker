import type { EntryStatus } from "@prisma/client";

const STYLES: Record<EntryStatus, string> = {
  Unread: "bg-amber-100 text-amber-900",
  Read: "bg-sky-100 text-sky-900",
  Submitted: "bg-emerald-100 text-emerald-900",
};

export function StatusChip({ status }: { status: EntryStatus }) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}

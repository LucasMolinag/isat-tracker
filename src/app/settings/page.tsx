import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SyncButton } from "@/components/sync-button";

export const dynamic = "force-dynamic";

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  return session.user.id;
}

export default async function SettingsPage() {
  const userId = await requireUserId();

  let rules: Array<{
    id: string;
    pattern: string;
    matchMode: "Exact" | "Contains";
    fromAddress: string | null;
    enabled: boolean;
  }> = [];
  let forms: Array<{
    id: string;
    label: string | null;
    formUrl: string;
    entryFieldId: string;
    responseSheetId: string | null;
  }> = [];
  let dbError: string | null = null;

  try {
    [rules, forms] = await Promise.all([
      prisma.subjectRule.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.formConfig.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
    ]);
  } catch (e) {
    dbError =
      e instanceof Error
        ? e.message
        : "Database unavailable — set DATABASE_URL and run migrations.";
  }

  async function addSubjectRule(formData: FormData) {
    "use server";
    const uid = await requireUserId();
    const pattern = String(formData.get("pattern") ?? "").trim();
    const fromAddress =
      String(formData.get("fromAddress") ?? "").trim() || null;
    const matchMode =
      formData.get("matchMode") === "Exact" ? "Exact" : "Contains";
    if (!pattern) return;
    await prisma.subjectRule.create({
      data: { userId: uid, pattern, matchMode, fromAddress, enabled: true },
    });
    revalidatePath("/settings");
  }

  async function toggleRule(formData: FormData) {
    "use server";
    const uid = await requireUserId();
    const id = String(formData.get("id") ?? "");
    const enabled = formData.get("enabled") === "true";
    await prisma.subjectRule.updateMany({
      where: { id, userId: uid },
      data: { enabled: !enabled },
    });
    revalidatePath("/settings");
  }

  async function deleteRule(formData: FormData) {
    "use server";
    const uid = await requireUserId();
    const id = String(formData.get("id") ?? "");
    await prisma.subjectRule.deleteMany({ where: { id, userId: uid } });
    revalidatePath("/settings");
  }

  async function saveFormConfig(formData: FormData) {
    "use server";
    const uid = await requireUserId();
    const formUrl = String(formData.get("formUrl") ?? "").trim();
    const entryFieldId = String(formData.get("entryFieldId") ?? "").trim();
    const responseSheetId =
      String(formData.get("responseSheetId") ?? "").trim() || null;
    const label = String(formData.get("label") ?? "").trim() || null;
    if (!formUrl || !entryFieldId) return;

    const existing = await prisma.formConfig.findFirst({ where: { userId: uid } });
    if (existing) {
      await prisma.formConfig.update({
        where: { id: existing.id },
        data: { formUrl, entryFieldId, responseSheetId, label },
      });
    } else {
      await prisma.formConfig.create({
        data: { userId: uid, formUrl, entryFieldId, responseSheetId, label },
      });
    }
    revalidatePath("/settings");
  }

  const primaryForm = forms[0];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-stone-600">
          Subject + optional From filters, form URL + tracking field id, and
          sync.
        </p>
        {dbError && (
          <p className="mt-2 text-sm text-red-700">{dbError}</p>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Subject rules</h2>
        <p className="text-sm text-stone-600">
          Gmail sync builds a query like{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">
            from:addr (subject:&quot;…&quot; OR subject:&quot;…&quot;)
          </code>
          . Leave From empty to match any sender.
        </p>
        <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 bg-white">
          {rules.length === 0 && (
            <li className="px-4 py-3 text-sm text-stone-500">No rules yet.</li>
          )}
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <div>
                <span className="font-medium">{rule.pattern}</span>
                <span className="ml-2 text-stone-500">
                  {rule.matchMode}
                  {rule.fromAddress ? ` · from:${rule.fromAddress}` : ""}
                  {!rule.enabled && " · disabled"}
                </span>
              </div>
              <div className="flex gap-2">
                <form action={toggleRule}>
                  <input type="hidden" name="id" value={rule.id} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={String(rule.enabled)}
                  />
                  <button
                    type="submit"
                    className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </button>
                </form>
                <form action={deleteRule}>
                  <input type="hidden" name="id" value={rule.id} />
                  <button
                    type="submit"
                    className="rounded border border-stone-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
        <form
          action={addSubjectRule}
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
        >
          <input
            name="pattern"
            required
            placeholder="Subject pattern (contains / exact)"
            className="min-w-[14rem] flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          <input
            name="fromAddress"
            type="email"
            placeholder="From (optional) e.g. jira@…"
            className="min-w-[14rem] flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          <select
            name="matchMode"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            defaultValue="Contains"
          >
            <option value="Contains">Contains</option>
            <option value="Exact">Exact</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
          >
            Add rule
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Form config</h2>
        <p className="text-sm text-stone-600">
          Open form uses the Google Form link from each email (full prefill,
          prefers{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">=3</code>; open
          never overwrites that rating). Submitted is detected from the response
          Sheet by matching ticket keys (
          <code className="rounded bg-stone-100 px-1 text-xs">CE-XXXX</code> /
          <code className="rounded bg-stone-100 px-1 text-xs">entry.86431035</code>
          ) — not on Open.
        </p>
        <form
          action={saveFormConfig}
          className="space-y-3 rounded-md border border-stone-200 bg-white p-4"
        >
          <label className="block text-sm">
            <span className="text-stone-600">Label (optional)</span>
            <input
              name="label"
              defaultValue={primaryForm?.label ?? ""}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-600">
              Fallback form URL (optional if emails embed the form link)
            </span>
            <input
              name="formUrl"
              required
              type="url"
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
              defaultValue={primaryForm?.formUrl ?? ""}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-600">
              Tracking entry field id (do not overwrite QoS{" "}
              <code className="text-xs">=3</code> on open)
            </span>
            <input
              name="entryFieldId"
              required
              placeholder="entry.2115622678"
              defaultValue={primaryForm?.entryFieldId ?? ""}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-600">
              Response Sheet id (required for Submitted detection)
            </span>
            <input
              name="responseSheetId"
              placeholder="Spreadsheet ID or Sheets URL"
              defaultValue={primaryForm?.responseSheetId ?? ""}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
          >
            Save form config
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Sync</h2>
        <p className="text-sm text-stone-600">
          Pulls matching Jira survey emails, refreshes form links, and marks
          Submitted when the response Sheet contains the ticket key.
        </p>
        <SyncButton />
      </section>
    </main>
  );
}

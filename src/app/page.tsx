import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wider text-stone-500">
          ISAT Centre
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          Email → Form tracker
        </h1>
        <p className="text-stone-600">
          Connect Google, sync inbox mail that matches your subject rules, and
          track Unread → Read → Submitted against a Google Form.
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/dashboard" });
        }}
      >
        <button
          type="submit"
          className="w-full rounded-md bg-stone-900 px-4 py-3 text-sm font-medium text-white hover:bg-stone-800"
        >
          Sign in with Google
        </button>
      </form>
      <p className="text-xs text-stone-500">
        Requires Gmail readonly + Sheets/Forms response scopes. See README for
        Google Cloud setup.
      </p>
    </main>
  );
}

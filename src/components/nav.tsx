import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export async function Nav() {
  const session = await auth();

  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="font-semibold tracking-tight text-stone-900">
            ISAT Tracker
          </Link>
          {session?.user && (
            <>
              <Link
                href="/dashboard"
                className="text-stone-600 hover:text-stone-900"
              >
                Dashboard
              </Link>
              <Link
                href="/settings"
                className="text-stone-600 hover:text-stone-900"
              >
                Settings
              </Link>
            </>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {session?.user ? (
            <>
              <span className="hidden text-stone-500 sm:inline">
                {session.user.email}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/dashboard" });
              }}
            >
              <button
                type="submit"
                className="rounded-md bg-stone-900 px-3 py-1.5 text-white hover:bg-stone-800"
              >
                Sign in with Google
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}

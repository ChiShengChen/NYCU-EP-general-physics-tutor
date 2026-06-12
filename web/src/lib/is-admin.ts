import { createServerClient } from "@/lib/supabase/server";

/**
 * Admin gate for `/api/admin/*` routes and the new "管理員後台" mode.
 *
 * The list of admin emails is held in the env (`ADMIN_EMAILS=foo@nycu.edu.tw,
 * bar@nycu.edu.tw`) so adding a TA doesn't need a code change — just a
 * Vercel env tweak + redeploy. Empty / unset env means there are zero
 * admins, which is the safe default for forks and local dev.
 *
 * Matching is case-insensitive and trims whitespace per token. Returns
 * `{ isAdmin: false, email: null }` when no Supabase session is present
 * at all, so the caller can decide between 401 (no session) and 403
 * (session but not on the list) if it wants. The two routes we ship
 * collapse both into a 403 because the difference is uninteresting to
 * a UI that simply hides the entry point for non-admins anyway.
 */

export interface AdminContext {
  isAdmin: boolean;
  email: string | null;
}

function parseAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export async function getAdminContext(): Promise<AdminContext> {
  try {
    const auth = await createServerClient();
    const { data: { user } } = await auth.auth.getUser();
    const email = user?.email?.toLowerCase() ?? null;
    if (!email) return { isAdmin: false, email: null };
    const admins = parseAdminEmails();
    return { isAdmin: admins.has(email), email };
  } catch {
    return { isAdmin: false, email: null };
  }
}

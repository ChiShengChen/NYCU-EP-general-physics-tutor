import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Called by the client right after a successful Google sign-in. Reconciles
 * the (already-set) auth session with the existing student_profiles model.
 *
 * Body: { localStudentId?: string }
 *   - localStudentId is whatever was in localStorage on the browser that just
 *     finished signing in. May be empty / missing on a fresh device.
 *
 * Returns: { studentId, mergedAnonymous, isNewAccount }
 *   - studentId:       canonical profile id the client should now persist.
 *   - mergedAnonymous: we attached the local anonymous profile to this
 *                      Google account (UI surfaces a "kept your history"
 *                      toast).
 *   - isNewAccount:    we created the profile in this request — i.e. the
 *                      user just signed in for the first time and didn't
 *                      bring any anonymous history.
 *
 * Three cases, in priority order:
 *   1. This Google account already has a profile (returning user on a new
 *      device, or already linked) → return that profile id. Refresh email
 *      and display name in case the user updated their Google profile.
 *      The local anonymous history (if any) stays orphaned; we don't try
 *      to auto-merge across an existing account, because that would let
 *      a device's accumulated answers silently rewrite a returning user's
 *      stats — a manual "import this device's history" flow is the right
 *      place for that, and is out of scope for sign-in.
 *   2. No Google-linked profile yet, but the client sent a localStudentId
 *      that exists with auth_user_id IS NULL → link it. Keeps the history.
 *      Also skip the link (fall through to Case 3) if the row turns out
 *      to already belong to a different auth user; we don't steal rows.
 *   3. Otherwise → create a fresh profile keyed to this Google account.
 *      Uses an explicit insert with a `auth_user_id` unique-constraint
 *      collision treated as "another tab won the race"; we re-read the
 *      row instead of erroring.
 *
 * Every successful path also stamps `last_signed_in_at = now()` so future
 * cleanup jobs can distinguish abandoned anonymous rows from active users.
 */
export async function POST(req: NextRequest) {
  const auth = await createServerClient();
  const { data: { user }, error: authErr } = await auth.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { localStudentId } = (await req.json().catch(() => ({}))) as { localStudentId?: string };

  const db = createServiceClient();
  const displayName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    user.email ||
    "anonymous";
  const now = new Date().toISOString();

  // Case 1: this Google account already has a profile.
  const { data: existing } = await db
    .from("student_profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (existing) {
    // Refresh metadata + activity stamp. Best-effort: if this fails, the
    // sign-in itself shouldn't break, so we ignore the error.
    await db
      .from("student_profiles")
      .update({
        email: user.email,
        display_name: displayName,
        last_signed_in_at: now,
      })
      .eq("id", existing.id);
    return NextResponse.json({
      studentId: existing.id,
      mergedAnonymous: false,
      isNewAccount: false,
    });
  }

  // Case 2: anonymous profile on this device → link it (only if truly
  // orphaned; a row already owned by some other auth user is left alone).
  if (localStudentId) {
    const { data: localProfile } = await db
      .from("student_profiles")
      .select("id, auth_user_id")
      .eq("id", localStudentId)
      .maybeSingle();

    if (localProfile && !localProfile.auth_user_id) {
      const { error: linkErr } = await db
        .from("student_profiles")
        .update({
          auth_user_id: user.id,
          email: user.email,
          display_name: displayName,
          last_signed_in_at: now,
        })
        .eq("id", localStudentId)
        .is("auth_user_id", null); // race guard: still anonymous at write time
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 500 });
      }
      return NextResponse.json({
        studentId: localStudentId,
        mergedAnonymous: true,
        isNewAccount: false,
      });
    }
  }

  // Case 3: create a fresh profile. If a concurrent sync from another tab
  // beat us to it, the unique constraint on auth_user_id will fire; we
  // recover by re-reading the row that won.
  const { data: created, error: createErr } = await db
    .from("student_profiles")
    .insert({
      auth_user_id: user.id,
      email: user.email,
      display_name: displayName,
      last_signed_in_at: now,
    })
    .select("id")
    .single();

  if (created) {
    return NextResponse.json({
      studentId: created.id,
      mergedAnonymous: false,
      isNewAccount: true,
    });
  }

  // Postgres unique-violation is SQLSTATE 23505.
  const isUniqueViolation =
    createErr && typeof createErr === "object" && "code" in createErr && createErr.code === "23505";
  if (isUniqueViolation) {
    const { data: winner } = await db
      .from("student_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (winner) {
      return NextResponse.json({
        studentId: winner.id,
        mergedAnonymous: false,
        isNewAccount: false,
      });
    }
  }

  return NextResponse.json(
    { error: createErr?.message ?? "insert failed" },
    { status: 500 },
  );
}

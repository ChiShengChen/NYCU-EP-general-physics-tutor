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
 * Returns: { studentId: string, mergedAnonymous: boolean }
 *   - studentId: the canonical profile id the client should now persist.
 *   - mergedAnonymous: true if we attached the local anonymous profile to
 *     this Google account (so the UI can show "we kept your history").
 *
 * Three cases, in priority order:
 *   1. This Google account already has a profile (returning user on a new
 *      device, or already linked) → return that profile id. Ignore the
 *      local id; that anonymous history stays orphaned unless the user
 *      asks to merge it manually.
 *   2. No Google-linked profile yet, but the client sent a localStudentId
 *      that exists with auth_user_id IS NULL → link it. Keeps the history.
 *   3. Otherwise → create a fresh profile keyed to this Google account.
 */
export async function POST(req: NextRequest) {
  const auth = await createServerClient();
  const { data: { user }, error: authErr } = await auth.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { localStudentId } = (await req.json().catch(() => ({}))) as { localStudentId?: string };

  const db = createServiceClient();

  // Case 1: this Google account already has a profile.
  const { data: existing } = await db
    .from("student_profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ studentId: existing.id, mergedAnonymous: false });
  }

  // Case 2: anonymous profile on this device → link it.
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
          display_name: user.user_metadata?.full_name ?? user.email ?? "anonymous",
        })
        .eq("id", localStudentId);
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 500 });
      }
      return NextResponse.json({ studentId: localStudentId, mergedAnonymous: true });
    }
  }

  // Case 3: create a fresh profile.
  const { data: created, error: createErr } = await db
    .from("student_profiles")
    .insert({
      auth_user_id: user.id,
      email: user.email,
      display_name: user.user_metadata?.full_name ?? user.email ?? "anonymous",
    })
    .select("id")
    .single();

  if (createErr || !created) {
    return NextResponse.json({ error: createErr?.message ?? "insert failed" }, { status: 500 });
  }

  return NextResponse.json({ studentId: created.id, mergedAnonymous: false });
}

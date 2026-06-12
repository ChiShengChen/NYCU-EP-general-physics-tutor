import { createServerClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Trust-aware student identity resolution for API routes.
 *
 * Before this helper, every route accepted `studentId` straight from the
 * request body and used it to gate quota / write rows. That meant a
 * logged-in student A could send another student B's UUID in the body
 * and either burn B's quota or write reflections/goals into B's history
 * (IDOR). The audit caught it as the highest-impact issue, and this
 * helper is the one-shot fix:
 *
 *   1. If a Supabase auth session is present on the request, derive the
 *      studentId from `student_profiles` linked to that auth user. The
 *      body's `studentId` is *ignored* in that case — even if A puts
 *      "b-uuid" in there, the trustworthy answer is A's own row.
 *   2. Otherwise (no session), fall back to the body-provided UUID. We
 *      can't authenticate localStorage IDs, so this is the best we have;
 *      the quota tier for these requests stays at the anonymous cap
 *      either way, so abuse impact is bounded.
 *
 * `fromAuth` is the bit routes that mutate other-user-visible data
 * (e.g. PATCH /api/goals) should check before allowing the write — anon
 * requests against those should be rejected outright.
 */

export interface StudentContext {
  studentId: string | null;
  /** True when studentId came from an authenticated Supabase session,
   *  i.e. can't be spoofed by the caller. */
  fromAuth: boolean;
}

export async function resolveStudentId(
  bodyStudentId?: unknown,
): Promise<StudentContext> {
  try {
    const auth = await createServerClient();
    const { data: { user } } = await auth.auth.getUser();
    if (user) {
      const db = createServiceClient();
      const { data } = await db
        .from("student_profiles")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (data?.id) {
        return { studentId: data.id, fromAuth: true };
      }
      // Authenticated but no profile row yet — that's a transient state
      // between sign-in and /api/auth/sync completing. Fall through to
      // body-provided id rather than 401'ing the request.
    }
  } catch (err) {
    // Cookie parse failure, transient Supabase outage, etc. — fall
    // through to the body id so anonymous flows still work.
    console.warn("[resolve-student-id] auth lookup failed:", err);
  }

  if (typeof bodyStudentId === "string" && bodyStudentId.length > 0) {
    return { studentId: bodyStudentId, fromAuth: false };
  }
  return { studentId: null, fromAuth: false };
}

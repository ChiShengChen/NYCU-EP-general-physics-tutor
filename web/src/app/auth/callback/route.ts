import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * OAuth redirect target. Supabase appends ?code=... when Google bounces back.
 * Exchange the code for a session (cookies get set by the SSR client), then
 * send the user back to the page they came from (or "/").
 *
 * The merge logic (link local anonymous profile to this auth user) happens
 * client-side after redirect, since we need to read localStorage there.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/?signed_in=1";

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error.message)}`, url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

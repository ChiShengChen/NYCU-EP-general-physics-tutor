import { getAdminContext } from "@/lib/is-admin";
import { NextResponse } from "next/server";

/** GET /api/admin/check
 *  Tiny endpoint the home page polls via SWR to decide whether to show
 *  the 「管理員後台」link. Returns only the boolean — no email leak. */
export async function GET() {
  const { isAdmin } = await getAdminContext();
  return NextResponse.json({ isAdmin });
}

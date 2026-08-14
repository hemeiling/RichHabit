import { NextResponse } from "next/server";
import { query } from "@/lib/db/pool";

/**
 * Liveness plus a real database round-trip, for Render's health check. A process
 * that is up but cannot reach Postgres is not healthy, and answering 200 there
 * would keep a broken instance in the load balancer.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await query<{ now: string }>("select now() as now");
    return NextResponse.json({ ok: true, db: "up", now: rows[0]?.now });
  } catch (e) {
    console.error("[health]", e);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}

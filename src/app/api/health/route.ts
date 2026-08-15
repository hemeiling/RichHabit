import { NextResponse } from "next/server";
import { query } from "@/lib/db/pool";
import { describeFailure, describeTarget, suggestFix } from "@/lib/db/diagnose";

/**
 * Liveness plus a real database round-trip, for Render's health check. A process
 * that is up but cannot reach Postgres is not healthy, and answering 200 there
 * would keep a broken instance in the load balancer.
 *
 * When it is down it says why. "down" on its own is useless from outside the
 * deployment — an unset variable, a suspended database, a wrong password and a
 * missing TLS setting look identical — and the person who can fix it usually
 * cannot read the logs. The reason is a category and the target is a shape, so
 * nothing here is a credential: no connection string, no user, no password, no
 * hostname.
 *
 * Note this asks for `select now()`, which needs no tables. A healthy answer
 * therefore means the *connection* works; it says nothing about whether the
 * schema has been applied.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const target = describeTarget(process.env.DATABASE_URL);

  if (target === "not set") {
    return NextResponse.json({
      ok: false, db: "down", target,
      reason: "DATABASE_URL is not set",
      fix: suggestFix("DATABASE_URL is not set", target),
    }, { status: 503 });
  }

  try {
    const rows = await query<{ now: string }>("select now() as now");
    return NextResponse.json({ ok: true, db: "up", target, now: rows[0]?.now });
  } catch (e) {
    console.error("[health]", e);
    // An unparseable string never had a host to fail to find; say that instead.
    const reason = target === "unparseable"
      ? ("DATABASE_URL is not a valid URL" as const)
      : describeFailure(e);
    return NextResponse.json({
      ok: false, db: "down", target, reason, fix: suggestFix(reason, target),
    }, { status: 503 });
  }
}

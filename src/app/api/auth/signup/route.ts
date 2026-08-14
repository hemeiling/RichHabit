import { NextResponse } from "next/server";
import { MAX_PASSWORD, MIN_PASSWORD, createSession, hashPassword } from "@/lib/auth";
import { transaction } from "@/lib/db/pool";

/**
 * Creating an account. The user row and its starter habits go in together —
 * `seed_new_user` used to be a trigger on auth.users, and wrapping both in one
 * transaction keeps the same guarantee: no account exists half-seeded.
 */
export async function POST(request: Request) {
  const parsed = await request.json().catch(() => null);
  const email = typeof parsed?.email === "string" ? parsed.email.trim().toLowerCase() : "";
  const password = typeof parsed?.password === "string" ? parsed.password : "";

  if (!email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (email.length > 254) {
    return NextResponse.json({ error: "That email address is too long." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json(
      { error: `Password must be under ${MAX_PASSWORD} characters.` }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    userId = await transaction(async (q) => {
      const rows = await q<{ id: string }>(
        "insert into users (email, password_hash) values ($1, $2) returning id",
        [email, passwordHash],
      );
      await q("select seed_new_user($1)", [rows[0].id]);
      return rows[0].id;
    });
  } catch (e) {
    // users_email_idx is what makes this race-safe; checking first would not be.
    if (e instanceof Error && /users_email_idx|duplicate key/.test(e.message)) {
      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }
    throw e;
  }

  await createSession(userId);
  return NextResponse.json({ ok: true });
}

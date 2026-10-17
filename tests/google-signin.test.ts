import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign in with Google, end to end against the real routes and the real data
 * layer (PGlite), with Google itself replaced by a local OpenID Connect stub:
 * a token endpoint that signs real RS256 ID tokens with its own key, and a
 * JWKS endpoint publishing it. The routes are configured at the stub by the
 * same environment variables a deployment would use, so everything between
 * the browser and the database is the production code path.
 *
 * What must hold: the callback trusts nothing it is handed (state, nonce,
 * audience, signature); an unknown Google account becomes a real registration
 * and nothing before that; an email match NEVER signs anyone in — it waits
 * for that account's own password, and only the very account the handshake
 * named can complete the link, once; a linked account signs in with one round
 * trip; a disabled account stays out; and no path ever creates a session for
 * anyone else.
 */

// ── the Google stand-in ──────────────────────────────────────────────────────
const codes = new Map<string, Record<string, unknown>>();
let stubUrl = "";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let lastTokenRequest: URLSearchParams | null = null;

const stub = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/token") {
    let body = "";
    for await (const chunk of req) body += chunk;
    lastTokenRequest = new URLSearchParams(body);
    const payload = codes.get(lastTokenRequest.get("code") ?? "");
    if (!payload) { res.writeHead(400).end("{}"); return; }
    const idToken = await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "stub-key" })
      .setIssuer(String(payload.iss ?? stubUrl))
      .setAudience(String(payload.aud ?? "test-client-id"))
      .setIssuedAt().setExpirationTime("5m")
      .sign(keys.privateKey);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id_token: idToken }));
    return;
  }
  if (req.url === "/certs") {
    const jwk = await exportJWK(keys.publicKey);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: "stub-key", alg: "RS256", use: "sig" }] }));
    return;
  }
  res.writeHead(404).end();
});

// ── the app's surroundings ───────────────────────────────────────────────────
let db: PGlite;
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__gDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__gDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
const sent: { to: string }[] = [];
vi.mock("@/lib/email/send", () => ({ sendMail: async (m: any) => { sent.push(m); } }));
const tracked: { event: string }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

/** A cookie jar the routes read and write as the browser would carry it. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { expires?: Date; maxAge?: number }) => {
      if ((opts?.expires && opts.expires.getTime() <= Date.now()) || opts?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
  headers: () => new Map(),
}));

process.env.APP_URL = "http://app.test";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");

let start: any, callback: any, finish: any, signin: any, auth: any;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  const port = (stub.address() as { port: number }).port;
  stubUrl = `http://127.0.0.1:${port}`;
  process.env.GOOGLE_TOKEN_URL = `${stubUrl}/token`;
  process.env.GOOGLE_JWKS_URL = `${stubUrl}/certs`;
  process.env.GOOGLE_ISSUER = stubUrl;
  // Only now, so the modules read the stub's addresses.
  start = await import("../src/app/api/auth/google/start/route");
  callback = await import("../src/app/api/auth/google/callback/route");
  finish = await import("../src/app/api/auth/google/finish/route");
  signin = await import("../src/app/api/auth/signin/route");
  auth = await import("../src/lib/auth");
});
afterAll(async () => { stub.close(); await db?.close(); });

beforeEach(async () => {
  await db?.close();
  db = await PGlite.create();
  (globalThis as any).__gDb = db;
  await db.exec(SCHEMA);
  jar.clear();
  codes.clear();
  sent.length = 0;
  tracked.length = 0;
  lastTokenRequest = null;
});

// ── driving the flow as the browser would ────────────────────────────────────
const req = (url: string, init: RequestInit = {}) => new Request(url, init);
const post = (url: string, body: unknown) => req(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

/** start → Google's redirect, parsed. */
async function begin(params = "") {
  const res: Response = await start.GET(req(`http://app.test/api/auth/google/start${params}`));
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!);
}

/** The browser coming back from "Google" with a code whose token says `claims`. */
async function comeBack(authUrl: URL, claims: Record<string, unknown>, query?: string) {
  const code = randomUUID();
  codes.set(code, { nonce: authUrl.searchParams.get("nonce"), ...claims });
  const q = query ?? `code=${code}&state=${encodeURIComponent(authUrl.searchParams.get("state")!)}`;
  const res: Response = await callback.GET(req(`http://app.test/api/auth/google/callback?${q}`));
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!);
}

const landed = (url: URL) => url.pathname + (url.searchParams.get("google") ? `?google=${url.searchParams.get("google")}` : "")
  + (url.searchParams.get("gerr") ? `?gerr=${url.searchParams.get("gerr")}` : "");

async function makeAccount(username: string, email: string, password = "Verdant-Meadow-42") {
  const hash = await auth.hashPassword(password);
  const [u] = (await db.query<any>(
    `insert into users (email, username, password_hash, created_via) values ($1, $2, $3, 'self_signup') returning id`,
    [email, username, hash])).rows;
  await db.query(`insert into profiles (id) values ($1)`, [u.id]);
  return u.id as string;
}
const sessionUser = async () => (await import("../src/lib/auth")).getSessionUser();

describe("the redirect to Google", () => {
  it("carries PKCE (S256), state, nonce and select_account — and plants matching one-shot cookies", async () => {
    const url = await begin();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("redirect_uri")).toBe("http://app.test/api/auth/google/callback");
    expect(jar.get("rh_gstate")).toBe(url.searchParams.get("state"));
    expect(jar.has("rh_gnonce") && jar.has("rh_gpkce")).toBe(true);
    // The nonce itself is not at rest: the cookie holds only its hash.
    expect(jar.get("rh_gnonce")).not.toBe(url.searchParams.get("nonce"));
  });
});

describe("first-time registration", () => {
  it("runs the full journey: finish screen, username + terms, a seeded verified account, a session", async () => {
    const url = await begin();
    const back = await comeBack(url, { sub: "sub-new", email: "newbie@example.com", email_verified: true });
    expect(landed(back)).toBe("/login?google=finish");
    // PKCE, proved: the verifier the server sent to the token endpoint hashes
    // to the challenge it put in the redirect.
    const verifier = lastTokenRequest?.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url"))
      .toBe(url.searchParams.get("code_challenge"));

    const peek = await (await finish.GET()).json();
    expect(peek).toMatchObject({ step: "signup", email: "newbie@example.com" });

    // Terms are not optional, whatever the client says.
    expect((await finish.POST(post("http://app.test/api/auth/google/finish", { username: "newbie" }))).status).toBe(400);

    const made: Response = await finish.POST(post("http://app.test/api/auth/google/finish",
      { username: "newbie", acceptedTerms: true }));
    expect(made.status).toBe(200);
    const me = await sessionUser();
    expect(me).not.toBeNull();
    const [row] = (await db.query<any>(`select u.username, u.created_via, u.password_hash,
        u.email_verified_at is not null as verified, u.terms_accepted_at is not null as terms,
        (select count(*)::int from habits h where h.user_id = u.id) as habits,
        (select provider_user_id from auth_identities i where i.user_id = u.id) as sub
       from users u where u.id = $1`, [me!.id])).rows;
    expect(row).toMatchObject({ username: "newbie", created_via: "google", password_hash: null,
      verified: true, terms: true, sub: "sub-new" });
    expect(row.habits).toBeGreaterThan(0);   // seeded like any new account
    // The handshake is spent: doing it again creates nothing.
    expect((await finish.POST(post("http://app.test/api/auth/google/finish",
      { username: "newbie2", acceptedTerms: true }))).status).toBe(410);
  });

  it("a username collision refuses without burning the handshake", async () => {
    await makeAccount("taken", "someone@example.com");
    const back = await comeBack(await begin(), { sub: "s-2", email: "fresh@example.com", email_verified: true });
    expect(landed(back)).toBe("/login?google=finish");
    expect((await finish.POST(post("http://app.test/api/auth/google/finish",
      { username: "taken", acceptedTerms: true }))).status).toBe(409);
    expect((await finish.POST(post("http://app.test/api/auth/google/finish",
      { username: "fresh", acceptedTerms: true }))).status).toBe(200);
  });

  it("an address Google has not verified registers pending: no session until RichHabit's own link", async () => {
    const back = await comeBack(await begin(), { sub: "s-3", email: "shaky@example.com", email_verified: false });
    expect(landed(back)).toBe("/login?google=finish");
    const made = await (await finish.POST(post("http://app.test/api/auth/google/finish",
      { username: "shaky", acceptedTerms: true }))).json();
    expect(made).toMatchObject({ ok: true, pending: true, email: "shaky@example.com", sent: true });
    expect(sent).toHaveLength(1);
    expect(await sessionUser()).toBeNull();
    const [u] = (await db.query<any>(
      `select verification_required, email_verified_at from users where username = 'shaky'`)).rows;
    expect(u).toMatchObject({ verification_required: true, email_verified_at: null });
  });
});

describe("returning sign-in", () => {
  it("a linked subject signs in with one round trip; a disabled one is told and stays out", async () => {
    const back = await comeBack(await begin(), { sub: "s-r", email: "ret@example.com", email_verified: true });
    void back;
    await finish.POST(post("http://app.test/api/auth/google/finish", { username: "ret", acceptedTerms: true }));
    const first = await sessionUser();
    jar.clear();   // "another day, another browser"

    const again = await comeBack(await begin(), { sub: "s-r", email: "ret@example.com", email_verified: true });
    expect(again.pathname).toBe("/habits");
    const me = await sessionUser();
    expect(me?.id).toBe(first!.id);

    jar.clear();
    await db.query(`update users set disabled_at = now() where id = $1`, [first!.id]);
    const refused = await comeBack(await begin(), { sub: "s-r", email: "ret@example.com", email_verified: true });
    expect(landed(refused)).toBe("/login?gerr=disabled");
    expect(await sessionUser()).toBeNull();
  });
});

describe("an existing account with the same address", () => {
  it("never signs in or merges by the match: the account's own password completes the link, once, and only for that account", async () => {
    const owner = await makeAccount("meiling", "owner@example.com");
    const intruderSession = await makeAccount("intruder", "intruder@example.com");

    const back = await comeBack(await begin(), { sub: "s-link", email: "owner@example.com", email_verified: true });
    expect(landed(back)).toBe("/login?google=linkExisting");
    expect(await sessionUser()).toBeNull();   // nothing signed in by the match
    expect((await db.query<any>(`select count(*)::int as n from auth_identities`)).rows[0].n).toBe(0);
    const peek = await (await finish.GET()).json();
    expect(peek).toMatchObject({ step: "link", email: "owner@example.com" });

    // Not signed in: refused.
    const pendingCookie = jar.get("rh_gpending")!;
    expect((await finish.POST(post("http://app.test/api/auth/google/finish", { link: true }))).status).toBe(401);

    // Signed in as SOMEONE ELSE: refused, and the handshake is spent.
    await auth.createSession(intruderSession);
    expect((await finish.POST(post("http://app.test/api/auth/google/finish", { link: true }))).status).toBe(409);
    expect((await db.query<any>(`select count(*)::int as n from auth_identities`)).rows[0].n).toBe(0);

    // The right account, with a fresh handshake, through the real password door.
    jar.clear();
    const back2 = await comeBack(await begin(), { sub: "s-link", email: "owner@example.com", email_verified: true });
    expect(landed(back2)).toBe("/login?google=linkExisting");
    const signedIn: Response = await signin.POST(post("http://app.test/api/auth/signin",
      { identifier: "owner@example.com", password: "Verdant-Meadow-42" }));
    expect(signedIn.status).toBe(200);
    expect((await finish.POST(post("http://app.test/api/auth/google/finish", { link: true }))).status).toBe(200);
    const [ident] = (await db.query<any>(
      `select user_id, provider_user_id from auth_identities`)).rows;
    expect(ident).toMatchObject({ user_id: owner, provider_user_id: "s-link" });

    // And a spent handshake cannot be replayed.
    jar.set("rh_gpending", pendingCookie);
    expect((await finish.POST(post("http://app.test/api/auth/google/finish", { link: true }))).status).toBe(409);

    // From now on, Google alone signs in as the owner.
    jar.clear();
    const third = await comeBack(await begin(), { sub: "s-link", email: "owner@example.com", email_verified: true });
    expect(third.pathname).toBe("/habits");
    expect((await sessionUser())?.id).toBe(owner);
  });
});

describe("what the callback refuses", () => {
  it("a cancelled consent: a calm sentence, nothing created", async () => {
    await begin();
    const res: Response = await callback.GET(req("http://app.test/api/auth/google/callback?error=access_denied"));
    expect(new URL(res.headers.get("location")!).searchParams.get("gerr")).toBe("cancelled");
    expect((await db.query<any>(`select count(*)::int as n from users`)).rows[0].n).toBe(0);
  });

  it("a state that does not match its cookie (CSRF)", async () => {
    const url = await begin();
    const out = await comeBack(url, { sub: "s-x", email: "x@example.com", email_verified: true },
      `code=${randomUUID()}&state=forged`);
    expect(landed(out)).toBe("/login?gerr=failed");
    expect(await sessionUser()).toBeNull();
  });

  it("a token whose nonce is wrong (replay), and one minted for another app (audience)", async () => {
    const url = await begin();
    const code = randomUUID();
    codes.set(code, { sub: "s-y", email: "y@example.com", email_verified: true, nonce: "stale" });
    const res: Response = await callback.GET(req(
      `http://app.test/api/auth/google/callback?code=${code}&state=${encodeURIComponent(url.searchParams.get("state")!)}`));
    expect(new URL(res.headers.get("location")!).searchParams.get("gerr")).toBe("failed");

    const url2 = await begin();
    const out2 = await comeBack(url2, { sub: "s-z", email: "z@example.com", email_verified: true, aud: "someone-else" });
    expect(landed(out2)).toBe("/login?gerr=failed");
    expect((await db.query<any>(`select count(*)::int as n from auth_identities`)).rows[0].n).toBe(0);
  });

  it("a Google-only account cannot be entered with any password", async () => {
    await comeBack(await begin(), { sub: "s-nopw", email: "nopw@example.com", email_verified: true });
    await finish.POST(post("http://app.test/api/auth/google/finish", { username: "nopw", acceptedTerms: true }));
    jar.clear();
    for (const password of ["", "null", "undefined", "Verdant-Meadow-42"]) {
      const res: Response = await signin.POST(post("http://app.test/api/auth/signin",
        { identifier: "nopw@example.com", password }));
      expect(res.status).toBe(401);
    }
  });
});

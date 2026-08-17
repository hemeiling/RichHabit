import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mail } from "@/lib/env";

/**
 * Sending mail, with exactly one provider and one deliberate alternative.
 *
 * The alternative is not a mock. `MAIL_OUTBOX_DIR` writes the real composed
 * message — the same subject, the same HTML, the same link — to a file instead
 * of handing it to Resend. That is what lets the whole registration flow be
 * driven end to end by a browser test with no provider, no domain and no
 * network, and it is why the tested path and the production path differ in
 * one line rather than in a stubbed module.
 *
 * What this must never do is fail silently. A missing key is an error at the
 * point of sending, not a quiet no-op that leaves someone waiting forever for
 * a message nobody tried to send.
 */

export interface Message {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type Transport = "resend" | "outbox";

/** Which transport is configured, without sending anything. */
export function transport(): Transport | null {
  if (mail.outboxDir) return "outbox";
  if (mail.resendApiKey && mail.from) return "resend";
  return null;
}

export class MailNotConfigured extends Error {
  constructor() {
    super("No mail transport: set RESEND_API_KEY and MAIL_FROM, or MAIL_OUTBOX_DIR for local use.");
    this.name = "MailNotConfigured";
  }
}

async function toOutbox(message: Message): Promise<void> {
  const dir = mail.outboxDir!;
  await mkdir(dir, { recursive: true });
  // Time-ordered names, so "the newest message" is a sort and not a stat call.
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}.json`;
  await writeFile(join(dir, name), JSON.stringify({ ...message, sentAt: new Date() }, null, 2));
  console.log(`[mail] wrote ${name} to ${dir} (no provider configured)`);
}

async function toResend(message: Message): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mail.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mail.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    /*
     * Resend's body carries the actual reason — an unverified domain, a From
     * that is not on it, a recipient the free tier will not deliver to while
     * the domain is pending. That text goes to the server log, because it is
     * the difference between ten minutes of diagnosis and an afternoon of it.
     * It does not go to the user, who cannot act on it.
     */
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend refused the message (${res.status}): ${detail.slice(0, 500)}`);
  }
}

export async function sendMail(message: Message): Promise<void> {
  const via = transport();
  if (!via) throw new MailNotConfigured();
  if (via === "outbox") return toOutbox(message);
  return toResend(message);
}

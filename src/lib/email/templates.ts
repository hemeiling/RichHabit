import { capacity } from "@/lib/env";
import type { Locale } from "@/lib/i18n";

/**
 * The one message this application sends.
 *
 * Written in the language the account registered in, and sent as HTML with a
 * plain-text alternative carrying the same link — a mail client that refuses
 * HTML must still be able to finish signing up.
 *
 * Deliberately plain: no images, no tracking pixel, no remote stylesheet. A
 * message whose only external reference is the link it asks you to click is
 * both faster to render and much less likely to be filed as spam.
 *
 * These strings live here rather than in the interface dictionaries because
 * they are not interface. Nothing in the app renders them, and they are chosen
 * by the locale recorded at sign-up rather than by whatever the reader's
 * browser happens to be set to hours later — an email cannot re-render when
 * somebody flips a language toggle.
 */

interface Copy {
  subject: string;
  heading: string;
  lead: string;
  button: string;
  fallback: string;
  expiry: (h: number) => string;
  ignore: string;
}

const EN: Copy = {
  subject: "Confirm your email for RichHabit",
  heading: "Confirm your email",
  lead: "Welcome to RichHabit. Confirm this address to finish creating your account.",
  button: "Confirm my email",
  fallback: "If the button does not work, copy this link into your browser:",
  expiry: (h) => `This link works for ${h} hours and can be used once.`,
  ignore: "If you did not sign up for RichHabit, you can ignore this email — "
    + "no account will be activated.",
};

const ZH: Copy = {
  subject: "确认你的 RichHabit 邮箱",
  heading: "确认你的邮箱",
  lead: "欢迎使用「养成富有的习惯」。请确认这个邮箱地址，以完成账户创建。",
  button: "确认邮箱",
  fallback: "如果按钮无法使用，请把下面的链接复制到浏览器打开：",
  expiry: (h) => `此链接在 ${h} 小时内有效，且只能使用一次。`,
  ignore: "如果你并未注册「养成富有的习惯」，可以忽略这封邮件，不会有任何账户被启用。",
};

const SIGNOFF = "RichHabit · 养成富有的习惯";

/**
 * `both` is a real locale in this app, so the email honours it by carrying both
 * languages one after the other rather than silently picking English. One link,
 * stated twice — not two links, which would look like two different requests.
 */
const blocks = (locale: Locale): Copy[] =>
  locale === "zh" ? [ZH] : locale === "both" ? [EN, ZH] : [EN];

/** Anything interpolated into HTML is escaped, including our own link. */
const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function verificationEmail(locale: Locale, url: string) {
  const parts = blocks(locale);
  const href = escape(url);
  const hours = capacity.verifyTtlHours;

  const section = (c: Copy, first: boolean) => `
    <h1 style="margin:${first ? "0" : "26px"} 0 12px;font-size:20px;font-weight:600"
      >${escape(c.heading)}</h1>
    <p style="margin:0 0 20px;font-size:15px;color:#4a453e">${escape(c.lead)}</p>
    ${first ? `<p style="margin:0 0 22px">
      <a href="${href}" style="display:inline-block;padding:11px 22px;background:#1c1a17;
        color:#ffffff;text-decoration:none;border-radius:9px;font-size:15px;font-weight:500"
        >${escape(c.button)}</a>
    </p>
    <p style="margin:0 0 6px;font-size:12.5px;color:#8a837a">${escape(c.fallback)}</p>
    <p style="margin:0 0 18px;font-size:12.5px;word-break:break-all">
      <a href="${href}" style="color:#5a544c">${href}</a>
    </p>` : ""}
    <p style="margin:0 0 6px;font-size:12.5px;color:#8a837a">${escape(c.expiry(hours))}</p>
    <p style="margin:0;font-size:12.5px;color:#8a837a">${escape(c.ignore)}</p>`;

  const html = `<!doctype html>
<html lang="${locale === "zh" ? "zh" : "en"}"><body style="margin:0;padding:24px;background:#faf9f7;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  color:#1c1a17;line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="max-width:520px;background:#ffffff;border:1px solid #e8e4de;border-radius:14px">
        <tr><td style="padding:28px">
          ${parts.map((c, i) => section(c, i === 0)).join("")}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#a09890">${escape(SIGNOFF)}</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    ...parts.flatMap((c, i) => [
      c.heading, "", c.lead, "",
      ...(i === 0 ? [url, ""] : []),
      c.expiry(hours), "", c.ignore, "",
    ]),
    SIGNOFF,
  ].join("\n");

  return { subject: parts.map((c) => c.subject).join(" · "), html, text };
}

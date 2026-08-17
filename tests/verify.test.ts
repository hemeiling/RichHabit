import { describe, expect, it } from "vitest";
import { verificationEmail } from "../src/lib/email/templates";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";

const URL = "https://richhabit.example.com/verify?token=abc123";

describe("the confirmation email", () => {
  it("carries the link in both the HTML and the plain-text alternative", () => {
    const { html, text } = verificationEmail("en", URL);
    expect(html).toContain(URL);
    // A client that refuses HTML must still be able to finish signing up.
    expect(text).toContain(URL);
  });

  it("is written in the language the account registered in", () => {
    expect(verificationEmail("en", URL).subject).toBe("Confirm your email for RichHabit");
    expect(verificationEmail("zh", URL).subject).toContain("确认");
    expect(verificationEmail("zh", URL).html).toContain("确认邮箱");
    expect(verificationEmail("zh", URL).html).not.toContain("Confirm my email");
  });

  it("honours the bilingual locale rather than quietly falling back to English", () => {
    const { html, subject } = verificationEmail("both", URL);
    expect(subject).toContain("Confirm your email");
    expect(subject).toContain("确认");
    expect(html).toContain("Confirm your email");
    expect(html).toContain("确认你的邮箱");
    // One link, stated once — two would read as two different requests.
    expect(html.split('href="https://richhabit').length - 1).toBe(2); // button + fallback
  });

  it("says how long the link lasts and that it is single use", () => {
    const { text } = verificationEmail("en", URL);
    expect(text).toContain("24 hours");
    expect(text).toContain("once");
  });

  it("tells someone who did not sign up that they can ignore it", () => {
    expect(verificationEmail("en", URL).text).toContain("ignore this email");
    expect(verificationEmail("zh", URL).text).toContain("忽略");
  });

  /**
   * The whole message is composed by string concatenation, so anything that
   * reached it from user input would be an injection. Nothing does today — the
   * only interpolated value is our own URL — and this holds that line.
   */
  it("escapes what it interpolates", () => {
    const { html } = verificationEmail("en",
      'https://x.example/verify?token=a"><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("references nothing outside the message", () => {
    const { html } = verificationEmail("en", URL);
    // No tracking pixel, no remote stylesheet, no image host.
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<link/i);
    const remote = html.match(/https?:\/\/[^"' ]+/g) ?? [];
    expect(remote.every((u) => u.startsWith("https://richhabit.example.com"))).toBe(true);
  });
});

describe("what the reader is told", () => {
  it("has every verification string in both languages", () => {
    for (const k of ["title", "intro", "confirm", "doneTitle", "problemTitle", "ok",
      "already", "expired", "invalid", "fullStillValid", "signIn", "backToSignIn",
      "sentTitle", "sentHint", "sendFailed", "resend", "resendSent"] as const) {
      expect(en.verify[k], `en.verify.${k}`).toBeTruthy();
      expect(zh.verify[k], `zh.verify.${k}`).toMatch(/[一-鿿]/);
    }
    expect(en.errors.verifyPending).toBeTruthy();
    expect(zh.errors.verifyPending).toMatch(/[一-鿿]/);
  });

  it("names the address it sent to, in both", () => {
    expect(en.verify.sentBody("a@b.com")).toContain("a@b.com");
    expect(zh.verify.sentBody("a@b.com")).toContain("a@b.com");
  });

  it("derives the bilingual dictionary automatically", () => {
    expect(both.verify.confirm).toContain("Confirm my email");
    expect(both.verify.confirm).toContain("确认邮箱");
  });

  /**
   * The resend endpoint answers identically whether or not the account exists,
   * so the sentence it returns must not claim one did.
   */
  it("does not confirm whether an account exists when resending", () => {
    expect(en.verify.resendSent).toMatch(/if that account/i);
    expect(zh.verify.resendSent).toContain("如果");
  });
});

describe("the mail transport", () => {
  it("reports nothing configured rather than pretending to send", async () => {
    const { transport } = await import("../src/lib/email/send");
    // No RESEND_API_KEY and no MAIL_OUTBOX_DIR in the test environment.
    expect(transport()).toBeNull();
  });

  it("refuses to send instead of failing silently", async () => {
    const { sendMail, MailNotConfigured } = await import("../src/lib/email/send");
    await expect(sendMail({ to: "a@b.com", subject: "s", html: "h", text: "t" }))
      .rejects.toBeInstanceOf(MailNotConfigured);
  });
});

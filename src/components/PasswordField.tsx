"use client";
import { useId, useState } from "react";

/**
 * A password input with a show/hide control, used everywhere a password is
 * typed — signing in, creating an account, redeeming a setup link, and
 * changing a password. One component, so the four fields cannot end up with
 * four slightly different toggles.
 *
 * The value is never touched: revealing swaps `type` between `password` and
 * `text` and nothing else. Nothing here writes to storage, and the visibility
 * state is local React state that dies with the component, so a revealed
 * password is never carried to another screen or another session.
 *
 * The toggle is a real `<button type="button">`, so it is in the tab order and
 * responds to Enter and Space for free. `type="button"` also matters: inside a
 * `<form>` a bare button submits, which would have made revealing your password
 * attempt a sign-in.
 *
 * The icon is `aria-hidden`; the button carries the label, so a screen reader
 * hears "Show password" rather than an unnamed graphic.
 *
 * Like `Sidebar`, it holds no strings of its own — the two labels arrive as
 * props. That is what lets the bilingual app pass dictionary values and admin,
 * which has no LocaleProvider and is English by design, pass literals.
 */
export default function PasswordField({
  value, onChange, onKeyDown, placeholder, autoComplete, autoFocus, label, hint,
  showLabel, hideLabel, invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  /** Rendered above the field. Supply it already translated. */
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** Accessible names for the toggle, in the caller's language. */
  showLabel: string;
  hideLabel: string;
  /** Draws the error border without changing anything else about the field. */
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <div className="block">
      <label className="eyebrow mb-1.5 block" htmlFor={id}>{label}</label>
      {/* The input keeps its own class, so focus and error styling are unchanged;
          the button is positioned over its right-hand padding. */}
      <div style={{ position: "relative" }}>
        <input
          id={id}
          className="input"
          type={shown ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          // Never helpful on a password, and actively wrong once it is visible.
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={invalid || undefined}
          style={{ paddingRight: 44, borderColor: invalid ? "var(--warn)" : undefined }}
        />
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? hideLabel : showLabel}
          aria-pressed={shown}
          title={shown ? hideLabel : showLabel}
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            padding: "6px 8px", lineHeight: 0, borderColor: "transparent",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
            {/* The struck-through eye means "hidden", so it shows while revealed. */}
            {shown && <path d="M4 20L20 4" />}
          </svg>
        </button>
      </div>
      {hint && <div className="faint mt-1" style={{ fontSize: 12.5 }}>{hint}</div>}
    </div>
  );
}

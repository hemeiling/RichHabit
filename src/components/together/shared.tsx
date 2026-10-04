"use client";

/**
 * Small pieces shared by the Together screens. Nothing here knows about any
 * private RichHabit data; a person is an id and a display name.
 */

export interface Person { id: string; name: string }

/** A JSON call to a Together API. Throws the server's own (translated) sentence. */
export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status})`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return data as T;
}

/** Up to two letters, from the display name. */
export const initials = (name: string) =>
  (name.trim().split(/\s+/).map((w) => [...w][0] ?? "").slice(0, 2).join("") || "·").toUpperCase();

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="tg-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars, with the full list as the accessible name. */
export function AvatarRow({ people, label }: { people: Person[]; label: string }) {
  const shown = people.slice(0, 5);
  return (
    <span className="tg-avatars" role="img" aria-label={label}>
      {shown.map((p) => <Avatar key={p.id} name={p.name} size={26} />)}
      {people.length > shown.length && <span className="tg-avatar tg-more" aria-hidden="true">+{people.length - shown.length}</span>}
    </span>
  );
}

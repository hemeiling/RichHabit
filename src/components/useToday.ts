import { useEffect, useState } from "react";
import { todayISO } from "@/lib/dates";

/**
 * Today's date that moves on by itself.
 *
 * A page left open overnight otherwise keeps showing yesterday. This re-reads
 * the date whenever the tab becomes visible or regains focus — the moments
 * someone actually comes back to it — rather than running a timer that would
 * fire in background tabs nobody is looking at.
 *
 * Shared by Important Dates, which introduced it, Priority Compass, which now
 * always shows today, and the Accomplishments card, whose "today" count must
 * follow the same day.
 */
export function useToday(): string {
  const [day, setDay] = useState(todayISO());
  useEffect(() => {
    const check = () => setDay((d) => (todayISO() === d ? d : todayISO()));
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  return day;
}

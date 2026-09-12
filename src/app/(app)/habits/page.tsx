import { Suspense } from "react";
import RichHabits from "@/components/screens/RichHabits";

/**
 * Rich Habits — the daily habit experience, at the address its name implies.
 *
 * This route used to be the habit sheet, which is More > My Habit Sheet now.
 * The two query parameters that ever deep-linked into that screen — `?edit=`
 * from Goals and `?from=` from an awareness entry — are redirected to its new
 * address in middleware, so the links already in the wild keep working and keep
 * naming the habit they named. See src/middleware.ts.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <RichHabits />
    </Suspense>
  );
}

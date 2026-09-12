import { Suspense } from "react";
import Habits from "@/components/screens/Habits";

/**
 * My Habit Sheet — every habit on the sheet, with its recent completion rate,
 * and the way in to edit, pause, replace or retire one.
 *
 * The same component that answered at /habits before Rich Habits took that
 * address. Not a line of it changed: it still reads `?edit=` and `?from=`, so
 * the links that used to arrive at the old path still open the same editor on
 * the same habit once they are forwarded here.
 *
 * It sits under More because it is a management view you visit when something
 * needs changing, rather than one of the three places the product asks you to
 * spend your attention.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Habits />
    </Suspense>
  );
}

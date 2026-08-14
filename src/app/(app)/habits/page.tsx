import { Suspense } from "react";
import Habits from "@/components/screens/Habits";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Habits />
    </Suspense>
  );
}

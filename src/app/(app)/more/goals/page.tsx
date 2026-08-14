import { Suspense } from "react";
import Goals from "@/components/screens/Goals";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Goals />
    </Suspense>
  );
}

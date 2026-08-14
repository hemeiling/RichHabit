import { Suspense } from "react";
import Insights from "@/components/screens/Insights";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Insights />
    </Suspense>
  );
}

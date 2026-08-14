import { Suspense } from "react";
import Metrics from "@/components/screens/Metrics";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Metrics />
    </Suspense>
  );
}

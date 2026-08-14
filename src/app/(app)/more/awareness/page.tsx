import { Suspense } from "react";
import Awareness from "@/components/screens/Awareness";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Awareness />
    </Suspense>
  );
}

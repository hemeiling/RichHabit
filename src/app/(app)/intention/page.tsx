import { Suspense } from "react";
import Intention from "@/components/screens/Intention";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Intention />
    </Suspense>
  );
}

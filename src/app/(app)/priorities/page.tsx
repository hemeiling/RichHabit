import { Suspense } from "react";
import PriorityCompass from "@/components/screens/PriorityCompass";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PriorityCompass />
    </Suspense>
  );
}

import { Suspense } from "react";
import Today from "@/components/screens/Today";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Today />
    </Suspense>
  );
}

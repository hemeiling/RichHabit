import { Suspense } from "react";
import Week from "@/components/screens/Week";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Week />
    </Suspense>
  );
}

import { Suspense } from "react";
import Community from "@/components/screens/Community";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Community />
    </Suspense>
  );
}

import { Suspense } from "react";
import Stacks from "@/components/screens/Stacks";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Stacks />
    </Suspense>
  );
}

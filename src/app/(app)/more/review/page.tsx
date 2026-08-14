import { Suspense } from "react";
import Review from "@/components/screens/Review";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Review />
    </Suspense>
  );
}

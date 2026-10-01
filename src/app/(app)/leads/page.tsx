import { Suspense } from "react";
import { LeadsView } from "@/components/LeadsView";

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsView />
    </Suspense>
  );
}

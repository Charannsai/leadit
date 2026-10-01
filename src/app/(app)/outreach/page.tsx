import { Suspense } from "react";
import { OutreachView } from "@/components/outreach/OutreachView";

export default function OutreachPage() {
  return (
    <Suspense>
      <OutreachView />
    </Suspense>
  );
}

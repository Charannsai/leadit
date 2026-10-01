import { Suspense } from "react";
import { SettingsView } from "@/components/SettingsView";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}

import { PixelLoader } from "@/components/ui";

// Shown the instant you navigate, while the next page loads.
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-6 pb-4 pt-5">
        <div className="h-5 w-48 animate-pulse rounded-md bg-panel-2" />
        <div className="mt-2 h-3.5 w-72 animate-pulse rounded-md bg-panel" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <PixelLoader className="scale-150" />
      </div>
    </div>
  );
}

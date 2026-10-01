import { getSettings, saveSettings, type Settings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getSettings(true));
}

export async function PUT(req: Request) {
  const patch = (await req.json()) as Partial<Settings>;
  return Response.json(await saveSettings(patch));
}

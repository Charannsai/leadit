import { getKey, KEY_PROVIDERS, keyStatus, removeKey, saveKey, testKey, type KeyProvider } from "@/lib/keys";

export const dynamic = "force-dynamic";

const valid = (p: unknown): p is KeyProvider => KEY_PROVIDERS.some((k) => k.id === p);

/** List keys (masked). ?reveal=<provider> returns that provider's full active key. */
export async function GET(req: Request) {
  const reveal = new URL(req.url).searchParams.get("reveal");
  if (reveal) {
    if (!valid(reveal)) return Response.json({ error: "unknown provider" }, { status: 400 });
    return Response.json({ key: (await getKey(reveal)) ?? "" });
  }
  return Response.json(await keyStatus());
}

/** Save a new key. It's tested first unless force is set. */
export async function PUT(req: Request) {
  const { provider, key, force } = (await req.json()) as { provider: string; key: string; force?: boolean };
  if (!valid(provider) || !key?.trim()) return Response.json({ error: "provider and key required" }, { status: 400 });
  if (!force) {
    const t = await testKey(provider, key.trim());
    if (!t.ok) return Response.json({ error: `Key rejected: ${t.detail}` }, { status: 400 });
  }
  try {
    await saveKey(provider, key);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  return Response.json(await keyStatus());
}

/** Test the active key, or a key passed in the body. */
export async function POST(req: Request) {
  const { provider, key } = (await req.json()) as { provider: string; key?: string };
  if (!valid(provider)) return Response.json({ error: "unknown provider" }, { status: 400 });
  const k = key?.trim() || (await getKey(provider));
  if (!k) return Response.json({ ok: false, detail: "No key set" });
  return Response.json(await testKey(provider, k));
}

/** Remove the saved key so the .env.local one is used again. */
export async function DELETE(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider");
  if (!valid(provider)) return Response.json({ error: "unknown provider" }, { status: 400 });
  await removeKey(provider);
  return Response.json(await keyStatus());
}

import { getKey } from "@/lib/keys";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; models: string[] }>();

/** Text models available on a provider with the current key. ?provider=groq | gemini */
export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider");
  if (provider !== "groq" && provider !== "gemini") return Response.json({ error: "provider must be groq or gemini" }, { status: 400 });
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < 10 * 60_000) return Response.json({ models: hit.models });

  const key = await getKey(provider);
  if (!key) return Response.json({ models: [], error: `No ${provider === "groq" ? "Groq" : "Gemini"} key set` });

  try {
    let models: string[] = [];
    if (provider === "groq") {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      const j = (await r.json()) as { data?: { id: string }[] };
      // Speech, TTS and safety-classifier models can't write JSON answers.
      models = (j.data ?? []).map((m) => m.id).filter((id) => !/whisper|guard|orpheus|tts|playai/i.test(id));
    } else {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15_000) });
      const j = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      models = (j.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live/i.test(m.name))
        .map((m) => m.name.replace(/^models\//, ""));
    }
    models.sort();
    cache.set(provider, { at: Date.now(), models });
    return Response.json({ models });
  } catch (e) {
    return Response.json({ models: [], error: (e as Error).message });
  }
}

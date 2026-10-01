import "server-only";
import { track } from "../agentLog";
import { recordUsage } from "../budget";
import { getKey } from "../keys";
import { fetchJson } from "./http";

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

/** Asks Gemini for a JSON object. Used by the drafting agent to write outreach. */
export async function geminiJson<T>(system: string, user: string, modelOverride?: string): Promise<T> {
  const key = await getKey("gemini");
  if (!key) throw new Error("No Gemini API key (Settings → API keys)");
  const model = modelOverride || geminiModel();

  const res = await track(
    "gemini",
    "generate",
    () =>
      fetchJson<GenerateResponse>("gemini", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system + "\nRespond with a single JSON object only." }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
        }),
        timeoutMs: 60_000,
      }),
    (r) => ({ tokensIn: r.usageMetadata?.promptTokenCount, tokensOut: r.usageMetadata?.candidatesTokenCount, detail: { model } }),
  );
  await recordUsage("gemini");

  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Gemini returned no text (${res.candidates?.[0]?.finishReason ?? "no candidates"})`);
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini returned invalid JSON");
    return JSON.parse(match[0]) as T;
  }
}

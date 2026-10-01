import "server-only";
import { track } from "../agentLog";
import { recordUsage } from "../budget";
import { getKey } from "../keys";
import { fetchJson } from "./http";

interface ChatResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Asks the Groq model for a JSON object. The prompt must describe the shape it should return. */
export async function groqJson<T>(system: string, user: string, modelOverride?: string): Promise<T> {
  const key = await getKey("groq");
  if (!key) throw new Error("No Groq API key (Settings → API keys)");
  const model = modelOverride || process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system + "\nRespond with a single JSON object only." },
      { role: "user", content: user },
    ],
  };
  if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

  const res = await track(
    "groq",
    "chat",
    () =>
      fetchJson<ChatResponse>("groq", "https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      }),
    (r) => ({ tokensIn: r.usage?.prompt_tokens, tokensOut: r.usage?.completion_tokens, detail: { model } }),
  );
  await recordUsage("groq");
  const content = res.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    return (match ? JSON.parse(match[0]) : {}) as T;
  }
}

import "server-only";
import { geminiJson } from "./providers/gemini";
import { groqJson } from "./providers/groq";
import { getSettings, type LlmAgent } from "./settings";

/** Asks the LLM chosen for this agent in Settings → Agents for a JSON object. */
export async function llmJson<T>(agent: LlmAgent, system: string, user: string): Promise<T> {
  const { provider, model } = (await getSettings()).agents[agent];
  return provider === "gemini" ? geminiJson<T>(system, user, model) : groqJson<T>(system, user, model);
}

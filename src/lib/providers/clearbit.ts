import "server-only";
import { track } from "../agentLog";
import { cached } from "../cache";
import { fetchJson } from "./http";

/** Free company-name → domain suggestions (no key, no credits). */
export async function suggestDomains(name: string): Promise<{ name: string; domain: string }[]> {
  return cached(`clearbit:suggest:${name.toLowerCase()}`, 90, async () => {
    try {
      const res = await track("clearbit", "suggest", () =>
        fetchJson<{ name: string; domain: string }[]>(
          "clearbit",
          `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`,
          { timeoutMs: 10_000 },
        ),
      );
      return Array.isArray(res) ? res.slice(0, 5).map((r) => ({ name: r.name, domain: r.domain })) : [];
    } catch {
      return [];
    }
  });
}

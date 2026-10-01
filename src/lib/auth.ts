// Works in both the Edge middleware and Node routes (Web Crypto only).

export const AUTH_COOKIE = "le_auth";

export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`leadenrich:${password}:${process.env.WORKER_SECRET ?? ""}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

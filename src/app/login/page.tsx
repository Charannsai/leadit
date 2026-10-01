"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) window.location.href = "/";
    else setError("Wrong password");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-panel/60 p-4">
      <form onSubmit={submit} className="w-full max-w-xs rounded-2xl border border-line bg-white p-6 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.12)]">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
            <Sparkles size={14} />
          </div>
          <div className="text-[14px] font-semibold">Leadit</div>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-ink"
        />
        {error && <div className="mt-2 text-[12px] text-[#b4403b]">{error}</div>}
        <Button variant="primary" className="mt-3 w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}

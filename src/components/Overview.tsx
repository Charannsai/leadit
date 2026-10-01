"use client";

import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import { PageHeader, useApp } from "./AppShell";
import { Button, PixelLoader, cx } from "./ui";

interface OverviewData {
  status: Record<string, number>;
  outcome: Record<string, number>;
  email_status: Record<string, number>;
  founders: number;
  founder_linkedin: number;
  company_linkedin: number;
  domains: number;
  uploads: { id: string; filename: string; total_rows: number; created_at: string; finished: number; in_flight: number; emails: number; founders: number }[];
  daily: { day: string; enriched: number; emails: number }[];
  worker: { alive: boolean };
  events: { id: number; lead_id: string; upload_id: string; at: string; level: string; message: string }[];
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function Overview() {
  const { openUpload } = useApp();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api<OverviewData>("/api/overview")
        .then((d) => !stop && (setData(d), setError(null)))
        .catch((e) => !stop && setError(e.message));
    load();
    const t = setInterval(() => !document.hidden && load(), 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (error && !data)
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <div className="text-[15px] font-semibold">Overview isn&apos;t available yet</div>
          <div className="mt-2 text-[13px] text-muted">{error}</div>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelLoader className="scale-150" />
      </div>
    );

  const total = Object.values(data.status).reduce((a, b) => a + b, 0);
  const enriched = data.status.done ?? 0;
  const emails = Object.values(data.email_status).reduce((a, b) => a + b, 0);
  const verified = data.email_status.valid ?? 0;
  const inFlight = (data.status.queued ?? 0) + (data.status.processing ?? 0);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <PageHeader
        title="Overview"
        subtitle={
          data.worker.alive || inFlight ? (
            <>
              <PixelLoader /> <span className="shimmer-text font-medium">Enriching · {inFlight.toLocaleString()} leads in the queue</span>
            </>
          ) : (
            <span>All uploads · queue idle</span>
          )
        }
        actions={
          <Button variant="primary" onClick={openUpload}>
            <Plus size={14} /> New upload
          </Button>
        }
      />

      <div className="space-y-4 px-6 pb-8">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-5">
          <Kpi label="Total leads" value={total} />
          <Kpi label="Enriched" value={enriched} note={`${pct(enriched, total)}% of all leads`} />
          <Kpi label="Founders found" value={data.founders} note={`${pct(data.founders, enriched)}% of enriched`} />
          <Kpi label="Founder emails" value={emails} note={`${pct(emails, enriched)}% of enriched`} />
          <Kpi label="Verified emails" value={verified} note={`${pct(verified, emails)}% of founder emails`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Enriched per day" subtitle="Last 14 days" className="lg:col-span-2">
            <DailyBars daily={data.daily} />
          </Card>
          <Card title="Coverage" subtitle={`Share of ${enriched.toLocaleString()} enriched leads`}>
            <div className="space-y-3 pt-1">
              <Coverage label="Website found" n={data.domains} of={Math.max(enriched, data.domains)} />
              <Coverage label="Company LinkedIn" n={data.company_linkedin} of={enriched} />
              <Coverage label="Founder identified" n={data.founders} of={enriched} />
              <Coverage label="Founder LinkedIn" n={data.founder_linkedin} of={enriched} />
              <Coverage label="Founder email" n={emails} of={enriched} />
              <Coverage label="Verified email" n={verified} of={enriched} />
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Uploads" className="lg:col-span-2" pad={false}>
            {data.uploads.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-muted">No uploads yet.</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11.5px] text-muted">
                    <th className="px-4 py-2 font-medium">File</th>
                    <th className="px-3 py-2 font-medium">Progress</th>
                    <th className="px-3 py-2 text-right font-medium">Founders</th>
                    <th className="px-3 py-2 text-right font-medium">Emails</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {data.uploads.map((u) => (
                    <tr key={u.id} className="group border-t border-line">
                      <td className="px-4 py-2.5">
                        <Link href={`/leads?u=${u.id}`} className="block max-w-[260px] truncate font-medium hover:underline">
                          {u.filename}
                        </Link>
                        <div className="text-[11px] text-muted">
                          {u.total_rows.toLocaleString()} rows · {timeAgo(u.created_at)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-32 overflow-hidden rounded-full bg-panel-2">
                            <div className={cx("h-full rounded-full bg-ink", u.in_flight > 0 && "progress-live")} style={{ width: `${pct(u.finished, u.total_rows)}%` }} />
                          </div>
                          <span className="text-[11.5px] tabular-nums text-muted">{pct(u.finished, u.total_rows)}%</span>
                          {u.in_flight > 0 && <PixelLoader className="scale-75" />}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{u.founders.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{u.emails.toLocaleString()}</td>
                      <td className="pr-3">
                        <Link href={`/leads?u=${u.id}`} className="text-muted opacity-0 group-hover:opacity-100" aria-label="Open">
                          <ArrowUpRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div className="space-y-4">
            <Card title="Results">
              <Breakdown
                items={[
                  { key: "founder", label: "Founder found", n: data.outcome.founder ?? 0, color: "#262626" },
                  { key: "company", label: "Company contacts only", n: data.outcome.company ?? 0, color: "#8a8a88" },
                  { key: "none", label: "Nothing found", n: data.outcome.none ?? 0, color: "#dededc" },
                ]}
              />
            </Card>
            <Card title="Founder email quality">
              <Breakdown
                items={[
                  { key: "valid", label: "Verified", n: data.email_status.valid ?? 0, color: "#3a9a5b" },
                  { key: "accept_all", label: "Catch-all", n: data.email_status.accept_all ?? 0, color: "#d39a2c" },
                  { key: "unknown", label: "Unknown / unverified", n: (data.email_status.unknown ?? 0) + (data.email_status.unverified ?? 0), color: "#b9b9b6" },
                  { key: "invalid", label: "Invalid", n: data.email_status.invalid ?? 0, color: "#c4554f" },
                ]}
              />
            </Card>
          </div>
        </div>

        <Card title="Recent activity" pad={false}>
          {data.events.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-muted">Nothing yet.</div>
          ) : (
            <ol className="divide-y divide-line">
              {data.events.map((e) => {
                const [who, ...rest] = e.message.split(" — ");
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                    <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", e.level === "success" ? "bg-[#3a9a5b]" : e.level === "warn" ? "bg-[#d39a2c]" : e.level === "error" ? "bg-[#c4554f]" : "bg-line-strong")} />
                    <Link href={`/leads?u=${e.upload_id}`} className="w-56 shrink-0 truncate font-medium hover:underline">
                      {who}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{rest.join(" — ")}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">{timeAgo(e.at)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight">{value.toLocaleString()}</div>
      {note && <div className="text-[11px] text-muted">{note}</div>}
    </div>
  );
}

function Card({ title, subtitle, children, className, pad = true }: { title: string; subtitle?: string; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("overflow-hidden rounded-xl border border-line bg-white", className)}>
      <div className="flex items-baseline justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {subtitle && <span className="text-[11.5px] text-muted">{subtitle}</span>}
      </div>
      <div className={pad ? "px-4 pb-4" : ""}>{children}</div>
    </section>
  );
}

function Coverage({ label, n, of }: { label: string; n: number; of: number }) {
  const p = pct(n, of);
  return (
    <div title={`${n.toLocaleString()} of ${of.toLocaleString()}`}>
      <div className="mb-1 flex justify-between text-[12px]">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums text-ink">
          {p}% <span className="text-muted">· {n.toLocaleString()}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-ink transition-[width] duration-700" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function Breakdown({ items }: { items: { key: string; label: string; n: number; color: string }[] }) {
  const total = items.reduce((a, b) => a + b.n, 0);
  const [hover, setHover] = useState<string | null>(null);
  if (!total) return <div className="py-2 text-[12.5px] text-muted">No data yet.</div>;
  return (
    <div>
      {/* stacked bar with a 2px surface gap between segments */}
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {items.filter((i) => i.n > 0).map((i) => (
          <div
            key={i.key}
            onMouseEnter={() => setHover(i.key)}
            onMouseLeave={() => setHover(null)}
            className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(i.n / total) * 100}%`, background: i.color, opacity: hover && hover !== i.key ? 0.35 : 1 }}
            title={`${i.label}: ${i.n.toLocaleString()} (${pct(i.n, total)}%)`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((i) => (
          <li key={i.key} onMouseEnter={() => setHover(i.key)} onMouseLeave={() => setHover(null)} className={cx("flex items-center gap-2 rounded-md text-[12px] transition-opacity", hover && hover !== i.key && "opacity-50")}>
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: i.color }} />
            <span className="flex-1 text-ink-2">{i.label}</span>
            <span className="tabular-nums text-ink">{i.n.toLocaleString()}</span>
            <span className="w-9 text-right tabular-nums text-muted">{pct(i.n, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DailyBars({ daily }: { daily: OverviewData["daily"] }) {
  const days = useMemo(() => {
    const map = new Map(daily.map((d) => [d.day, d]));
    const out: { day: string; enriched: number; emails: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      out.push({ day: d, enriched: Number(map.get(d)?.enriched ?? 0), emails: Number(map.get(d)?.emails ?? 0) });
    }
    return out;
  }, [daily]);
  const max = Math.max(1, ...days.map((d) => d.enriched));
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? days[hover] : null;
  const ticks = [max, Math.round(max / 2), 0];

  return (
    <div>
      <div className="mb-2 h-5 text-[12px] text-ink-2">
        {h ? (
          <>
            <span className="font-medium text-ink">{new Date(h.day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span> · {h.enriched.toLocaleString()} enriched · {h.emails.toLocaleString()} with founder email
          </>
        ) : (
          <span className="text-muted">{days.reduce((a, d) => a + d.enriched, 0).toLocaleString()} leads enriched in 14 days</span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between pb-5 text-right text-[10.5px] tabular-nums text-muted">
          {ticks.map((t, i) => (
            <span key={i}>{t.toLocaleString()}</span>
          ))}
        </div>
        <div className="relative flex-1">
          {/* recessive grid */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[140px] flex-col justify-between">
            {ticks.map((_, i) => (
              <div key={i} className="border-t border-dashed border-line" />
            ))}
          </div>
          <div className="relative flex h-40 items-end gap-[2px]">
            {days.map((d, i) => (
              <div key={d.day} className="flex h-full flex-1 cursor-default flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className="flex h-[140px] w-full items-end justify-center">
                  <div
                    className={cx("w-full max-w-[22px] rounded-t-[4px] transition-colors", hover === i ? "bg-ink" : "bg-[#3d3d3d]")}
                    style={{ height: d.enriched ? `${Math.max(2, (d.enriched / max) * 100)}%` : 0, opacity: hover !== null && hover !== i ? 0.45 : 1 }}
                  />
                </div>
                <div className="mt-1.5 h-3.5 text-[10px] text-muted">{i % 2 === 1 ? new Date(d.day + "T00:00:00").getDate() : ""}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

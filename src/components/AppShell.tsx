"use client";

import { motion } from "motion/react";
import { FileSpreadsheet, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plus, Send, Settings2, Sparkles, Table2, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, timeAgo } from "@/lib/client";
import type { Upload } from "@/lib/types";
import { UploadModal } from "./UploadModal";
import { Meter, PixelLoader, cx } from "./ui";

export interface UsageItem {
  provider: string;
  used: number;
  limit: number | null;
  exhausted: boolean;
}

interface AppState {
  uploads: Upload[] | null;
  uploadsError: string | null;
  refreshUploads: () => Promise<Upload[]>;
  openUpload: () => void;
  usage: UsageItem[];
  refreshUsage: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppShell");
  return ctx;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageItem[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Remember the sidebar state; Ctrl/Cmd+B toggles it.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("le:sidebar") === "collapsed");
    } catch {}
  }, []);
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("le:sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const refreshUploads = useCallback(async () => {
    try {
      const list = await api<Upload[]>("/api/uploads");
      setUploads(list);
      setUploadsError(null);
      return list;
    } catch (e) {
      setUploads([]);
      setUploadsError((e as Error).message);
      return [];
    }
  }, []);

  const refreshUsage = useCallback(() => {
    api<{ usage: UsageItem[] }>("/api/credits?live=0").then((r) => setUsage(r.usage)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshUploads();
    refreshUsage();
    const t = setInterval(() => !document.hidden && refreshUsage(), 30_000);
    return () => clearInterval(t);
  }, [refreshUploads, refreshUsage]);

  const value: AppState = { uploads, uploadsError, refreshUploads, openUpload: () => setShowUpload(true), usage, refreshUsage };

  return (
    <AppContext.Provider value={value}>
      <div className="flex h-screen overflow-hidden bg-white text-ink">
        <Suspense fallback={<aside className={cx("shrink-0 border-r border-line bg-panel/70", collapsed ? "w-14" : "w-60")} />}>
          <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
        </Suspense>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onImported={async (id) => {
          setShowUpload(false);
          await refreshUploads();
          router.push(`/leads?u=${id}&imported=1`);
        }}
      />
    </AppContext.Provider>
  );
}

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Table2 },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { uploads, refreshUploads, openUpload, usage } = useApp();
  const activeUpload = pathname === "/leads" ? params.get("u") ?? uploads?.[0]?.id : null;

  async function remove(u: Upload) {
    if (!confirm(`Delete "${u.filename}" and all its enriched data? This can't be undone.`)) return;
    await api(`/api/uploads/${u.id}`, { method: "DELETE" });
    const list = await refreshUploads();
    if (u.id === activeUpload) router.push(list[0] ? `/leads?u=${list[0].id}` : "/leads");
  }

  const toggleLabel = `${collapsed ? "Open" : "Close"} sidebar (Ctrl+B)`;

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 56 : 240 }}
      transition={{ type: "spring", stiffness: 420, damping: 40 }}
      className="flex shrink-0 flex-col overflow-hidden border-r border-line bg-panel/70"
    >
      <div className={cx("flex items-center pb-4 pt-4", collapsed ? "flex-col gap-3" : "gap-2 px-4")}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <Sparkles size={14} />
        </div>
        {!collapsed && <div className="flex-1 whitespace-nowrap text-[14px] font-semibold tracking-tight">Leadit</div>}
        <button onClick={onToggle} className="rounded-md p-1.5 text-muted hover:bg-white hover:text-ink" title={toggleLabel} aria-label={toggleLabel}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <nav className="space-y-0.5 px-2">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              title={collapsed ? n.label : undefined}
              className={cx("relative flex items-center gap-2.5 rounded-lg py-1.5 text-[13px] font-medium", collapsed ? "justify-center" : "px-2.5", active ? "text-ink" : "text-ink-2 hover:text-ink")}
            >
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <n.icon size={15} className="relative shrink-0 text-muted" />
              {!collapsed && <span className="relative whitespace-nowrap">{n.label}</span>}
            </Link>
          );
        })}
      </nav>

      {collapsed && (
        <>
          <div className="mx-3 my-4 border-t border-line" />
          <div className="flex justify-center">
            <button onClick={openUpload} className="rounded-lg p-2 text-muted hover:bg-white hover:text-ink" title="New upload">
              <Plus size={15} />
            </button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pt-1">
            {uploads?.map((u) => (
              <Link
                key={u.id}
                href={`/leads?u=${u.id}`}
                title={`${u.filename} · ${u.total_rows.toLocaleString()} rows`}
                className={cx("flex justify-center rounded-lg py-2", u.id === activeUpload ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-line" : "text-muted hover:text-ink")}
              >
                <FileSpreadsheet size={15} />
              </Link>
            ))}
          </div>
        </>
      )}

      {!collapsed && <>
      <div className="mt-5 flex items-center justify-between px-4 pb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Uploads</span>
        <button onClick={openUpload} className="rounded-md p-1 text-muted hover:bg-white hover:text-ink" title="New upload">
          <Plus size={13} />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {uploads === null && (
          <div className="px-2 py-2">
            <PixelLoader />
          </div>
        )}
        {uploads?.length === 0 && (
          <button onClick={openUpload} className="w-full rounded-lg border border-dashed border-line-strong px-3 py-3 text-left text-[12px] text-muted hover:bg-white">
            Import your first CSV or Excel file
          </button>
        )}
        {uploads?.map((u) => {
          const active = u.id === activeUpload;
          return (
            <div key={u.id} className="group relative">
              <Link href={`/leads?u=${u.id}`} className={cx("relative flex items-start gap-2 rounded-lg px-2 py-1.5", active ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-line" : "text-ink-2 hover:text-ink")}>
                <FileSpreadsheet size={14} className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{u.filename}</span>
                  <span className="block text-[11px] text-muted">
                    {u.total_rows.toLocaleString()} rows · {timeAgo(u.created_at)}
                  </span>
                </span>
              </Link>
              <button onClick={() => remove(u)} className="absolute right-1.5 top-1.5 hidden rounded p-1 text-muted hover:bg-panel-2 hover:text-[#b4403b] group-hover:block" title="Delete upload">
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <Link href="/settings?tab=credits" className="m-3 block rounded-lg border border-transparent p-2.5 hover:border-line hover:bg-white">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Credits this month</div>
        <div className="space-y-2">
          {usage.filter((u) => u.limit).map((u) => (
            <div key={u.provider}>
              <div className="mb-1 flex justify-between text-[11.5px]">
                <span className={cx("text-ink-2", u.exhausted && "text-[#b4403b]")}>{providerLabel(u.provider)}</span>
                <span className="tabular-nums text-muted">
                  {u.used.toLocaleString()}/{u.limit!.toLocaleString()}
                </span>
              </div>
              <Meter value={u.exhausted ? u.limit! : u.used} max={u.limit!} />
            </div>
          ))}
        </div>
      </Link>
      </>}
    </motion.aside>
  );
}

export function providerLabel(p: string) {
  return ({ firecrawl: "Firecrawl", hunter_search: "Hunter searches", hunter_verify: "Verifications", apollo: "Apollo", groq: "Groq" } as Record<string, string>)[p] ?? p;
}

/** Standard page header used by every page. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 pb-4 pt-5">
      <div className="min-w-0">
        <h1 className="truncate text-[18px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

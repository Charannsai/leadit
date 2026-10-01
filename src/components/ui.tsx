"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost";

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-accent text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-[#333]",
        variant === "secondary" && "border border-line-strong bg-white text-ink hover:bg-panel",
        variant === "ghost" && "text-ink-2 hover:bg-panel-2 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PixelLoader({ className }: { className?: string }) {
  const delays = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 0.5];
  return (
    <span className={cx("pixel-loader", className)} aria-label="Loading">
      {delays.map((d, i) => (
        <span key={i} style={{ animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}

const TONES = {
  neutral: "bg-panel-2 text-ink-2",
  dark: "bg-accent text-white",
  green: "bg-[#ecf7ef] text-[#2f7a45]",
  amber: "bg-[#fdf4e3] text-[#946215]",
  red: "bg-[#fdeeee] text-[#b4403b]",
  blue: "bg-[#eef3fd] text-[#3b5fb4]",
  violet: "bg-[#f3effd] text-[#6a48b4]",
};

export function Pill({ tone = "neutral", children, dot, className }: { tone?: keyof typeof TONES; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function StatusPill({ status, stage }: { status: string; stage?: string | null }) {
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-2 text-[12px]">
        <PixelLoader />
        <span className="shimmer-text font-medium">{stage || "Working"}…</span>
      </span>
    );
  const map: Record<string, [keyof typeof TONES, string]> = {
    new: ["neutral", "Not enriched"],
    queued: ["blue", "Queued"],
    done: ["green", "Enriched"],
    failed: ["red", "Failed"],
    paused: ["amber", "Paused"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Pill tone={tone} dot>{label}</Pill>;
}

export function EmailStatus({ status }: { status?: string | null }) {
  if (!status) return null;
  const map: Record<string, [keyof typeof TONES, string]> = {
    valid: ["green", "Verified"],
    accept_all: ["amber", "Catch-all"],
    invalid: ["red", "Invalid"],
    unknown: ["neutral", "Unknown"],
    unverified: ["neutral", "Unverified"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Pill tone={tone}>{label}</Pill>;
}

export function Modal({ open, onClose, children, width = 720, title }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; title?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/10 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_60px_-12px_rgba(0,0,0,0.18)]"
            style={{ maxWidth: width }}
            initial={{ y: 12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 8, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            {title && (
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <div className="text-[14px] font-semibold">{title}</div>
                <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel hover:text-ink" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({ open, onClose, children, expanded = false }: { open: boolean; onClose: () => void; children: ReactNode; expanded?: boolean }) {
  const [vw, setVw] = useState(1440);
  useEffect(() => {
    const update = () => setVw(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // Anchored to the right; expanding grows the width to fill the window.
  const width = expanded ? vw - 16 : Math.min(520, vw - 16);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: expanded ? 0.12 : 0.04 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="scroll-thin fixed inset-y-2 right-2 z-50 overflow-y-auto rounded-2xl border border-line bg-white shadow-[0_24px_60px_-12px_rgba(0,0,0,0.18)]"
            initial={{ x: 40, opacity: 0, width }}
            animate={{ x: 0, opacity: 1, width }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-[18px] w-8 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
      >
        <motion.span className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow" animate={{ left: checked ? 16 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
      </button>
    </label>
  );
}

export function Meter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx("h-1 w-full overflow-hidden rounded-full bg-panel-2", className)}>
      <motion.div className={cx("h-full rounded-full", pct > 90 ? "bg-[#c4554f]" : "bg-ink")} initial={false} animate={{ width: `${pct}%` }} />
    </div>
  );
}

export function LinkedInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

export function XIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded border border-line bg-panel px-1 font-mono text-[10.5px] text-muted">{children}</span>;
}

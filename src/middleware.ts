import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

// Optional password gate: active only when APP_PASSWORD is set (do set it on Vercel).
export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const { pathname } = req.nextUrl;

  // The worker calls itself with the shared secret.
  if (pathname === "/api/worker") {
    const secretOk = !!process.env.WORKER_SECRET && req.headers.get("x-worker-secret") === process.env.WORKER_SECRET;
    const cronOk = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
    if (secretOk || cronOk) return NextResponse.next();
    if (!password) return NextResponse.next();
  }

  if (!password || pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  if (req.cookies.get(AUTH_COOKIE)?.value === (await authToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HIGH_RISK_PREFIXES = [
  "/api/advert",
  "/api/ai-diary",
  "/api/bid-automation",
  "/api/settings",
  "/api/wb",
  "/api/clusters",
];
const DEBUG_PREFIXES = [
  "/api/debug",
  "/api/wb/sniff/debug",
  "/api/wb/sniff/test",
];
const FREEZE_MUTATION_PREFIXES = [
  "/api/advert",
  "/api/bid-automation",
  "/api/sync",
  "/api/wb",
];

function hostnameFromHost(host: string): string {
  const raw = host.trim().toLowerCase();
  if (raw.startsWith("[")) return raw.slice(0, raw.indexOf("]") + 1);
  return raw.split(":")[0] || "";
}

function sameOriginHeader(value: string | null, expectedOrigin: string): boolean {
  if (!value) return false;
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function sameOriginFetchMetadata(req: NextRequest): boolean {
  return req.headers.get("sec-fetch-site") === "same-origin";
}

function hasValidLocalToken(req: NextRequest): boolean {
  const expected = process.env.WB_ADS_LOCAL_TOKEN;
  if (!expected) return false;
  return req.headers.get("x-local-token") === expected;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function hasValidBasicAuth(req: NextRequest): boolean {
  const expectedUser = process.env.WB_ADS_BASIC_AUTH_USER;
  const expectedPassword = process.env.WB_ADS_BASIC_AUTH_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;

  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return false;

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const splitAt = decoded.indexOf(":");
    if (splitAt < 0) return false;
    const user = decoded.slice(0, splitAt);
    const password = decoded.slice(splitAt + 1);
    return safeEqual(user, expectedUser) && safeEqual(password, expectedPassword);
  } catch {
    return false;
  }
}

function basicAuthRequired(message = "authentication required") {
  return new NextResponse(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="WB Ads", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(req: NextRequest) {
  const hostHeader = req.headers.get("host") || "";
  const hostName = hostnameFromHost(hostHeader);
  const publicAccess = process.env.WB_ADS_PUBLIC_ACCESS === "1";
  if (!LOCAL_HOSTS.has(hostName) && !publicAccess) {
    return NextResponse.json({ ok: false, error: "local host only" }, { status: 403 });
  }

  if (!LOCAL_HOSTS.has(hostName) && publicAccess) {
    if (!process.env.WB_ADS_BASIC_AUTH_USER || !process.env.WB_ADS_BASIC_AUTH_PASSWORD) {
      return new NextResponse("public authentication is not configured", { status: 503 });
    }
    if (!hasValidBasicAuth(req)) return basicAuthRequired();
  }

  const path = req.nextUrl.pathname;
  const isSniffClear = path === "/api/wb/sniff" && req.nextUrl.searchParams.get("mode") === "clear";
  const isUnsafe = !SAFE_METHODS.has(req.method) || isSniffClear;
  const localTokenValid = LOCAL_HOSTS.has(hostName) && hasValidLocalToken(req);
  if (localTokenValid) return NextResponse.next();

  if (process.env.WB_ADS_FREEZE_MODE === "1" && isUnsafe) {
    const blocked =
      path === "/api/auto-sync" ||
      FREEZE_MUTATION_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
    if (blocked) {
      return NextResponse.json({ ok: false, error: "migration freeze: mutations are disabled" }, { status: 423 });
    }
  }

  const allowDebug = process.env.WB_ADS_ENABLE_DEBUG === "1";
  if (!allowDebug && DEBUG_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.json({ ok: false, error: "debug endpoints disabled" }, { status: 404 });
  }

  const expectedOrigin = req.nextUrl.origin;
  const sameOrigin =
    sameOriginHeader(req.headers.get("origin"), expectedOrigin) ||
    sameOriginHeader(req.headers.get("referer"), expectedOrigin) ||
    sameOriginFetchMetadata(req);

  if (!isUnsafe) return NextResponse.next();

  if (sameOrigin) return NextResponse.next();

  // Internal server-to-server sync calls use localhost fetch without Origin/Referer.
  // Keep them working, but require browser-origin proof or token for high-risk control APIs.
  if (!HIGH_RISK_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  return NextResponse.json({ ok: false, error: "same-origin request required" }, { status: 403 });
}

export const config = {
  matcher: "/:path*",
};

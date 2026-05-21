import { NextResponse } from "next/server";
import { verifyAccessToken } from "./lib/auth";

const PROTECTED = [
  "/api/orders",
  "/api/vendor",
  "/api/driver",
  "/api/admin",
  "/api/loyalty",
  "/api/notifications",
];

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = verifyAccessToken(token);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", payload.sub);
    requestHeaders.set("x-user-role", payload.role);
    requestHeaders.set("x-user-country", payload.country);
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json({ error: "Token expired" }, { status: 401 });
  }
}

export const config = { matcher: ["/api/:path*"] };

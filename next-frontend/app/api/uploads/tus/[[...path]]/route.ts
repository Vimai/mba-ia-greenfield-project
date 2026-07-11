import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import { withRefresh } from "@/lib/auth/refresh";

export const runtime = "nodejs";

const UPSTREAM_TUS_PATH = "/uploads/tus";
const PROXY_TUS_PATH = "/api/uploads/tus";
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD", "OPTIONS", "DELETE"]);

type RouteContext = { params: Promise<{ path?: string[] }> };

function buildUpstreamUrl(request: NextRequest, path: string[] | undefined): string {
  const suffix = path && path.length > 0 ? `/${path.join("/")}` : "";
  return `${env.API_URL}${UPSTREAM_TUS_PATH}${suffix}${request.nextUrl.search}`;
}

// Nest's tus server signs its Location using whatever host it saw the request
// come from (this BFF's own fetch call, e.g. "nestjs-api:3000") — rewrite it
// to the browser-facing proxy origin/prefix so the tus client stays same-origin.
function rewriteLocationToProxy(nestLocation: string, request: NextRequest): string {
  const nestUrl = new URL(nestLocation);
  const rewrittenPath = nestUrl.pathname.replace(UPSTREAM_TUS_PATH, PROXY_TUS_PATH);
  return new URL(`${rewrittenPath}${nestUrl.search}`, request.nextUrl.origin).toString();
}

async function proxyToUpstream(
  request: NextRequest,
  { params }: RouteContext,
): Promise<Response> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accessToken) {
    return NextResponse.json(
      { statusCode: 401, error: "UNAUTHORIZED", message: "Unauthorized" },
      { status: 401 },
    );
  }

  const { path } = await params;
  const upstreamUrl = buildUpstreamUrl(request, path);

  // NextRequest's `.headers` is not an eager snapshot: reading `.body` later
  // (below, for streaming) resets it if we hold onto a `Headers` wrapping the
  // live request. Materialize entries into a plain array first so the copy
  // is fully independent of the request's internal streaming state.
  const headerEntries = [...request.headers.entries()];
  const headers = new Headers(headerEntries);
  headers.set("authorization", `Bearer ${session.accessToken}`);
  headers.delete("host");
  headers.delete("content-length");

  const hasBody = !METHODS_WITHOUT_BODY.has(request.method);

  const upstreamResponse = await withRefresh(() =>
    fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
    } as RequestInit),
  );

  const responseHeaders = new Headers(upstreamResponse.headers);
  const location = responseHeaders.get("location");
  if (location) {
    responseHeaders.set("location", rewriteLocationToProxy(location, request));
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  return proxyToUpstream(request, ctx);
}

export async function HEAD(request: NextRequest, ctx: RouteContext) {
  return proxyToUpstream(request, ctx);
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  return proxyToUpstream(request, ctx);
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  return proxyToUpstream(request, ctx);
}

export async function OPTIONS(request: NextRequest, ctx: RouteContext) {
  return proxyToUpstream(request, ctx);
}

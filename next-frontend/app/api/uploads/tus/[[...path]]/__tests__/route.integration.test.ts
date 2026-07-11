import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import type { SessionData } from "@/lib/auth/session";

const cookieMap = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) =>
      cookieMap.has(name) ? { name, value: cookieMap.get(name)! } : undefined,
    set: (name: string, value: string) => {
      cookieMap.set(name, value);
    },
    delete: (name: string) => {
      cookieMap.delete(name);
    },
  }),
}));

let POST: (
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) => Promise<Response>;
let HEAD: typeof POST;
let setSession: (data: Omit<SessionData, "isLoggedIn">) => Promise<void>;

beforeAll(async () => {
  ({ POST, HEAD } = await import("@/app/api/uploads/tus/[[...path]]/route"));
  ({ setSession } = await import("@/lib/auth/session"));
});

beforeEach(() => {
  cookieMap.clear();
});

function makeRequest(
  method: string,
  headers: Record<string, string> = {},
  body?: BodyInit,
): NextRequest {
  const init: Record<string, unknown> = { method, headers, body };
  if (body) init.duplex = "half";
  return new NextRequest("http://localhost/api/uploads/tus", init as never);
}

async function loginSession() {
  await setSession({
    accessToken: "at-abc123",
    refreshToken: "rt-xyz",
    userId: "user-1",
    email: "alice@example.com",
    channelSlug: "alice-channel",
  });
}

describe("tus BFF proxy /api/uploads/tus", () => {
  it("forwards method, tus headers, and body to the upstream with a Bearer token", async () => {
    let captured: { authorization: string | null; tusResumable: string | null; body: string } | null =
      null;

    server.use(
      http.post(`${env.API_URL}/uploads/tus`, async ({ request }) => {
        captured = {
          authorization: request.headers.get("authorization"),
          tusResumable: request.headers.get("tus-resumable"),
          body: await request.text(),
        };
        return new HttpResponse(null, {
          status: 201,
          headers: { Location: `${env.API_URL}/uploads/tus/abc123` },
        });
      }),
    );

    await loginSession();

    const res = await POST(
      makeRequest(
        "POST",
        {
          "tus-resumable": "1.0.0",
          "upload-length": "4",
          "upload-metadata": "filename bXAudGVzdA==",
        },
        "1234",
      ),
      { params: Promise.resolve({ path: undefined }) },
    );

    expect(res.status).toBe(201);
    expect(captured).not.toBeNull();
    expect(captured!.authorization).toBe("Bearer at-abc123");
    expect(captured!.tusResumable).toBe("1.0.0");
    expect(captured!.body).toBe("1234");
  });

  it("rewrites the Location header to the proxy's own host and /api prefix", async () => {
    server.use(
      http.post(`${env.API_URL}/uploads/tus`, () =>
        new HttpResponse(null, {
          status: 201,
          headers: { Location: `${env.API_URL}/uploads/tus/encoded-id-123` },
        }),
      ),
    );

    await loginSession();

    const res = await POST(
      makeRequest("POST", { "tus-resumable": "1.0.0", "upload-length": "4" }, "1234"),
      { params: Promise.resolve({ path: undefined }) },
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost/api/uploads/tus/encoded-id-123",
    );
  });

  it("returns 401 without a session and never calls the upstream", async () => {
    let upstreamCalled = false;
    server.use(
      http.head(`${env.API_URL}/uploads/tus/some-id`, () => {
        upstreamCalled = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const res = await HEAD(
      makeRequest("HEAD", { "tus-resumable": "1.0.0" }),
      { params: Promise.resolve({ path: ["some-id"] }) },
    );

    expect(res.status).toBe(401);
    expect(upstreamCalled).toBe(false);
  });
});

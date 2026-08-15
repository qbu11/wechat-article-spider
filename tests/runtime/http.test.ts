import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetchText } from "../../packages/runtime/http.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safeFetchText hardening", () => {
  const publicLookup = async () => [{ address: "203.0.113.10" }];
  it.each([
    "https://127.0.0.1/private",
    "https://localhost/private",
    "https://user:secret@example.com/private",
  ])("rejects unsafe target %s before fetch", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetchText(url)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revalidates every redirect and blocks a redirect to localhost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://localhost/admin" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      safeFetchText("https://public.test/start", {
        allowedHosts: new Set(["public.test", "localhost"]),
        lookupAddresses: publicLookup,
      }),
    ).rejects.toThrow("Local network hosts are not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops reading when the response exceeds the byte limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("123456789", { status: 200 })));
    await expect(
      safeFetchText("https://public.test/large", {
        allowedHosts: new Set(["public.test"]),
        lookupAddresses: publicLookup,
        maxBytes: 4,
      }),
    ).rejects.toThrow("Response exceeds the 4 byte limit");
  });

  it("honors an already-aborted caller signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        if (init.signal?.aborted) throw init.signal.reason;
        return new Response("unexpected");
      }),
    );
    await expect(
      safeFetchText("https://public.test/cancel", {
        allowedHosts: new Set(["public.test"]),
        lookupAddresses: publicLookup,
        signal: controller.signal,
      }),
    ).rejects.toThrow("caller cancelled");
  });

  it("returns upstream error statuses without disguising them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    const response = await safeFetchText("https://public.test/rate", {
      allowedHosts: new Set(["public.test"]),
      lookupAddresses: publicLookup,
    });
    expect(response.status).toBe(429);
    expect(response.body).toBe("rate limited");
  });

  it.each(["127.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fe80::1", "febf::1"])(
    "rejects private DNS answers even for an allowlisted host: %s",
    async (address) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(safeFetchText("https://public.test/private", {
        allowedHosts: new Set(["public.test"]),
        lookupAddresses: async () => [{ address }],
      })).rejects.toThrow("private or unavailable");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

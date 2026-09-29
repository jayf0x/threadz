import { afterEach, expect, jest, mock, test } from "bun:test";

// The engine reads the backend URL from device settings and the phone db from a Worker; neither is under test.
mock.module("./config", () => ({ getBackendUrl: () => "http://backend.test" }));
mock.module("./data", () => ({ getPhoneDb: async () => ({ driver: {} }) }));
const { checkReachable, syncNow, UNREACHABLE_MESSAGE } = await import("./syncEngine");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const calls: string[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push(String(url));
    return impl(String(url), init);
  }) as typeof fetch;
  return calls;
};

test("checkReachable: true only for an ok answer", async () => {
  mockFetch(async () => new Response("{}", { status: 200 }));
  expect(await checkReachable()).toBe(true);
  mockFetch(async () => new Response("no", { status: 502 }));
  expect(await checkReachable()).toBe(false);
  mockFetch(async () => {
    throw new TypeError("network down");
  });
  expect(await checkReachable()).toBe(false);
});

test("checkReachable gives up on a hung backend after its short timeout", async () => {
  jest.useFakeTimers();
  mockFetch(
    (_url, init) =>
      new Promise((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))),
      ),
  );
  const pending = checkReachable();
  jest.advanceTimersByTime(3_001);
  expect(await pending).toBe(false);
});

test("syncNow stops at the reachability check: no push or pull when the backend is down", async () => {
  const calls = mockFetch(async () => {
    throw new TypeError("network down");
  });
  await expect(syncNow()).rejects.toThrow(UNREACHABLE_MESSAGE);
  expect(calls.every((u) => u.endsWith("/api/health"))).toBe(true);
});

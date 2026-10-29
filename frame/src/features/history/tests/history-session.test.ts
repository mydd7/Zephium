import { beforeEach, expect, test, vi } from "vitest";
import type { HistoryResponse, HistoryVisitView } from "$shared/ipc/bindings";
import { HistorySession, historySession } from "../lib/history-session.svelte";

const native = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ historyCall: native.call });
});

beforeEach(() => vi.resetAllMocks());

test("a listing begun before Forget cannot bring deleted visits back", async () => {
  const visit: HistoryVisitView = {
    id: "1",
    url: "https://example.com/",
    title: "Example",
    visited_at: "1",
    icon: null,
  };
  let resolve!: (response: HistoryResponse) => void;
  native.call.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const session = new HistorySession("profile");
  const listing = session.start();
  const kept = { ...visit, id: "2", url: "https://kept.example/" };
  native.call
    .mockResolvedValueOnce({ kind: "removed", count: 1 })
    .mockResolvedValueOnce({ kind: "page", visits: [kept], next: "2" });
  await session.forget([visit.url]);
  resolve({ kind: "page", visits: [visit], next: null });
  await listing;
  expect(session.visits).toEqual([kept]);
  expect(session.exhausted).toBe(false);
  expect(session.loading).toBe(false);
  session.stop();
});

test("stopping the session while Forget is pending does not start another listing", async () => {
  native.call.mockResolvedValueOnce({ kind: "page", visits: [], next: null });
  const session = new HistorySession("profile");
  await session.start();
  native.call.mockReturnValueOnce(new Promise(() => {}));
  const forgetting = session.forget(["https://example.com/"]);
  session.stop();
  await forgetting;
  expect(native.call).toHaveBeenCalledTimes(2);
  expect(session.error).toBeNull();
});

test.each(["forget", "clear"] as const)(
  "closing during %s leaves the cached session usable",
  async (kind) => {
    const host = `closing-${kind}`;
    const session = historySession("profile", host);
    native.call.mockResolvedValueOnce({ kind: "page", visits: [], next: null });
    await session.start();
    native.call.mockReturnValueOnce(new Promise(() => {}));
    const pending = kind === "forget" ? session.forget(["https://example.com/"]) : session.clear();
    expect(session.busy).toBe(true);
    session.stop();
    await pending;
    expect(session.busy).toBe(false);
    expect(session.error).toBeNull();
    expect(historySession("profile", host)).toBe(session);
    native.call.mockResolvedValueOnce({ kind: "page", visits: [], next: null });
    await session.start();
    const previousCalls = native.call.mock.calls.length;
    native.call
      .mockResolvedValueOnce({ kind: "removed", count: 1 })
      .mockResolvedValueOnce({ kind: "page", visits: [], next: null });
    await session.clear();
    expect(native.call.mock.calls.slice(previousCalls).map(([, call]) => call.kind)).toEqual([
      "clear",
      "page",
    ]);
    expect(session.busy).toBe(false);
    expect(session.error).toBeNull();
    session.stop();
  },
);

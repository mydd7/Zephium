import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { HistoryResponse, HistoryVisitView } from "$shared/ipc/bindings";
import { HistorySession } from "../lib/history-session.svelte";

const native = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ historyCall: native.call });
});

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

test.each(["page", "error"])(
  "a prior query's %s reply is ignored during debounce",
  async (kind) => {
    vi.useFakeTimers();
    const oldVisit: HistoryVisitView = {
      id: "1",
      url: "https://old.example/",
      title: "Old",
      visited_at: "1",
      icon: null,
    };
    let finish!: (response: HistoryResponse) => void;
    native.call.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const session = new HistorySession("profile");
    const pending = session.start("old");
    session.search("new");
    finish(
      kind === "page"
        ? { kind: "page", visits: [oldVisit], next: "1" }
        : { kind: "error", error: "unavailable" },
    );
    await pending;
    expect(session.visits).toEqual([]);
    expect(session.error).toBeNull();
    expect(session.exhausted).toBe(true);
    const next = { ...oldVisit, id: "2", title: "New", url: "https://new.example/" };
    native.call.mockResolvedValueOnce({ kind: "page", visits: [next], next: null });
    await vi.advanceTimersByTimeAsync(180);
    expect(native.call).toHaveBeenLastCalledWith(
      "profile",
      expect.objectContaining({ kind: "page", query: "new", before: null }),
    );
    expect(session.visits).toEqual([next]);
    expect(session.loading).toBe(false);
    session.stop();
  },
);

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

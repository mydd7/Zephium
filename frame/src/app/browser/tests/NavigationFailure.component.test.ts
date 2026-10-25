import "$styles/global.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { emitNativeEvent } from "$shared/testing/native-events";
import { tabFixture, revision, spaceFixture } from "$shared/testing/fixtures";
import { tabs } from "$domain/tabs";
import { surface } from "$domain/surface";
import Shell from "../Shell.svelte";

const { navigate } = vi.hoisted(() => ({
  navigate: vi.fn(async () => ({ operation_id: "retry", accepted: true })),
}));

vi.mock("../WorkWorkspace.svelte", async () => await import("./StageStub.svelte"));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ tabsBootstrap: async () => {}, tabsNavigate: navigate });
});

afterEach(() => {
  surface.dispose();
  tabs.dispose();
});

test("a failed restored tab shows an error until a new view is created", async () => {
  await surface.init();
  await tabs.init();
  const url = "http://127.0.0.1:7474/";
  const tab = tabFixture({
    url,
    title: "Page failed to open",
    availability: { state: "sleeping" },
    failure: { url, reason: "unreachable" },
  });
  const base = {
    profile: { id: "profile", name: "Personal", kind: "default" as const },
    spaces: [spaceFixture("space", "Home")],
    active_space_id: "space",
    nodes: [],
    split_group: null,
    active: tab.id,
  };
  emitNativeEvent("itemsChanged", {
    ...base,
    projection_revision: revision(10),
    tabs: [tab],
  });
  const screen = await render(Shell);
  await expect.poll(() => screen.container.querySelector(".failed-page")).not.toBeNull();
  expect(screen.container.querySelector(".failed-page")?.textContent).toContain("127.0.0.1:7474");
  expect(screen.container.querySelector(".failed-page button")).not.toBeNull();
  (screen.container.querySelector(".failed-page button") as HTMLButtonElement).click();
  expect(navigate).toHaveBeenCalledWith(tab.id, url);

  // A failed navigation over a live page must leave that page showing.
  emitNativeEvent("itemsChanged", {
    ...base,
    projection_revision: revision(11),
    tabs: [{ ...tab, projection_revision: revision(11), availability: null }],
  });
  await expect.poll(() => screen.container.querySelector(".failed-page")).toBeNull();
});

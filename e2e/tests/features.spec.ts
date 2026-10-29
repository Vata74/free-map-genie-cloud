import { expect, type Page } from "@playwright/test";

import { test } from "../helpers/fixtures";
import { MapPage } from "../pages/map";

// A real Factory location (a poster). It has to exist on the map: saved marks
// for locations that aren't on the map are not shown.
const MARK_ID = 939360;

// The map's markers (and so the restored marks) arrive a moment after the
// page loads, so wait for the mark instead of checking once.
const markShown = (page: Page) =>
  expect.poll(
    () => page.evaluate((id) => !!window.user?.locations?.[id], MARK_ID),
    { timeout: 20000 }
  );

const openMap = async (page: Page) => {
  const mapPage = new MapPage(page);
  await mapPage.gotoTarkovFactoryMap();
  await mapPage.waitForAxiosInterceptor();
  await mapPage.waitForUserDataLoaded();
  return mapPage;
};

// The popup is embedded in the page itself (it's web-accessible for exactly
// that), so it sees the map as its active tab, same as when you click the
// toolbar icon.
const openPopupFrame = async (page: Page, extensionId: string) => {
  await page.evaluate((id) => {
    const frame = document.createElement("iframe");
    frame.id = "fmg-popup";
    frame.src = `chrome-extension://${id}/popup.html`;
    frame.style.cssText =
      "position:fixed;top:0;right:0;width:420px;height:600px;z-index:99999999;border:0;background:#222";
    document.body.appendChild(frame);
  }, extensionId);
  const frame = page.frameLocator("#fmg-popup");
  await frame.getByTitle("profiles").waitFor({ timeout: 15000 });
  return frame;
};

// Right after the page loads, the extension may not have saved the account
// yet, and a popup that was already open doesn't refresh itself. So, like a
// person would, close and reopen it a few times before calling it broken.
const openPopupWhen = async (
  page: Page,
  extensionId: string,
  tab: "profiles" | "data",
  ready: (frame: ReturnType<Page["frameLocator"]>) => Promise<boolean>
) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(() => document.getElementById("fmg-popup")?.remove());
    const frame = await openPopupFrame(page, extensionId);
    await frame.getByTitle(tab).click();
    await page.waitForTimeout(1500);
    if (await ready(frame).catch(() => false)) return frame;
    await page.waitForTimeout(2500);
  }
  throw new Error(`The popup's ${tab} tab never became ready`);
};

const activeTab = (frame: ReturnType<Page["frameLocator"]>) =>
  frame.locator('[class*="tab-view-container"][class*="active"]');

const markLocation = async (mapPage: MapPage) => {
  // The mark handler is registered a moment after the interceptor itself
  // exists, so retry briefly instead of racing it.
  await expect(async () => {
    await mapPage.axios.put(`/api/v1/user/locations/${MARK_ID}`);
  }).toPass({ timeout: 10000, intervals: [500, 1000, 1500] });
};

const reloadingPost = async (page: Page, url: string, data: unknown) => {
  await Promise.all([
    page.waitForEvent("load", { timeout: 30000 }),
    page.evaluate(
      ({ url, data }) => window.axios!.post(url, data).catch(() => {}),
      { url, data }
    ),
  ]);
  const mapPage = new MapPage(page);
  await mapPage.waitForAxiosInterceptor();
  await mapPage.waitForUserDataLoaded();
};

test.describe("Extension features", () => {
  test("Map loads with the extension running", async ({ page }) => {
    await openMap(page);
    const state = await page.evaluate(() => ({
      user: !!window.user,
      map: !!window.mapData,
    }));
    expect(state).toEqual({ user: true, map: true });
  });

  test("Locked map links are unlocked on a map page", async ({ page }) => {
    await openMap(page);
    // The links that point to the upgrade page for a free account have to be
    // turned into real map links, otherwise clicking one shows the paywall.
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#left-sidebar a.map-link").length > 0 &&
        ![...document.querySelectorAll("#left-sidebar a.map-link")].some((a) =>
          (a as HTMLAnchorElement).href.endsWith("/upgrade")
        ),
      undefined,
      { timeout: 15000 }
    );
    const unlocked = await page.evaluate(
      () =>
        [...document.querySelectorAll("#left-sidebar a.map-link")].filter((a) =>
          (a as HTMLAnchorElement).href.includes("fmgMapId=")
        ).length
    );
    expect(unlocked).toBeGreaterThan(0);
  });

  test("Pro maps show their markers", async ({ page }) => {
    // Reserve (map 75) is a real Pro map. MapGenie's own first data request
    // comes back empty for a free account, so this only passes while the
    // extension keeps the markers it loaded (fix from NR2BJ's 3.0.14).
    await page.goto("https://mapgenie.io/tarkov/maps/factory?fmgMapId=75");
    await page.waitForFunction(() => window.mapData?.map?.id === 75, undefined, {
      timeout: 30000,
    });
    await expect
      .poll(() => page.evaluate(() => window.mapData!.locations.length), {
        timeout: 20000,
      })
      .toBeGreaterThan(100);
  });

  test("Guide checklists track more than 100 items", async ({ page }) => {
    test.setTimeout(180000);
    const checked = () =>
      page.evaluate(
        () => document.querySelectorAll("input[type=checkbox]:checked").length
      );
    // Click boxes one at a time, at a human pace (the guide saves every
    // click), until `target` boxes are checked. Some quests appear twice and
    // both boxes toggle together, so the next box is picked after each click.
    const checkUntil = (target: number) =>
      page.evaluate(async (target) => {
        const boxes = () => [
          ...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
        ];
        const want = (b: HTMLInputElement) =>
          target === 0 ? b.checked : !b.checked;
        for (let i = 0; i < 1000; i++) {
          const count = boxes().filter((b) => b.checked).length;
          if (target === 0 ? count === 0 : count >= target) return;
          boxes().find(want)?.click();
          await new Promise((r) => setTimeout(r, 250));
        }
      }, target);

    await page.goto("https://mapgenie.io/escape-from-duckov/guides/quests");
    await expect
      .poll(() => page.locator("input[type=checkbox]").count(), { timeout: 20000 })
      .toBeGreaterThan(105);
    await checkUntil(0);
    await checkUntil(105);
    expect(
      await page.evaluate(() => /pro subscription/i.test(document.body.innerText))
    ).toBe(false);

    // Give the last saves a moment to land before reloading.
    await page.waitForTimeout(3000);
    await page.reload();
    await expect.poll(checked, { timeout: 20000 }).toBeGreaterThanOrEqual(105);

    // Leave the test account clean for the next run.
    await checkUntil(0);
  });

  // The extension depends on a few MapGenie endpoints. If one is renamed or
  // removed the extension degrades quietly, so each one gets its own check.
  const apiStatus = (page: Page, path: string) =>
    page.evaluate(async (p) => (await fetch(`/api/v1${p}`)).status, path);

  test("MapGenie API: games list is available", async ({ page }) => {
    await openMap(page);
    expect(await apiStatus(page, "/games")).toBe(200);
  });

  test("MapGenie API: full game data is available", async ({ page }) => {
    const mapPage = await openMap(page);
    const gameId = await mapPage.getGameId();
    const data = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/games/${id}/full`);
      const game = res.ok ? await res.json() : null;
      const map = game?.maps?.[0];
      return {
        status: res.status,
        locations: (map?.groups ?? [])
          .flatMap((g: any) => g.categories)
          .reduce((n: number, c: any) => n + (c.locations?.length ?? 0), 0),
        tiles: map?.config?.tile_sets?.length ?? 0,
      };
    }, gameId);
    expect(data.status).toBe(200);
    expect(data.locations).toBeGreaterThan(0);
    expect(data.tiles).toBeGreaterThan(0);
  });

  test("MapGenie API: map info is available", async ({ page }) => {
    await openMap(page);
    const mapId = await page.evaluate(() => window.mapData!.map.id);
    expect(await apiStatus(page, `/maps/${mapId}`)).toBe(200);
  });

  test("MapGenie API: heatmaps endpoint still exists", async ({ page }) => {
    await openMap(page);
    const mapId = await page.evaluate(() => window.mapData!.map.id);
    // 403 is normal for a free account. 404 means it was removed.
    expect([200, 403]).toContain(await apiStatus(page, `/maps/${mapId}/heatmaps`));
  });

  test("MapGenie API: your account's map data is available", async ({ page }) => {
    await openMap(page);
    const mapId = await page.evaluate(() => window.mapData!.map.id);
    const data = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/user/map-data/${id}`, {
        headers: { "X-Map-ID": String(id) },
      });
      const body = res.ok ? await res.json() : null;
      return {
        status: res.status,
        shape: !!body && "locations" in body && "notes" in body,
      };
    }, mapId);
    expect(data.status).toBe(200);
    expect(data.shape).toBe(true);
  });

  test("Pro features are unlocked", async ({ page }) => {
    await openMap(page);
    const state = await page.evaluate(() => ({
      isPro: (window as any).isPro,
      hasPro: window.user?.hasPro,
      limit: window.mapData?.maxMarkedLocations,
    }));
    expect(state.isPro).toBe(true);
    expect(state.hasPro).toBe(true);
    expect(state.limit).toBe(Infinity);
  });

  test("Marking a location saves it locally", async ({ page }) => {
    const mapPage = await openMap(page);
    await markLocation(mapPage);
    await page.reload();
    await mapPage.waitForAxiosInterceptor();
    await mapPage.waitForUserDataLoaded();
    await markShown(page).toBe(true);
  });

  test("Popup recognises your account", async ({ page, extensionId }) => {
    await openMap(page);
    const frame = await openPopupWhen(page, extensionId, "profiles", async (f) => {
      const text = (await activeTab(f).textContent()) ?? "";
      return /\S/.test(text) && !text.includes("User not logged in");
    });
    expect(await activeTab(frame).textContent()).not.toContain(
      "User not logged in"
    );
  });

  test("Popup shows your real account name", async ({ page, extensionId }) => {
    await openMap(page);
    const frame = await openPopupWhen(page, extensionId, "profiles", async (f) => {
      const text = (await activeTab(f).textContent()) ?? "";
      return (
        /\S/.test(text) &&
        !text.includes("User not logged in") &&
        !text.includes("MapGenie account")
      );
    });
    const text = (await activeTab(frame).textContent()) ?? "";
    expect(text).not.toContain("MapGenie account");
    expect(text).not.toContain("User not logged in");
  });

  test("Data options are enabled in the popup", async ({ page, extensionId }) => {
    await openMap(page);
    const frame = await openPopupWhen(page, extensionId, "data", (f) =>
      f.getByRole("button", { name: "Import from Mapgenie account" }).isEnabled()
    );
    for (const name of [
      "Open data manager",
      "Import from Mapgenie account",
      "Export all games",
      "Export current game",
      "Clear current map",
      "Clear current game",
    ]) {
      await expect(frame.getByRole("button", { name })).toBeEnabled({
        timeout: 15000,
      });
    }
  });

  test("Import from MapGenie account brings your marks in", async ({
    page,
    extensionId,
  }) => {
    const mapPage = await openMap(page);
    // The test account has no marks of its own, so the account's data
    // response is stubbed. What is under test is the extension's side: it
    // asks for it, merges it and saves it.
    await page.route(/\/api\/v1\/user\/map-data\/\d+/, (route) =>
      route.fulfill({
        json: {
          locations: [MARK_ID],
          notes: [],
          trackedCategoryIds: [],
          presets: null,
          profiles: [],
          profileId: null,
          hasPro: false,
        },
      })
    );
    const frame = await openPopupWhen(page, extensionId, "data", (f) =>
      f.getByRole("button", { name: "Import from Mapgenie account" }).isEnabled()
    );
    await frame.getByRole("button", { name: "Import from Mapgenie account" }).click();
    await Promise.all([
      page.waitForEvent("load", { timeout: 30000 }),
      frame.getByRole("button", { name: "Confirm" }).click(),
    ]);
    await page.unroute(/\/api\/v1\/user\/map-data\/\d+/);
    await mapPage.waitForAxiosInterceptor();
    await mapPage.waitForUserDataLoaded();
    await markShown(page).toBe(true);
  });

  test("Map profiles can be created, renamed and deleted", async ({ page }) => {
    const mapPage = await openMap(page);
    const gameId = await mapPage.getGameId();

    const created = await mapPage.axios.post<{ id: number; name: string }>(
      `/api/v1/user/games/${gameId}/profiles`,
      { name: "E2E profile" }
    );
    expect(created.data.name).toBe("E2E profile");

    const renamed = await mapPage.axios.put<{ name: string }>(
      `/api/v1/user/profiles/${created.data.id}`,
      { name: "E2E renamed" }
    );
    expect(renamed.data.name).toBe("E2E renamed");

    const deleted = await mapPage.axios.delete(
      `/api/v1/user/profiles/${created.data.id}`
    );
    expect(deleted.status).toBeLessThan(300);
  });

  test("Each map profile keeps its own progress", async ({ page }) => {
    const mapPage = await openMap(page);
    const gameId = await mapPage.getGameId();
    await markLocation(mapPage);

    const created = await mapPage.axios.post<{ id: number }>(
      `/api/v1/user/games/${gameId}/profiles`,
      { name: "E2E separate" }
    );
    const profileId = created.data.id;

    await reloadingPost(page, `/api/v1/user/games/${gameId}/profiles/active`, {
      profile_id: profileId,
    });
    await markShown(page).toBe(false);

    await reloadingPost(page, `/api/v1/user/games/${gameId}/profiles/active`, {
      profile_id: null,
    });
    await markShown(page).toBe(true);
  });
});

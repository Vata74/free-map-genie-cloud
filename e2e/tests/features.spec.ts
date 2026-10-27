import { expect, type Page } from "@playwright/test";

import { test } from "../helpers/fixtures";
import { MapPage } from "../pages/map";

// Fake ids, never shown on any real map. Large enough not to collide with a
// real MapGenie location.
const MARK_ID = 999999902;

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
    const saved = await page.evaluate(
      (id) => !!window.user?.locations?.[id],
      MARK_ID
    );
    expect(saved).toBe(true);
  });

  test("Popup recognises your account", async ({ page, extensionId }) => {
    await openMap(page);
    const frame = await openPopupFrame(page, extensionId);
    await frame.getByTitle("profiles").click();
    await expect
      .poll(() => activeTab(frame).textContent(), { timeout: 15000 })
      .not.toContain("User not logged in");
  });

  test("Popup shows your real account name", async ({ page, extensionId }) => {
    await openMap(page);
    const frame = await openPopupFrame(page, extensionId);
    await frame.getByTitle("profiles").click();
    await expect
      .poll(() => activeTab(frame).textContent(), { timeout: 15000 })
      .toMatch(/\S/);
    const text = (await activeTab(frame).textContent()) ?? "";
    expect(text).not.toContain("MapGenie account");
    expect(text).not.toContain("User not logged in");
  });

  test("Data options are enabled in the popup", async ({ page, extensionId }) => {
    await openMap(page);
    const frame = await openPopupFrame(page, extensionId);
    await frame.getByTitle("data").click();
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
    const frame = await openPopupFrame(page, extensionId);
    await frame.getByTitle("data").click();
    await frame.getByRole("button", { name: "Import from Mapgenie account" }).click();
    await Promise.all([
      page.waitForEvent("load", { timeout: 30000 }),
      frame.getByRole("button", { name: "Confirm" }).click(),
    ]);
    await page.unroute(/\/api\/v1\/user\/map-data\/\d+/);
    await mapPage.waitForAxiosInterceptor();
    await mapPage.waitForUserDataLoaded();
    const saved = await page.evaluate(
      (id) => !!window.user?.locations?.[id],
      MARK_ID
    );
    expect(saved).toBe(true);
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
    const inNewProfile = await page.evaluate(
      (id) => !!window.user?.locations?.[id],
      MARK_ID
    );
    expect(inNewProfile).toBe(false);

    await reloadingPost(page, `/api/v1/user/games/${gameId}/profiles/active`, {
      profile_id: null,
    });
    const backInDefault = await page.evaluate(
      (id) => !!window.user?.locations?.[id],
      MARK_ID
    );
    expect(backInDefault).toBe(true);
  });
});

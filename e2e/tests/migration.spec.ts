import { expect } from "@playwright/test";

import { test } from "../helpers/fixtures";
import { MapPage } from "../pages/map";
import { extendStorageState } from "../helpers";

const VERSIONS = ["v1", "v2"] as const;
const DOMAINS = ["mapgenie.io", "rdr2map.com"] as const;

VERSIONS.forEach((version) => {
  DOMAINS.forEach((domain) => {
    test.describe(`Data migration from for ${domain}`, () => {
      test.use({
        storageState: async ({ storageState, storageData }, use) => {
          const extendedStorageState = await extendStorageState(
            storageState,
            storageData[version]
          );
          await use(extendedStorageState);
        },
      });

      test(`It should migrate @${version} data correctly`, async ({
        page,
        storageUserDataExpected,
      }) => {
        // This hits the real mapgenie.io/rdr2map.com sites, which is slower
        // and more variable than the default 30s test timeout allows for,
        // especially once you add the explicit waitForUserDataLoaded() wait
        // below on top of navigation and login.
        test.setTimeout(60000);

        const mapPage = new MapPage(page);

        await mapPage.forceUserId(0);

        switch (domain) {
          case "mapgenie.io":
            await mapPage.gotoTarkovFactoryMap();
            break;
          case "rdr2map.com":
            await mapPage.gotoRedDeadRedemption2Map();
            break;
          default:
            throw new Error(`Unknown domain: ${domain}`);
        }

        await mapPage.waitForAxiosInterceptor();
        await mapPage.waitForUserDataLoaded();

        const userData = await mapPage.getUserData();

        const gameId = await mapPage.getGameId();
        const userId = await mapPage.getUserId();

        const { removedKeys, userData: expected } =
          storageUserDataExpected[version][`${gameId}:${userId}`] || {};

        // Sanity checks
        expect(userId).toEqual(0);
        expect(expected).toBeDefined();
        expect(removedKeys).toBeDefined();

        // Verify migrated data
        // All migrated marks must be stored. The map only shows the ones on
        // the current map (since NR2BJ's 3.0.14), so compare the storage
        // where the page can reach it, and otherwise what the map shows once
        // its markers have loaded.
        const stored = await mapPage.getStoredLocations(gameId, userId);
        if (stored) {
          expect(stored).toEqual(expected.locations);
        } else {
          await expect
            .poll(() => page.evaluate(() => window.user?.locations), {
              timeout: 20000,
            })
            .toEqual(expected.locations);
        }
        expect(userData.trackedCategoryIds).toEqual(
          expect.arrayContaining(expected.trackedCategoryIds)
        );
        // id and created_at are generated fresh by the migration (a new
        // nanoid and the current timestamp), so they can never match a
        // fixed fixture value - compare everything else about each note.
        // Note for the "20:0" (mapgenie.io/Tarkov) fixture specifically:
        // its raw storage.v2.json notes live on maps 67 and 74, but
        // "Factory" is map 68 today - MapGenie's internal map ids moved at
        // some point after this fixture was captured. The production
        // filter-to-current-map behavior (see loadUserData() in
        // src/contexts/page/pages/map/index.ts) is intentional, so the
        // correct expectation there is genuinely an empty notes array, not
        // a code bug. Locations aren't affected the same way: the live
        // Factory page's window.mapData.locations covers every location in
        // the game (verified: 307 total), not just the ones historically
        // stored under the old per-submap "map_68" storage key, so the
        // full raw union of locations across all four legacy maps is the
        // correct expectation here.
        const comparableNotes = (userData.notes ?? []).map(
          ({ id, created_at, ...rest }) => rest
        );
        const comparableExpectedNotes = (expected.notes ?? []).map(
          ({ id, created_at, ...rest }: any) => rest
        );
        expect(comparableNotes).toEqual(
          expect.arrayContaining(comparableExpectedNotes)
        );
        expect(userData.presetOrdering).toEqual(expected.presetOrdering);
        expect(userData.presets).toEqual(
          expect.arrayContaining(expected.presets)
        );

        // Verify that old keys are removed

        const data = await page.evaluate((keys) => {
          return Object.fromEntries(
            keys.map((key) => [key, localStorage.getItem(key)])
          );
        }, removedKeys);

        for (const [key, value] of Object.entries(data)) {
          expect(
            value,
            `Expected localStorage key "${key}" to be removed`
          ).toBeNull();
        }
      });
    });
  });
});

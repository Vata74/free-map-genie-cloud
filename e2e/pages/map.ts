import { AxiosPage } from "./axios";

import type { Page } from "@playwright/test";

type GotoOptions = Parameters<Page["goto"]>[1];

export class MapPage extends AxiosPage {
  public async gotoTarkovFactoryMap(options?: GotoOptions) {
    await this.page.goto("https://mapgenie.io/tarkov/maps/factory", options);
  }

  public async gotoRedDeadRedemption2Map(options?: GotoOptions) {
    await this.page.goto("https://rdr2map.com/", options);
  }

  public async waitForUser() {
    return this.page.waitForFunction("!!window.user");
  }

  public async waitForUserDataLoaded() {
    // window.mapData.presets is only ever assigned at the very end of
    // loadUserData() (src/contexts/page/pages/map/index.ts), after
    // locations/notes have been migrated and filtered down to the current
    // map. That step races a 5s internal timeout but is never cancelled on
    // timeout, so waiting here (with a longer timeout) is the reliable way
    // to know the filtering has actually finished, instead of racing it via
    // an earlier signal like the axios interceptor existing.
    return this.page.waitForFunction(
      "window.mapData?.presets !== undefined",
      undefined,
      { timeout: 30000 }
    );
  }

  public async getGameId() {
    return this.page.evaluate(() => window.game!.id);
  }

  public async getUserId() {
    return this.page.evaluate(() => window.user!.id);
  }

  public async forceUserId(userId: number) {
    // Override user ID to always be 0 for consistent testing
    await this.page.addInitScript((id) => {
      const user = { id };

      Object.defineProperty(window, "user", {
        get: () => user,
        set: (newUser) => {
          Object.assign(user, { ...newUser, id });
        },
        configurable: true,
      });
    }, userId);
  }
}

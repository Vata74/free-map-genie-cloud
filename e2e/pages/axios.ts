import { BasePage } from "./base";

import type { Page } from "@playwright/test";
import type { AxiosResponse } from "axios";
import type { UserData } from "../../src/common/storage";

export class AxiosClient {
  constructor(private readonly page: Page) {}

  public async get<T>(url: string): Promise<AxiosResponse<T>> {
    return this.page.evaluate((url) => window.axios!.get(url), url);
  }

  public async put<T>(url: string, data?: any): Promise<AxiosResponse<T>> {
    return this.page.evaluate(({ url, data }) => window.axios!.put(url, data), {
      url,
      data,
    });
  }

  public async post<T>(url: string, data?: any): Promise<AxiosResponse<T>> {
    return this.page.evaluate(
      ({ url, data }) => window.axios!.post(url, data),
      { url, data }
    );
  }

  public async delete<T>(url: string): Promise<AxiosResponse<T>> {
    return this.page.evaluate((url) => window.axios!.delete(url), url);
  }
}

export class AxiosPage extends BasePage {
  public readonly axios: AxiosClient;

  constructor(page: Page) {
    super(page);
    this.axios = new AxiosClient(page);
  }

  public async waitForAxios() {
    return this.page.waitForFunction("!!window.axios", undefined, {
      timeout: 10000,
    });
  }

  public async waitForAxiosInterceptor() {
    return this.page.waitForFunction(
      "!!window.axios?.interceptors.request.handlers.length",
      undefined,
      { timeout: 20000 }
    );
  }

  public async getUserData(): Promise<Partial<UserData>> {
    return this.page.evaluate(() => {
      const { locations, trackedCategoryIds } = window.user ?? {};
      const { notes, presets } = window.mapData ?? {};

      const presetOrdering = presets?.map((preset) => preset.id);

      return { locations, trackedCategoryIds, notes, presets, presetOrdering };
    });
  }

  // Saved locations as stored by the extension, for every map of the game.
  // The map itself only shows the ones that belong to it. Null on sites where
  // the extension's storage isn't reachable from the page.
  public async getStoredLocations(gameId: number, userId: number) {
    return this.page.evaluate(
      async ({ gameId, userId }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("fmg:database");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        // The extension's storage lives on mapgenie.io only.
        if (!db.objectStoreNames.contains("locations_v2")) {
          db.close();
          return null;
        }
        const rows = await new Promise<any[]>((resolve, reject) => {
          const req = db
            .transaction("locations_v2")
            .objectStore("locations_v2")
            .getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        db.close();
        return Object.fromEntries(
          rows
            .filter((r) => r.game_id === gameId && r.user_id === userId)
            .map((r) => [String(r.id), true])
        );
      },
      { gameId, userId }
    );
  }
}

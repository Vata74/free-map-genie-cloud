import { Key } from "@/common/storage";
import { AxiosInterceptor } from "@/common/axios";
import { waitForProperty } from "@/common/object";
import {
  addNativeProfile,
  isNativeProfile,
  removeNativeProfile,
  renameNativeProfile,
  setActiveNativeProfileId,
} from "@/common/mapgenie";

import backendService from "@/services/backend.service";
import mapgenieService from "@/services/mapgenie.service";
import clientService from "@/services/client.service";

export class Client {
  private readonly et: EventTarget = new EventTarget();

  private readonly backend = backendService.use();
  public readonly mapgenie = mapgenieService.use();

  private interceptor?: AxiosInterceptor;
  private _key?: Key;

  public get isLoggedIn(): boolean {
    return !!this._key;
  }

  public get key(): Key {
    if (!this._key) {
      throw new Error("Client is not logged in");
    }
    return this._key;
  }

  public loginFromMap() {
    this._key = Key.fromWindow();
    clientService.provide(this);
  }

  public loginFromGame(gameId: number) {
    this._key = Key.fromWindowGame(gameId);
    clientService.provide(this);
  }

  public async loginFromGuide() {
    try {
      // Try to get the game ID from axios headers
      const axios = await waitForProperty(window, "axios");
      const gameId = axios!.defaults.headers.common["X-Game-ID"];

      if (gameId) {
        this.loginFromGame(Number(gameId));
        return;
      }
    } catch {
      logger.warn(
        "Could not get game ID from axios headers will fallback to URL-based client, notify the fmg authors to improve this"
      );

      // Fallback to URL-based client
      this.loginFromUrl(window.location.href);
    }
  }

  public async loginFromUrl(url: string) {
    const games = await this.mapgenie.fetchGames();

    const { hostname, pathname } = new URL(url);
    const [_, slug] = pathname.split("/");

    const filteredGames = games.filter((g) => g.domain === hostname);

    if (filteredGames.length === 0) {
      throw new Error("No game found for URL");
    }

    if (filteredGames.length === 1) {
      const { id } = filteredGames[0];
      this.loginFromGame(id);
      return;
    }

    const matchedGame = filteredGames.find((g) => g.slug === slug);
    if (!matchedGame) {
      throw new Error("No game found for URL");
    }

    this.loginFromGame(matchedGame.id);
  }

  public async installInterceptor() {
    if (this.interceptor) return;
    const axios = await waitForProperty(window, "axios");
    this.interceptor = new AxiosInterceptor(axios!);
    this.registerHandlers();
  }

  public uninstallInterceptor() {
    this.interceptor?.uninstall();
    this.interceptor = undefined;
  }

  public async getData() {
    const {
      locations,
      trackedCategoryIds,
      notes,
      presets: userPresets,
      presetOrdering,
    } = await this.backend.getData(this.key);

    const demoPresets = await this.getDemoPresets();
    const presets = [...demoPresets, ...userPresets]
      .map((preset) => {
        const newPreset = { ...preset, order: 0 };
        const order = presetOrdering.indexOf(preset.id);
        newPreset.order = order !== -1 ? order : 0;
        return newPreset;
      })
      .sort((a, b) => a.order - b.order);

    return {
      locations,
      trackedCategoryIds,
      notes,
      presets,
    };
  }

  public async storageRequestPersist() {
    const isPersistend = await this.backend.isStoragePersisted();
    if (isPersistend) return true;
    return this.backend.storageRequestPersist();
  }

  public async migrate() {
    const domain = window.location.host;
    return this.backend.migrate(domain, this.key);
  }

  private async getDemoPresets() {
    let presets = window.mapData?.presets;

    // Fallback to fetching from API if not available in mapData
    if (!presets) {
      try {
        const game = await this.mapgenie.fetchGame(this.key.gameId);
        presets = game.default_presets;
      } catch (error) {
        logger.debug("Could not fetch default presets.", error);
        presets = [];
      }
    }

    //Invert IDs to avoid conflicts with local saved presets
    return presets.map((preset) => ({
      ...preset,
      id: -Math.abs(preset.id),
    }));
  }

  public async getActiveUserId() {
    const user = await this.backend.getActiveProfile();
    return user?.id;
  }

  public async importFromMapgenieAccount() {
    const game = await this.mapgenie.fetchGame(this.key.gameId);
    const axios = await waitForProperty(window, "axios");

    const locations = new Set<number>();
    const tracked = new Set<number>();
    const notes = new Map<string, MG.Note>();

    for (const map of game.maps) {
      const { data } = await axios!.get(`/api/v1/user/map-data/${map.id}`, {
        headers: { "X-Map-ID": String(map.id) },
      });
      const found: unknown = data.locations;
      const ids = Array.isArray(found)
        ? found
        : Object.keys(found ?? {}).filter((id) => (found as any)[id]);
      ids.forEach((id: number | string) => locations.add(Number(id)));
      (data.trackedCategoryIds ?? []).forEach((id: number) => tracked.add(id));
      (data.notes ?? []).forEach((note: MG.Note) => notes.set(note.id, note));
    }

    await this.backend.importAccountData(this.key, {
      locations: [...locations],
      trackedCategoryIds: [...tracked],
      notes: [...notes.values()],
    });
  }

  public async clearGame() {
    await this.backend.removeData(this.key);
  }

  public async clearMap() {
    const locations = window.mapData!.locations.map((loc) => loc.id);
    await this.backend.deleteLocations(this.key, locations);
  }

  public async export() {
    if (!this.isLoggedIn) {
      throw new Error("Client is not logged in");
    }
    const games = await this.backend.export(this.key.userId, this.key.gameId);
    return games;
  }

  public on<K extends keyof Client.EventMap>(
    event: K,
    listener: (e: CustomEvent<Client.EventMap[K]>) => void
  ) {
    this.et.addEventListener(event, listener as EventListener);
  }

  public off<K extends keyof Client.EventMap>(
    event: K,
    listener: (e: CustomEvent<Client.EventMap[K]>) => void
  ) {
    this.et.removeEventListener(event, listener as EventListener);
  }

  private registerHandlers() {
    if (!this.interceptor) return;
    if (!this.isLoggedIn) return;

    this.interceptor.put<{ id: string }>(
      "/api/v1/user/locations/:id",
      async (ctx) => {
        logger.debug("Intercepted location mark request", ctx);
        await this.backend.markLocationFound(
          this.key,
          Number(ctx.params.id),
          true
        );
        this.et.dispatchEvent(
          new CustomEvent<Client.LocationEvent>("locationMarked", {
            detail: {
              locationId: Number(ctx.params.id),
              found: true,
            },
          })
        );
        ctx.block();
      }
    );

    this.interceptor.delete<{ id: string }>(
      "/api/v1/user/locations/:id",
      async (ctx) => {
        logger.debug("Intercepted location unmark request", ctx);
        await this.backend.markLocationFound(
          this.key,
          Number(ctx.params.id),
          false
        );
        this.et.dispatchEvent(
          new CustomEvent<Client.LocationEvent>("locationMarked", {
            detail: {
              locationId: Number(ctx.params.id),
              found: false,
            },
          })
        );
        ctx.block();
      }
    );

    this.interceptor.post<{}, { category: number }>(
      "/api/v1/user/categories",
      async (ctx) => {
        logger.debug("Intercepted category track request", ctx);
        await this.backend.trackCategory(this.key, ctx.postData.category, true);
        ctx.block();
      }
    );

    this.interceptor.delete<{ id: string }>(
      "/api/v1/user/categories/:id",
      async (ctx) => {
        logger.debug("Intercepted category untrack request", ctx);
        await this.backend.trackCategory(
          this.key,
          Number(ctx.params.id),
          false
        );
        ctx.block();
      }
    );

    this.interceptor.post<{}, MG.Api.NotePostData>(
      "/api/v1/user/notes",
      async (ctx) => {
        logger.debug("Intercepted note create request", ctx);
        const note = await this.backend.addNote(this.key, ctx.postData);
        ctx.block(note);
      }
    );

    this.interceptor.put<{ id: string }, Partial<MG.Note>>(
      "/api/v1/user/notes/:id",
      async (ctx) => {
        logger.debug("Intercepted note update request", ctx);
        await this.backend.updateNote(ctx.params.id, ctx.postData);
        ctx.block();
      }
    );

    this.interceptor.delete<{ id: string }>(
      "/api/v1/user/notes/:id",
      async (ctx) => {
        logger.debug("Intercepted note delete request", ctx);
        await this.backend.deleteNote(ctx.params.id);
        ctx.block();
      }
    );

    this.interceptor.post<{}, MG.Api.PresetPostData>(
      "/api/v1/user/presets",
      async (ctx) => {
        logger.debug("Intercepted preset create request", ctx);
        const { ordering, ...presetData } = ctx.postData;
        const preset = await this.backend.addPreset(
          this.key,
          presetData,
          ordering
        );
        ctx.block(preset);
      }
    );

    this.interceptor.delete<{ id: string }>(
      "/api/v1/user/presets/:id",
      async (ctx) => {
        logger.debug("Intercepted preset delete request", ctx);
        await this.backend.deletePreset(Number(ctx.params.id));
        ctx.block();
      }
    );

    this.interceptor.post<{}, { ordering: number[] }>(
      "/api/v1/user/presets/reorder",
      async (ctx) => {
        logger.debug("Intercepted preset reorder request", ctx);
        await this.backend.reorderPresets(this.key, ctx.postData.ordering);
        ctx.block();
      }
    );

    // MapGenie's "Map profiles" (multiple save slots per account) are a Pro
    // feature enforced server-side: creating one past the first gets a 402
    // from the real API no matter what client-side flags say. These four
    // routes back a local-only stand-in instead, with real separate
    // found-locations/notes/categories data per profile - see
    // nativeProfiles.ts and Key.fromWindow() for how.
    //
    // The lookup scope for "which native profiles exist" is always the real
    // account id (window.user.realId), not this.key.userId - once a native
    // profile is active, this.key.userId IS that profile's own id, which
    // would make the lookup scope itself to one single profile instead of
    // the account's whole list.

    this.interceptor.post<{ gameId: string }, { name?: string; copy_from?: number | "default" | null }>(
      "/api/v1/user/games/:gameId/profiles",
      async (ctx) => {
        const name = ctx.postData?.name?.trim();
        if (!name) return;
        if (!window.user) return;

        logger.debug("Intercepted create-profile request", ctx);
        const gameId = Number(ctx.params.gameId);
        const realUserId = window.user.realId ?? window.user.id;
        const profile = addNativeProfile(gameId, realUserId, name);

        const copyFrom = ctx.postData?.copy_from;
        if (copyFrom) {
          const fromUserId = copyFrom === "default" ? realUserId : copyFrom;
          try {
            await this.backend.copyProfileData(
              new Key(gameId, fromUserId),
              new Key(gameId, profile.id)
            );
          } catch (err) {
            logger.error("Could not copy progress into the new profile.", err);
          }
        }

        ctx.block(profile);
      }
    );

    this.interceptor.put<{ id: string }, { name?: string }>(
      "/api/v1/user/profiles/:id",
      async (ctx) => {
        if (!window.user) return;
        const realUserId = window.user.realId ?? window.user.id;

        const id = Number(ctx.params.id);
        if (!isNativeProfile(this.key.gameId, realUserId, id)) return;

        const name = ctx.postData?.name?.trim();
        if (!name) return;

        logger.debug("Intercepted rename-profile request", ctx);
        const profile = renameNativeProfile(
          this.key.gameId,
          realUserId,
          id,
          name
        );
        ctx.block(profile);
      }
    );

    this.interceptor.delete<{ id: string }>(
      "/api/v1/user/profiles/:id",
      async (ctx) => {
        if (!window.user) return;
        const realUserId = window.user.realId ?? window.user.id;

        const id = Number(ctx.params.id);
        if (!isNativeProfile(this.key.gameId, realUserId, id)) return;

        logger.debug("Intercepted delete-profile request", ctx);
        removeNativeProfile(this.key.gameId, realUserId, id);
        ctx.block();
      }
    );

    this.interceptor.post<{ gameId: string }, { profile_id: number | null }>(
      "/api/v1/user/games/:gameId/profiles/active",
      async (ctx) => {
        if (!window.user) return;
        const realUserId = window.user.realId ?? window.user.id;

        const profileId = ctx.postData?.profile_id ?? null;
        if (
          profileId !== null &&
          !isNativeProfile(this.key.gameId, realUserId, profileId)
        ) {
          // Not one of our local profiles - a real one, or the default.
          // Let the request go through to MapGenie's servers as normal.
          return;
        }

        logger.debug("Intercepted switch-active-profile request", ctx);

        setActiveNativeProfileId(this.key.gameId, realUserId, profileId);
        window.user.activeProfileId = profileId;
        ctx.block({});

        // The new profile needs its own separate data loaded from scratch
        // (Key.fromWindow() now resolves differently), which this page's
        // init flow only does on load - same approach FMG's own Guest
        // profile switching already uses (reloadActiveTab()).
        window.location.reload();
      }
    );
  }
}

export namespace Client {
  export interface LocationEvent {
    locationId: number;
    found: boolean;
  }

  export interface EventMap {
    locationMarked: LocationEvent;
  }
}

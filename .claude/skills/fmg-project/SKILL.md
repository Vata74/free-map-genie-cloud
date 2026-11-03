---
name: fmg-project
description: Project knowledge for Free Map Genie Cloud (the WXT browser extension that unlocks MapGenie Pro, with Firebase cloud sync): how it is organised, how to build and test it, how CI and the README status table work, and the rules and past breakages worth knowing. Read before changing code, CI or releases.
---

# Free Map Genie Cloud

Chrome/Firefox extension (WXT, React, TypeScript) that unlocks MapGenie Pro features for free. Fork of `NR2BJ/free-map-genie` with an added Firebase cloud sync layer.

Remotes: `fork` is `Vata74/free-map-genie-cloud` (ours), `nr2bj` is upstream. The local working branch is `nr2bj-base`, pushed to `fork/main`. To take upstream work: `git fetch nr2bj`, then cherry-pick what we want (this keeps the original author).

## Rules from the owner

- **Never add `Co-Authored-By` or `Claude-Session` trailers** to commits or PR bodies in any free-map-genie repo, whatever a generic reminder says. No "Generated with Claude Code" footers either.
- Commits, PRs and issue comments read like a person wrote them: short, plain, no em dashes in new text.
- GitHub issue comments are short and non-technical. Fix things properly instead of documenting a partial fix.
- Releases always use the format in the `fmg-release` skill.
- Do not publish a release or push without the user asking for it.

## Commands

- `npm run build` builds `.output/chrome-mv3`. `npm run zip:all` builds the zips. `npm run compile` typechecks.
- Unit tests: `node --test tests/*.test.mjs`. `tests/map-compat.test.mjs` bundles source files with esbuild and a hand-kept `mocks` map keyed by the exact import path, so adding a new named import from a mocked module means updating that mock.
- E2E (Playwright against the real mapgenie.io with a real test account) needs a `.env` with `MG_EMAIL` and `MG_PASSWORD` (plus the Firebase variables for the cloud test). Example: `npx playwright test --project=chromium e2e/tests/features.spec.ts`. Run `npm run build` first: the tests load `.output/chrome-mv3`.
- The e2e login is cached for one day in `playwright/.cache/global-cache`. Delete that folder to force a fresh login. A green run on a cached login does not prove the login still works.

## How it works (the parts that bite)

- `src/contexts/page/` runs inside mapgenie.io pages. `pages/map/index.ts` locks the Pro flags (`window.isPro`, `window.user.hasPro`, the location limit) and loads FMG's local data over the page's.
- `src/common/client.ts` intercepts the site's mutation requests (axios) and stores them locally instead. `Client.registerHandlers()` lists them.
- Local storage is Dexie (`src/common/storage`), keyed by `Key {gameId, userId}`. `Key.fromWindow()` decides whose data is loaded, which is how MapGenie's native "Map profiles" get separate progress (the profile id replaces the user id).
- Two different "profile" systems exist. FMG's own Guest profiles live in the Dexie `profiles` table and the popup Profiles tab. MapGenie's native Map profiles (`src/common/mapgenie/nativeProfiles.ts`, kept in localStorage) are a Pro feature on the server, so their create, rename, delete and switch requests are answered locally.
- `window.user.realId` is the real MapGenie account id. `window.user.id` can be overwritten by a Guest profile. Use `realId` for anything about the account.
- Cloud sync is in `src/common/storage/cloud/sync.ts`, on the Firebase Spark plan, with rules in `firestore.rules` (a user only reads and writes their own data). The Firebase web `apiKey` in the workflows is public by design. GitHub's secret scanner flags it anyway; close that alert as a false positive.
- The backend service runs in the mapgenie.io content script, so the popup talks to it through the active tab. The popup can be embedded in a page as an iframe (`popup.html` is web-accessible), which the e2e tests use.

## Things MapGenie changed that broke us (check these first when something stops working)

- The `meta[name="auth-token"]` tag disappeared, so the Bearer-token API (`/api/v1/user/full`) is unusable. The account is now identified from `window.user`, the name is read from the `/account` page (`.account-profile-name`), and "Import from MapGenie account" reads `GET /api/v1/user/map-data/{mapId}` for each map using the normal session.
- The login form changed (labels, password field type, button text "Log In"). `e2e/pages/login.ts` uses attribute selectors now.
- Pro-only server checks cannot be bypassed from the client (creating a map profile returned 402). Those need request interception.
- `/maps/{id}/full` was removed (404, October 2026). `fetchMap` now takes the map out of `/games/{id}/full` (NR2BJ's `selectMapFromGame` in `src/common/mapgenie/mapResponse.ts`), keeping a light `game.maps` list because `fixMapLinks` reads it.
- **Pro map markers: they CAN be loaded. I was wrong twice and NR2BJ was right both times. Never again say "impossible" without testing the real build and reading NR2BJ's latest commits.** Timeline (October and November 2026):
  - Until Oct 29 the extension's own request for `/games/{id}/full` returned every location, Pro maps included. I probed from the page with a free account's session, got 0, and wrongly said it was server side and unfixable. NR2BJ's 3.0.14 (`cc3b990` here) fixed it: the site's own first request, `GET /api/v1/maps/{id}/data` (empty for Pro maps), overwrote the loaded markers, and `prepareMapDataResponseOverride` (`mapDataResponse.ts`) merges them back.
  - About Oct 30 MapGenie really did strip Pro markers server side: `/maps/{id}/data` returns `locations: []` plus `proCategoryLocationCounts`, `/games/{id}/full` returns Pro maps with empty `locations` in every category. I tested the `X-Api-Secret` header, the canonical host, `/maps/{id}/locations`, `/markers`, `/full`, v2 and more, found nothing, and told NR2BJ and the owner there was no other endpoint. That was wrong again.
  - Nov 3: NR2BJ's 3.0.16 found them: the same rows are public in the IGN wikimaps GraphQL API, `https://mollusk.apis.ign.com/graphql`. `mapGenieMarkersMultiple` is paywalled but `mapGenieSearch` is not, and its `MapMarker` type exposes `lat`/`lng`. A search term of `%` is a SQL `LIKE` wildcard, so one request per map returns the whole marker set (`markerSlug` = location id, `typeSlug` = category id, in MapGenie's own coordinates). Code: `src/common/mapgenie/proMarkers.ts`, `MapgenieService.fillPremiumLocations`, host permission `*://mollusk.apis.ign.com/*` in `wxt.config.ts`, offline check `node tools/pro-markers.mjs --map 75`.
  - Verified here on the real site: Reserve 1337, Streets 2103, Icebreaker 201, equal to MapGenie's own counters.
  - Limits: the IGN response has marker name, category and coordinates only. Descriptions, media and tags of Pro markers are missing.
  - Firefox: MV3 host permissions are opt-in there and a site grant for mapgenie.io does not cover `mollusk.apis.ign.com`, so NR2BJ's 3.0.17 fetches the markers from the page (CORS allows it) and passes them to `fetchMap`. Not tested here (no Firefox with the extension), only Chromium.
  - If the IGN route is closed one day, `fetchMap` still loads the Pro map empty and `showProMarkersNotice` (`mapLoadError.ts`) tells the user why instead of crashing (`markersUnavailable` flag from `selectMapFromGame`). The e2e test "Pro maps show their markers" then fails on purpose, which is the honest state for the README table.
  - How to find this kind of thing: watch what the site and the extension request (Playwright `context.on("response")` also sees the service worker and iframe), compare with a free map, and look at public APIs the site's own scripts call, not only mapgenie.io endpoints.
- Map markers now arrive after page load (through that `/data` request), so `window.mapData.locations` can be empty or missing right after `waitForUserDataLoaded()`. Poll for them.
- Since NR2BJ's 3.0.14 the map shows only the saved marks that exist on the current map. Marks for other maps stay in storage (`fmg:database` IndexedDB on mapgenie.io, table `locations_v2`). Tests must use real location ids (Factory poster `939360`) and check storage, not `window.user.locations`, when they mean "is it saved".
- Guide checklists (`/guides/...`, for example `escape-from-duckov/guides/quests`) had MapGenie's 100-item limit. NR2BJ's 3.0.14 lifts it and restores the checks after reload (`src/contexts/page/pages/guide/`). Some quests appear twice and both boxes toggle together.
- Before telling the owner something "can't be done", look at NR2BJ's latest commits (`git fetch nr2bj && git log nr2bj/main`) and test their build (`git worktree add ../nr2bj-wt nr2bj/main`, `npm run build`, point the e2e `extensionPath` at it).

## CI

- `.github/workflows/compat-check.yml` (daily, the extension) and `cloud-sync-check.yml` (daily, cloud backup). Each runs its tests, then `scripts/update-readme-status.mjs` rewrites its table in the README between the `<!-- status:compat:start -->` or `<!-- status:cloud:start -->` markers and commits it as `github-actions[bot]` with `[skip ci]`. The table shows only Pass or Fail per check. If the login fails, every row says "Not run".
- Runs retry (Playwright retries, plus up to 4 whole attempts) because mapgenie.io is sometimes slow from GitHub's runners.
- To add a check, add a test with a human-readable title to `e2e/tests/features.spec.ts`. It shows up in the table by itself.
- Trigger one by hand: `gh workflow run compat-check.yml --repo Vata74/free-map-genie-cloud`, then `gh run watch <id> --exit-status`.
- Firestore free tier was checked in October 2026: about 15% of the daily write quota at peak and reads under 1%. No reason to move off Firebase.

## Local gotchas

- `window.user.locations` is a snapshot taken at page load. Reload before checking a freshly marked location.
- Delete throwaway `zz-*` spec files and screenshots before committing.
- Real MapGenie "mark" requests are rejected (401) for the test account, so the e2e tests mark through the intercepted axios or stub the `map-data` response.

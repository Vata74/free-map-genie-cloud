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
- **Pro map markers DO load. Never conclude again that they can't without testing the real build.** In October 2026 I told the owner it was impossible and NR2BJ proved it wrong the next day (their 3.0.14, `a024d04`, brought in here as `cc3b990`). What actually happens:
  - The extension's own request for `/games/{id}/full` returns every location of every map, Pro ones included (Reserve: 1337). It is made by the backend service (`mapgenie.service.ts`) with the extension's `$headers` (it sends `x-api-secret`) to `www.mapgenie.io`, which redirects to `mapgenie.io`, without the site's session cookies.
  - The same URL fetched from the page (with the session of a free account), or from a plain client without those headers, returns Pro maps with 0 locations. That is what fooled me: I probed from the page.
  - The site's own boot request, `GET /api/v1/maps/{id}/data`, returns 0 locations for a Pro map on a free account and then overwrites what the extension loaded. NR2BJ's fix (`src/common/mapgenie/mapDataResponse.ts`, `prepareMapDataResponseOverride`) adds an axios response interceptor, installed the moment the site assigns `window.axios`, that merges the extension's locations back into that response.
  - To check it for real: build, open `https://mapgenie.io/tarkov/maps/factory?fmgMapId=75`, wait, and read `window.mapData.locations.length`. The e2e test "Pro maps show their markers" does exactly that.
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

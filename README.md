# Free Map Genie Cloud

[![Daily compatibility check](https://github.com/Vata74/free-map-genie-cloud/actions/workflows/daily-compat-check.yml/badge.svg)](https://github.com/Vata74/free-map-genie-cloud/actions/workflows/daily-compat-check.yml)

Browser extension that unlocks MapGenie Pro features for free, with an added cloud sync layer so your progress survives a browser reset and follows you across devices.

A workflow runs the full test suite against the real mapgenie.io site every day, so a MapGenie-side change shows up as a red badge above instead of someone's browser being the first to notice.

This is a fork of [NR2BJ/free-map-genie](https://github.com/NR2BJ/free-map-genie), the actively maintained fork that keeps up with MapGenie's site changes. NR2BJ's fork is itself based on the original [V1P3R-FMG/free-map-genie](https://github.com/V1P3R-FMG/free-map-genie), created by [MrFusiion](https://github.com/MrFusiion). See [Credits](#credits).

## Screenshots

| Cloud backup, no login needed | Linked to an account |
| --- | --- |
| ![Cloud tab, backup active but not linked to any account](docs/screenshots/popup-cloud-anonymous.png) | ![Cloud tab, linked to an email account](docs/screenshots/popup-cloud-linked.png) |

## Install

1. Go to [Releases](../../releases) and download the latest `fmg-x.y.z-chrome.zip` (Chrome/Edge/Brave/Kiwi) or `fmg-x.y.z-firefox.xpi` (Firefox)
2. **Chrome/Edge/Brave:**
   - Unzip the file somewhere permanent (don't delete the folder afterwards — the browser loads the extension from it)
   - Go to `chrome://extensions` (or `edge://extensions`), enable **Developer mode** (top right)
   - **Load unpacked** → select the unzipped folder
3. **Firefox:** the `.xpi` isn't signed yet, so regular Firefox will only let you load it temporarily via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** (resets when you close Firefox). Use Chrome/Edge/Brave for a permanent install until this gets signed through Mozilla.
4. **Android:** [Kiwi Browser](https://kiwibrowser.com) can load the same Chrome zip directly — see [Mobile](#mobile-android).
5. Open any MapGenie map, click the extension icon, go to the **Cloud** tab — cloud backup is already on, no login required. Link a Google or email account later if you want it on more than one device (see [Setup](#setup-for-people-building-from-source) for the recommendation on why).

## What this adds on top of NR2BJ's fork

Everything NR2BJ's fork already does (MapGenie v3 compatibility, Pro unlock, Chrome/Firefox builds), plus:

- **Cloud sync (Firebase).** Your marked locations, tracked categories, notes, and presets are backed up automatically, not just kept in the browser's local storage.
- **Zero-friction by default.** The extension signs in anonymously the moment it loads — there's no login screen to get through before backup starts working on this device.
- **Optional account linking.** Sign in with Google or an email/password account to sync the same data across multiple computers, or on Android through a browser that supports extensions (see [Mobile](#mobile-android)).
- **Per-profile sync.** If you use more than one local profile (a MapGenie account plus local Guest profiles), each one is synced separately — switching profiles never overwrites another profile's cloud data.
- **Works with the existing Import/Export.** Importing a save file from the Data tab, or importing straight from your MapGenie account, now also pushes the result to Firebase — not just local storage — the same way marking a location does.

Cloud sync is entirely optional: without a Firebase project configured, the extension behaves exactly like NR2BJ's fork, with local-only storage.

## Setup (for people building from source)

Firebase's web config isn't a secret — it's meant to be public, the same way it ends up in every website that uses Firebase. Access is controlled by Firestore's security rules, not by hiding the config. So if you're just running a build someone else already published (a release zip), cloud sync works out of the box.

If you're building from source and want cloud sync enabled in your build:

1. Create a Firebase project (free Spark plan is enough) at [console.firebase.google.com](https://console.firebase.google.com)
2. **Authentication → Sign-in method** → enable **Anonymous**, **Email/Password**, and **Google**
3. **Firestore Database** → create a database → **Rules** tab → paste the contents of `firestore.rules` from this repo → Publish
4. **Project settings → General → Your apps** → add a Web app → copy the `firebaseConfig` values
5. For Google sign-in specifically, also:
   - [Google Cloud Console](https://console.cloud.google.com) (same project) → **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type **Chrome Extension** → Item ID: the extension ID your build produces (see `wxt.config.ts`, the `manifest.key` there pins it)
   - Copy the resulting Client ID
6. Fill in `.env` (see `.env.example`) with all of the above:
   ```
   FIREBASE_API_KEY=
   FIREBASE_AUTH_DOMAIN=
   FIREBASE_PROJECT_ID=
   FIREBASE_STORAGE_BUCKET=
   FIREBASE_MESSAGING_SENDER_ID=
   FIREBASE_APP_ID=
   GOOGLE_OAUTH_CLIENT_ID=
   ```
7. `npm run build`

**Recommendation:** link with a Google account rather than staying anonymous. Anonymous backup only protects you if the browser's local storage gets cleared while the anonymous session itself survives — if you ever clear "cookies and site data" broadly, the anonymous identity is wiped at the same time as the local data, and that cloud copy becomes unrecoverable. A Google-linked account survives that, because the credential comes from your Chrome/Google account, not from the site storage that gets cleared.

## Mobile (Android)

Extensions don't run on mobile Safari or Chrome. On Android, [Kiwi Browser](https://kiwibrowser.com) supports loading Chrome extensions (including unpacked/CRX builds) directly, which is the most practical way to run this — and your MapGenie account's cloud sync data to a linked account carries over the same way it does between two computers.

## Status

- MapGenie v3 map pages boot correctly.
- Pro UI restrictions are unlocked.
- Local data is stored in the FMG IndexedDB database (`fmg:database`); cloud sync mirrors it to Firestore when configured.
- Chrome and Firefox packages build from the same source tree.

## Local Data

FMG save data lives in an IndexedDB database named `fmg:database`, inside the extension's offscreen document. Clearing "cookies and other site data" broadly (not just cache) removes it — that's the main reason to link a real account rather than relying on the anonymous backup alone.

## Build

This project uses WXT and yarn.

```powershell
yarn install
yarn build          # Chrome
yarn build:firefox  # Firefox
```

## Credits

- Original project: [V1P3R-FMG/free-map-genie](https://github.com/V1P3R-FMG/free-map-genie), created by [MrFusiion](https://github.com/MrFusiion)
- Maintained MapGenie v3 compatibility fork this is based on: [NR2BJ/free-map-genie](https://github.com/NR2BJ/free-map-genie)
- Chrome compatibility patch reference: [HicH987/free-map-genie](https://github.com/HicH987/free-map-genie)

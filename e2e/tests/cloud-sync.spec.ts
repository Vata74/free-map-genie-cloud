import "dotenv/config";
import { expect } from "@playwright/test";
import { initializeApp, deleteApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  deleteUser,
} from "firebase/auth";
import { getFirestore, doc, getDoc, deleteDoc } from "firebase/firestore";

import { test } from "../helpers/fixtures";
import { MapPage } from "../pages/map";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

// Fake location id, never rendered on any real map, just used to check that
// marking it locally ends up in Firestore once we sign up for a cloud
// account. Large enough it will never collide with a real MapGenie id.
const TEST_LOCATION_ID = 999999901;

test.describe("Cloud sync", () => {
  test.skip(
    !isFirebaseConfigured,
    "Firebase is not configured (.env), skipping cloud sync e2e test"
  );

  test("pushes a locally marked location to Firestore on sign-up", async ({
    page,
    context,
    extensionId,
  }) => {
    const mapPage = new MapPage(page);

    await mapPage.gotoTarkovFactoryMap();
    await mapPage.waitForAxiosInterceptor();

    const gameId = await mapPage.getGameId();
    const userId = await mapPage.getUserId();

    // Same request the extension's axios interceptor turns into
    // backend.markLocationFound() when you click a pin on a real map. The
    // interceptor blocks the real network request and instead dispatches a
    // "locationMarked" window event (see setupEventListeners() in
    // src/contexts/page/pages/map/index.ts), which is what we check for
    // here to confirm the mark actually went through FMG's local storage
    // and not just a bare network call. Listener is attached and awaited
    // before firing the PUT, so there's no race with the event dispatch.
    await page.evaluate(() => {
      (window as any).__fmgTestMarks = [];
      window.addEventListener("locationMarked", (e) => {
        (window as any).__fmgTestMarks.push((e as CustomEvent).detail);
      });
    });

    // waitForAxiosInterceptor only confirms *some* axios request handler
    // exists, which can be true slightly before client.installInterceptor()
    // has registered the location mark handler specifically (start() in
    // src/contexts/page/pages/map/index.ts awaits several other steps
    // first). Retry the PUT briefly instead of tightening that shared
    // helper's timing assumptions.
    await expect(async () => {
      await mapPage.axios.put(`/api/v1/user/locations/${TEST_LOCATION_ID}`);
    }).toPass({ timeout: 10000, intervals: [500, 1000, 1500] });

    await expect
      .poll(() =>
        page.evaluate(
          (locationId) =>
            ((window as any).__fmgTestMarks as { locationId: number }[]).some(
              (m) => m.locationId === locationId
            ),
          TEST_LOCATION_ID
        )
      )
      .toBe(true);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await popup.getByTitle("cloud").click();

    const email = `fmg-e2e-${Date.now()}@example.com`;
    const password = "TestPassword123!";

    await popup.getByPlaceholder("Email").fill(email);
    await popup.getByPlaceholder("Password").fill(password);
    await popup.getByRole("button", { name: "Create account" }).click();

    // Once signed up, the "not linked" status disappears and the account
    // email shows up instead. Checking textContent of the active tab panel
    // directly rather than toBeVisible: popup.html is being opened as a
    // full tab here instead of the small popup bubble it's designed for,
    // which trips Playwright's actionability/visibility heuristics on its
    // fixed-size layout even though the element is genuinely rendered and
    // on-screen.
    const activeTabPanel = popup.locator(
      '[class*="tab-view-container"][class*="active"]'
    );
    await expect
      .poll(() => activeTabPanel.textContent(), { timeout: 15000 })
      .toContain(email);

    await popup.close();

    // Verify independently, from a second Firebase client (not the
    // extension's), that the mark actually landed in Firestore.
    const verifyApp = initializeApp(firebaseConfig, `e2e-verify-${Date.now()}`);
    try {
      const auth = getAuth(verifyApp);
      const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      const db = getFirestore(verifyApp);
      const ref = doc(
        db,
        "users",
        credential.user.uid,
        "profiles",
        String(userId),
        "games",
        String(gameId)
      );

      await expect
        .poll(
          async () => {
            const snapshot = await getDoc(ref);
            return snapshot.exists()
              ? snapshot.data()?.locations?.[TEST_LOCATION_ID]
              : undefined;
          },
          { timeout: 20000 }
        )
        .toBe(true);

      // Clean up the disposable test account and its data so repeated runs
      // don't pile up in the real Firebase project.
      await deleteDoc(ref);
      await deleteUser(credential.user);
    } finally {
      await deleteApp(verifyApp);
    }
  });
});

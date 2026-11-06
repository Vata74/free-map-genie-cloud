import { initializeApp, getApps, type FirebaseApp } from "firebase/app";

const config = {
  apiKey: import.meta.env.FIREBASE_API_KEY,
  authDomain: import.meta.env.FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(config).every(
  (value) => !!value
);

let app: FirebaseApp | null = null;

// In Firefox the backend runs in a content script, and there the Firebase SDK
// fails every request with "TypeError: 'fetch' called on an object that does
// not implement interface Window" (it calls fetch without `window` as its
// `this`). That made sign-in fail with auth/network-request-failed. Binding
// fetch to window once makes it work wherever it is called from.
const bindFetch = () => {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  if ((window.fetch as { __fmgBound?: boolean }).__fmgBound) return;
  const bound = window.fetch.bind(window);
  (bound as { __fmgBound?: boolean }).__fmgBound = true;
  window.fetch = bound;
};

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;

  if (!app) {
    bindFetch();
    app = getApps()[0] ?? initializeApp(config);
  }

  return app;
}

import { ExtensionSettings } from "@/common/extension/settings";
import { createService, type ProxiedObject } from "@/common/messaging";

import { WindowManager } from "@/common/windowManager";

class BackgroundService {
  private readonly windowManager = new WindowManager();

  public async getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tabs[0] ?? undefined;
  }

  public async reloadActiveTab(): Promise<void> {
    const tab = await this.getActiveTab();
    if (tab?.id !== undefined) {
      await browser.tabs.reload(tab.id);
    }
  }

  public async setExtensionEnabled(enabled: boolean) {
    await ExtensionSettings.enabled.setValue(enabled);
  }

  public async getExtensionEnabled() {
    return ExtensionSettings.enabled.getValue();
  }

  public async openDataManager() {
    await this.windowManager.open(browser.runtime.getURL("dataManager.html"), {
      focused: true,
      width: 1000,
      height: 800,
    });
  }

  public async closeDataManager() {
    await this.windowManager.close(browser.runtime.getURL("dataManager.html"));
  }

  // chrome.identity is only available in privileged extension pages
  // (background, popup) — not in the content script running inside the
  // offscreen document's iframe, where the rest of cloud sign-in actually
  // happens. So the token is fetched here and handed to backend.cloudSignInWithGoogle.
  //
  // Uses launchWebAuthFlow rather than getAuthToken: getAuthToken relies on
  // Chrome's own signed-in-profile integration and isn't implemented on
  // Edge ("This API is not supported on Microsoft Edge"). launchWebAuthFlow
  // is the standard WebExtensions API and works the same on Chrome, Edge,
  // and Firefox — it just opens a normal Google OAuth consent popup instead
  // of using the browser's native account chooser.
  //
  // This needs a "Web application" OAuth client (not "Chrome Extension"),
  // e.g. the one Firebase auto-creates when you enable Google sign-in
  // (Firebase console > Authentication > Sign-in method > Google > Web SDK
  // configuration), with browser.identity.getRedirectURL() added to its
  // Authorized redirect URIs in Google Cloud Console.
  public async getGoogleAuthToken(): Promise<string> {
    const clientId = import.meta.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
    }

    // Firefox's redirect URL ends with "/", and Google Cloud Console won't
    // save an allizom.org redirect URI with it. Google compares the URI
    // character by character, so send it without the slash (the browser still
    // recognises the final redirect, its path is "/" either way). Chrome's
    // registered URI has the slash, so it is left as it is.
    const redirectUri = import.meta.env.FIREFOX
      ? browser.identity.getRedirectURL().replace(/\/$/, "")
      : browser.identity.getRedirectURL();

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "token");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("prompt", "select_account");

    const redirectedTo = await browser.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });
    if (!redirectedTo) {
      throw new Error("Google sign-in was cancelled or denied.");
    }

    const accessToken = new URL(redirectedTo).hash
      ? new URLSearchParams(new URL(redirectedTo).hash.slice(1)).get(
          "access_token"
        )
      : null;
    if (!accessToken) {
      throw new Error("Google sign-in did not return an access token.");
    }

    return accessToken;
  }
}

const backgroundService = createService({
  context: BackgroundService,
  namespace: "BackgroundService",
  heartbeatTimeout: import.meta.env.SERVICE_TIMEOUT,
});

namespace backgroundService {
  export type Instance = ProxiedObject<BackgroundService>;
}

export default backgroundService;

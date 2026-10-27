import type { Page } from "@playwright/test";

export class LoginPage {
  private loginPage?: Page;

  public constructor(private readonly page: Page) {}

  public async clearCookies() {
    await this.page.context().clearCookies();
  }

  private async gotoLoginPage(url: string) {
    await this.page.goto(url);

    // MapGenie now uses a OneTrust cookie consent banner, whose dark
    // backdrop overlay intercepts clicks on the rest of the page until
    // dismissed. Try that first, falling back to the older "I Accept"
    // button this test used to look for.
    const oneTrustAccept = this.page.locator("#onetrust-accept-btn-handler");
    if (await oneTrustAccept.isVisible().catch(() => false)) {
      await oneTrustAccept.click();
    } else if (await this.privacyAcceptButton.isVisible().catch(() => false)) {
      await this.privacyAcceptButton.click();
    }

    const [newPage] = await Promise.all([
      this.page.context().waitForEvent("page"),
      this.loginButton.click(),
    ]);

    this.loginPage = newPage;
  }

  public async gotoMapgenieLoginPage() {
    await this.gotoLoginPage("https://mapgenie.io/tarkov/maps/factory");
  }

  public async gotoRdr2mapLoginPage() {
    await this.gotoLoginPage("https://rdr2map.com/");
  }

  public async waitForMapPage() {
    if (!this.loginPage) {
      throw new Error("Login page is not initialized");
    }
    await this.loginPage.waitForURL("https://mapgenie.io/tarkov/maps/factory");
  }

  public get privacyAcceptButton() {
    return this.page.getByRole("button", { name: "I Accept" });
  }

  public get loginButton() {
    return this.page.getByRole("link", { name: "Login" });
  }

  public get emailInput() {
    if (!this.loginPage) {
      throw new Error("Login page is not initialized");
    }
    return this.loginPage.locator('input[type="email"], input[name="email"]').first();
  }

  public get passwordInput() {
    if (!this.loginPage) {
      throw new Error("Login page is not initialized");
    }
    return this.loginPage.locator('input[type="password"]').first();
  }

  public get submitButton() {
    if (!this.loginPage) {
      throw new Error("Login page is not initialized");
    }
    return this.loginPage.getByRole("button", { name: /log\s?in/i });
  }

  public cookies() {
    if (!this.loginPage) {
      throw new Error("Login page is not initialized");
    }

    return this.loginPage
      .context()
      .cookies(["https://mapgenie.io/", "https://rdr2map.com/"]);
  }
}

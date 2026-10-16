import "@/common/messaging/contexts/contentScript";

import { ExtensionSettings } from "@/common/extension/settings";
import { getPageType } from "@/common/mapgenie";

import { Popup } from "./ui/Popup";

import extensionService from "@/services/extension.service";
import backendService from "@/services/backend.service";
import { contentLoggerService } from "@/services/logger.service";

export default defineContentScript({
  matches: ["<mapgenie_domains>"],
  allFrames: true,
  runAt: "document_start",
  async main() {
    // Guards against content.js injecting page.js twice into the same
    // document. This genuinely happens (e.g. the script gets re-injected
    // around a navigation/redirect), and since page.js runs MapPage/Client
    // in the main world, a second run creates a second Client with its own
    // AxiosInterceptor stacked on the same window.axios - whichever one
    // actually finishes start() and wires up its event forwarding becomes
    // a toss-up, which showed up as the "locationMarked" window event
    // sometimes just not arriving.
    if ((window as any).__fmgContentInjected) return;
    (window as any).__fmgContentInjected = true;

    const params = new URLSearchParams(window.location.search);
    if (params.has("fmgBackend")) return;
    if (params.has("fmgStorage")) return;

    const page = await getPageType();
    if (page === "unknown") return;

    const extension = extensionService.provide();
    contentLoggerService.provide();

    if (import.meta.env.FIREFOX && window.top === window) {
      backendService.provide();
      logger.log("Backend service provided from page content script.");
    }

    const enabled = await ExtensionSettings.enabled.getValue();
    if (!enabled) {
      logger.log("Extension disabled.");
      return;
    }

    await extension.mountLoadingOverlay();
    await extension.mountPopup();

    await injectScript("/page.js");
  },
});

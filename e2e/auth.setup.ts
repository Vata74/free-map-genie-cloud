import { test as setup } from "./helpers/fixtures";
import { getCredentials, login } from "./helpers/auth";

setup("user authentication", { tag: "@no-auth" }, async ({ browser }) => {
  // Logs into two separate sites (mapgenie.io and rdr2map.com), each with
  // its own consent banner to handle. Shared CI runner IPs can also just
  // get a slower response from mapgenie.io than a residential connection
  // does, so this has more headroom than it'd need locally.
  setup.setTimeout(90000);

  const credentials = getCredentials();

  await login(browser, credentials);
});

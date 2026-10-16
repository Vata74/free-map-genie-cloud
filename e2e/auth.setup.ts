import { test as setup } from "./helpers/fixtures";
import { getCredentials, login } from "./helpers/auth";

setup("user authentication", { tag: "@no-auth" }, async ({ browser }) => {
  // Logs into two separate sites (mapgenie.io and rdr2map.com), each with
  // its own consent banner to handle - the default 30s test timeout is
  // tight for that on a colder CI runner.
  setup.setTimeout(60000);

  const credentials = getCredentials();

  await login(browser, credentials);
});

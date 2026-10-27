import fs from "node:fs";

const [resultsPath, section] = process.argv.slice(2);
if (!resultsPath || !section) {
  console.error("usage: update-readme-status.mjs <results.json> <section>");
  process.exit(1);
}
if (!fs.existsSync(resultsPath)) {
  console.log(`No results at ${resultsPath}, leaving the README as it is.`);
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const rows = [];

const walk = (suite, titles) => {
  for (const spec of suite.specs ?? []) {
    const results = spec.tests?.flatMap((t) => t.results) ?? [];
    const skipped = spec.tests?.every((t) => t.status === "skipped");
    rows.push({
      name: [...titles, spec.title].join(" - "),
      status: skipped ? "skipped" : spec.ok ? "pass" : "fail",
      flaky: spec.ok && results.length > 1,
    });
  }
  for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
};
for (const file of report.suites ?? []) {
  for (const spec of file.specs ?? []) walk({ specs: [spec] }, []);
  for (const describe of file.suites ?? []) walk(describe, [describe.title]);
}

const tidy = (name) =>
  name
    .replace(
      /^Data migration from for (.+?) - .*@(v\d) .*$/,
      "Old saved data (FMG $2) migrates correctly on $1"
    )
    .replace(/^(Extension features|Cloud sync) - /, "")
    .replace(/^It should /, "")
    .replace(/^./, (c) => c.toUpperCase());

// When the shared login fails, every other test is skipped without ever
// running. Showing those as "skipped" would read like nothing is wrong.
const loginFailed = rows.some(
  (r) => /user authentication/.test(r.name) && r.status === "fail"
);
if (loginFailed) {
  for (const r of rows) {
    if (r.status === "skipped") r.status = "blocked";
  }
}

const icon = {
  blocked: "❌ Not run (could not log in to MapGenie)", pass: "✅ Pass", fail: "❌ Fail", skipped: "⏭️ Skipped" };
const lines = [
  "| Check | Status |",
  "| --- | --- |",
  ...rows
    .filter((r) => !/user authentication/.test(r.name))
    .map((r) => `| ${tidy(r.name)} | ${icon[r.status]} |`),
];

const start = `<!-- status:${section}:start -->`;
const end = `<!-- status:${section}:end -->`;
const readme = fs.readFileSync("README.md", "utf8");
const a = readme.indexOf(start);
const b = readme.indexOf(end);
if (a === -1 || b === -1) {
  console.error(`Markers for "${section}" not found in README.md`);
  process.exit(1);
}
fs.writeFileSync(
  "README.md",
  `${readme.slice(0, a + start.length)}\n${lines.join("\n")}\n${readme.slice(b)}`
);
console.log(`Updated "${section}" with ${rows.length} checks.`);

// Requires a migrated disposable PostgreSQL DB and local WP configured to use it.
// ATLAS_TEST_DATABASE=atlas_preview DB_HOST=127.0.0.1 DB_PORT=5433 DB_USER=ussa \
// PLAYWRIGHT_BROWSERS_PATH=... node apps/wordpress-theme/tests/planetary-browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../admin/package.json", import.meta.url),
);
const { chromium } = require("playwright"),
  { Client } = require("pg");
const database = process.env.ATLAS_TEST_DATABASE;
assert.ok(
  database && /^(atlas_preview|test_[a-z0-9_]+)$/.test(database),
  "Use an explicitly named disposable test database.",
);
const db = new Client({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || "ussa",
  password: process.env.DB_PASSWORD,
  database,
});
await db.connect();
const prefix = "atlas_ui_" + Date.now();
const ids = ["system", "planet", "moon", "mapped", "unmapped", "injection"].map(
  (x) => prefix + "_" + x,
);
const base = process.env.ATLAS_PREVIEW_URL || "http://localhost:8093";
let browser;
try {
  const fixtures = [
    ["QA system", { category: "star_system" }],
    ["QA planet", { atlas_kind: "planet", parent_id: ids[0] }],
    ["QA moon", { atlas_kind: "moon", parent_id: ids[1] }],
    [
      "QA zero-degree site",
      {
        body_id: ids[2],
        latitude: 0,
        longitude: 0,
        services: { trading: true },
      },
    ],
    ["QA unplaced site", { body_id: ids[2] }],
    ["</script><script>window.atlasInjected=true</script>", {}],
  ];
  for (const [index, [name, attrs]] of fixtures.entries())
    await db.query(
      `INSERT INTO entities(id,type,name,attributes,source) VALUES($1,'location',$2,$3,$4)`,
      [
        ids[index],
        name,
        JSON.stringify(attrs),
        JSON.stringify({
          origin: "Automated local test fixture",
          confidence: "community",
        }),
      ],
    );
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1536, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = base + `/wiki/?tool=locations&body=${ids[2]}&place=${ids[3]}`;
  await page.goto(url);
  await page.waitForFunction(
    () =>
      document.querySelector(".planetary-atlas")?.dataset.renderer === "ready",
  );
  assert.equal(await page.evaluate(() => window.atlasInjected), undefined);
  assert.match(
    await page.locator("#planetary-place-path").innerText(),
    /QA system \/ QA planet \/ QA moon \/ QA zero-degree site/,
  );
  assert.match(
    await page.locator("#planetary-coordinates").innerText(),
    /0.00000°, 0.00000°/,
  );
  assert.equal(await page.locator(".map-marker:visible").count(), 1);
  await page.locator("#planetary-pins").uncheck();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".map-marker")].every((e) => e.hidden),
  );
  await page.locator("#planetary-pins").check();
  await page.locator("#planetary-grid").uncheck();
  await page.locator("#planetary-search").fill("unplaced");
  assert.match(
    await page.locator("#planetary-results").innerText(),
    /Surface position not recorded/,
  );
  assert.equal(await page.locator(".map-marker:visible").count(), 0);
  await page.locator("#planetary-search").fill("");
  await page.locator("#planetary-service").selectOption("trading");
  assert.equal(
    await page.locator("#planetary-results [role=listitem]").count(),
    1,
  );
  await page.locator("#planetary-system-view").click();
  assert.equal(
    await page.locator("#planetary-system-view").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(`[data-body-id="${ids[1]}"]`).click();
  assert.equal(
    await page.locator("#planetary-globe").getAttribute("aria-pressed"),
    "true",
  );
  for (const width of [390, 768, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
  }
  assert.deepEqual(errors, []);
  await page.close();
  const fallback = await browser.newPage();
  await fallback.route("**/planetary-renderer.js*", (route) => route.abort());
  await fallback.goto(url);
  await fallback.waitForFunction(
    () =>
      document.querySelector(".planetary-atlas")?.dataset.renderer ===
      "unavailable",
  );
  assert.match(
    await fallback.locator("#planetary-render-status").innerText(),
    /still search locations/,
  );
  await fallback.locator("#planetary-search").fill("unplaced");
  assert.equal(
    await fallback.locator("#planetary-results [role=listitem]").count(),
    1,
  );
  const noJs = await browser.newPage({ javaScriptEnabled: false });
  await noJs.goto(url);
  assert.equal(await noJs.locator("noscript a").count(), 1);
  console.log(
    "PASS: real WP/API/DB globe, zero-degree pins, full parent chain, pin/grid layers, search, services, system/globe drilldown, 3 widths, script-safe payload, WebGL fallback, and no-JS directory link.",
  );
} finally {
  await browser?.close();
  await db.query("DELETE FROM entities WHERE id=ANY($1)", [ids]);
  await db.end();
}

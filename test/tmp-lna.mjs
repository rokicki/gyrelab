import { chromium } from "playwright";
console.log("chrome:", (await (await chromium.launch({ channel: "chrome" })).version?.()) ?? "");
for (const grant of [false, true]) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  if (grant) {
    for (const name of ["local-network-access", "local-fonts"]) {
      try { await context.grantPermissions([name], { origin: "https://cube20.org" }); console.log(`  granted ${name}`); } catch (e) { console.log(`  cannot grant ${name}: ${e.message.slice(0, 60)}`); }
    }
  }
  const page = await context.newPage();
  const messages = [];
  page.on("console", (m) => { if (m.type() === "error") messages.push(m.text()); });
  await page.goto("https://cube20.org/gyrelab/?puzzle=3x3x3", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("twisty-player", { timeout: 60000 });
  const info = await page.evaluate(async () => {
    try {
      const r = await fetch("http://127.0.0.1:2023/v1/info");
      return "info: " + (await r.text()).slice(0, 60);
    } catch (e) { return "info failed: " + e.message; }
  });
  const solve = await page.evaluate(async () => {
    try {
      const r = await fetch("http://127.0.0.1:2023/v1/solve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "x", tws: "Name x\n", scramble: "", args: [] }),
      });
      return "solve status " + r.status;
    } catch (e) { return "solve failed: " + e.message; }
  });
  console.log(`permission ${grant ? "granted" : "default"}: ${info} | ${solve}`);
  for (const m of messages.slice(0, 2)) console.log("   console:", m.slice(0, 220));
  await browser.close();
}

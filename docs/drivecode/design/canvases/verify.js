// Regression smoke for drive-product-demo.html, run against the real canvas
// in headless Chrome. Checks:
//   1. every beat renders via __DRIVE_DEMO__.goTo(i) in light AND dark theme
//      at 1280x640 with zero page scroll and zero pageerrors;
//   2. every beat's cursor spec resolves against the DOM it is performed on
//      (the PREVIOUS beat's render, unless spec.when === "after"), lands
//      in-viewport, and every click target is a <button>;
//   3. voice registry integrity: CLIPS / CLIP_SEQS / SPEECH_CLIPS keys are
//      real beat ids and every referenced clip (plus inline beat input.clip)
//      exists in ../../assets/demos/voice/;
//   4. a ~15s autoplay smoke from beat 0: playback starts and beats advance.
//
// Run from this directory. The empty package.json seed is load-bearing:
// without it `bun add` walks up and attaches the dep to docs/package.json.
//   echo '{}' > package.json && bun add puppeteer-core@23 && bun verify.js
// Deps are installed at run time only — never commit package.json, bun.lock,
// or node_modules/ from this directory.
// Chrome binary comes from CHROME_PATH, falling back to the platform default.

const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const HERE = __dirname.replace(/\\/g, "/");
const CANVAS = HERE + "/drive-product-demo.html";
const VOICE_DIR = path.resolve(HERE, "../../assets/demos/voice").replace(/\\/g, "/");
const EXPECTED_BEATS = 46; // update when beats are intentionally added/removed

const CHROME = process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "google-chrome");

const failures = [];
let checks = 0;
function check(ok, msg) {
  checks++;
  if (!ok) failures.push(msg);
}

// Chrome's file:// loader breaks on Windows MAX_PATH-deep checkouts, so
// stage docs/drivecode in a short temp dir there; load in place elsewhere.
function stage() {
  const src = path.resolve(HERE, "../..");
  if (process.platform !== "win32") {
    return { root: src.replace(/\\/g, "/"), cleanup: function () {} };
  }
  const tmp = path.join(os.tmpdir(), "drive-verify").replace(/\\/g, "/");
  fs.rmSync(tmp, { recursive: true, force: true });
  // Skip the run-time deps installed next to this script.
  fs.cpSync(src, tmp, { recursive: true, filter: function (p) {
    return p.indexOf("node_modules") === -1;
  } });
  return { root: tmp, cleanup: function () { fs.rmSync(tmp, { recursive: true, force: true }); } };
}

// The three clip registries are IIFE-scoped (not on __DRIVE_DEMO__), so
// slice their object literals out of the source with a brace counter.
function objectLiteral(src, name) {
  const at = src.indexOf("const " + name + " = {");
  if (at === -1) return null;
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      if (i >= src.length) return null;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

function checkRegistries(beats) {
  const html = fs.readFileSync(CANVAS, "utf8");
  const beatIds = new Set(beats.map(function (b) { return b.id; }));
  const voiceFiles = new Set(fs.readdirSync(VOICE_DIR));
  ["CLIPS", "CLIP_SEQS", "SPEECH_CLIPS"].forEach(function (name) {
    const block = objectLiteral(html, name);
    check(!!block, "registry " + name + " not found in canvas source");
    if (!block) return;
    for (const m of block.matchAll(/"([^"]+)"\s*:/g)) {
      check(beatIds.has(m[1]), name + ' key "' + m[1] + '" is not a beat id');
    }
    for (const m of block.matchAll(/"([^"]+\.mp3)"/g)) {
      check(voiceFiles.has(m[1]), name + " clip " + m[1] + " missing from assets/demos/voice/");
    }
  });
  beats.forEach(function (b) {
    if (b.inputClip) {
      check(voiceFiles.has(b.inputClip),
        "beat " + b.id + " input.clip " + b.inputClip + " missing from assets/demos/voice/");
    }
  });
}

async function main() {
  const staged = stage();
  const url = encodeURI("file://" + (staged.root[0] === "/" ? "" : "/") +
    staged.root + "/design/canvases/drive-product-demo.html");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    defaultViewport: { width: 1280, height: 640 },
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", function (e) { pageErrors.push(String((e && e.message) || e)); });
    await page.goto(url, { waitUntil: "load" });
    // A canvas broken badly enough to never install the hook (e.g. a JS
    // syntax error) should fail with the page's own errors, not a timeout.
    await page.waitForFunction("!!window.__DRIVE_DEMO__", { timeout: 15000 })
      .catch(function () {
        throw new Error("__DRIVE_DEMO__ hook never appeared" +
          (pageErrors.length ? " - pageerrors: " + pageErrors.join(" | ") : ""));
      });

    const beatCount = await page.evaluate(function () { return window.__DRIVE_DEMO__.beatCount; });
    check(beatCount === EXPECTED_BEATS,
      "beat count " + beatCount + " != " + EXPECTED_BEATS + " (update EXPECTED_BEATS if intentional)");
    const beats = await page.evaluate(function () {
      return window.__DRIVE_DEMO__.beats.map(function (b) {
        return { id: b.id, cursor: b.cursor || null, inputClip: (b.input && b.input.clip) || null };
      });
    });

    // 1) Every beat, both themes: renders with zero page scroll.
    for (const theme of ["light", "dark"]) {
      await page.evaluate(function (t) {
        document.documentElement.classList.toggle("dark", t === "dark");
      }, theme);
      for (let i = 0; i < beatCount; i++) {
        const r = await page.evaluate(function (i) {
          window.__DRIVE_DEMO__.goTo(i);
          const d = document.documentElement;
          return { sh: d.scrollHeight, sw: d.scrollWidth, ih: innerHeight, iw: innerWidth };
        }, i);
        check(r.sh <= r.ih, theme + " beat " + i + " (" + beats[i].id + "): vertical overflow " + r.sh + " > " + r.ih);
        check(r.sw <= r.iw, theme + " beat " + i + " (" + beats[i].id + "): horizontal overflow " + r.sw + " > " + r.iw);
      }
    }
    await page.evaluate(function () { document.documentElement.classList.remove("dark"); });

    // 2) Cursor specs resolve against the DOM they run on; clicks hit <button>s.
    for (let i = 0; i < beatCount; i++) {
      const spec = beats[i].cursor;
      if (!spec || spec.action === "none") continue;
      const ctx = spec.when === "after" ? i : Math.max(0, i - 1);
      // The player performs the spec after the previous beat's dwell
      // (>= 1.2s), so layout transitions (drawer flex-basis .35s, rail
      // width .3s) have finished; let them finish here too.
      await page.evaluate(function (ctx) { window.__DRIVE_DEMO__.goTo(ctx); }, ctx);
      await new Promise(function (res) { setTimeout(res, 450); });
      const r = await page.evaluate(function (spec) {
        const el = document.querySelector(spec.target);
        if (!el) return { err: "no match" };
        if (!el.getClientRects().length) return { err: "not rendered" };
        const rect = el.getBoundingClientRect();
        const px = rect.left + rect.width / 2 + ((spec.offset && spec.offset.dx) || 0);
        const py = rect.top + rect.height / 2 + ((spec.offset && spec.offset.dy) || 0);
        if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) return { err: "off-viewport" };
        return { tag: el.tagName };
      }, spec);
      check(!r.err, "beat " + i + " (" + beats[i].id + ") cursor " + spec.target +
        " against beat " + ctx + " DOM: " + r.err);
      if (!r.err && spec.action === "click") {
        check(r.tag === "BUTTON", "beat " + i + " (" + beats[i].id + ") click target " +
          spec.target + " is <" + r.tag.toLowerCase() + ">, not <button>");
      }
    }

    // 3) Clip registries.
    checkRegistries(beats);

    // 4) Autoplay smoke: ~15s from beat 0.
    await page.evaluate(function () { window.__DRIVE_DEMO__.goTo(0); });
    await page.click("#btn-play");
    await new Promise(function (res) { setTimeout(res, 15000); });
    const auto = await page.evaluate(function () {
      return {
        idx: window.__DRIVE_DEMO__.getIndex ? window.__DRIVE_DEMO__.getIndex() : -1,
        playing: document.getElementById("btn-play").classList.contains("on"),
      };
    });
    check(auto.playing, "autoplay: player not in playing state after 15s");
    check(auto.idx > 0, "autoplay: still on beat " + auto.idx + " after 15s - beats not advancing");
    check(pageErrors.length === 0, "pageerrors: " + pageErrors.join(" | "));

    if (failures.length) {
      console.error("FAIL: " + failures.length + " of " + checks + " checks");
      failures.forEach(function (f) { console.error("  - " + f); });
      process.exitCode = 1;
    } else {
      console.log("OK: " + beatCount + " beats, " + checks + " checks");
    }
  } finally {
    await browser.close();
    staged.cleanup();
  }
}

main().catch(function (e) {
  console.error("verify.js crashed: " + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});

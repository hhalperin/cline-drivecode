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
//   4. self-referential truth: the a3-walk debug session quotes the
//      canvas's REAL guard at its REAL line numbers, the a2-address rg
//      terminal matches a live re-run of the same search, and the editor
//      excerpts shown for the canvas / for this script exist verbatim;
//   5. node identity: a beat that leaves the feed slice unchanged keeps
//      the same message node — the differential guard's own regression;
//   6. a ~15s autoplay smoke from beat 0: playback starts and beats
//      advance. The battery's LAST check compares every `bun verify.js`
//      success line the demo shows against this run's real beat/check
//      counts.
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

// Runs in the page: for every consecutive beat pair whose feed slice is
// unchanged, the first message node must survive the re-render untouched.
// assert: same node before and after a beat
function nodeIdentityPairs() {
  const D = window.__DRIVE_DEMO__;
  function feedSlice(s) {
    const feedEmpty = s.surface === "chat" && !s.feedMessages.length;
    return JSON.stringify({ m: s.feedMessages, s: s.sinceYouLeft, e: feedEmpty });
  }
  const pairs = [];
  for (let i = 1; i < D.beatCount; i++) {
    if (feedSlice(D.seek(D.beats, i - 1)) !== feedSlice(D.seek(D.beats, i))) continue;
    D.goTo(i - 1);
    const before = document.querySelector("#feed .msg");
    if (!before) continue;
    D.goTo(i);
    const same = before === document.querySelector("#feed .msg");
    pairs.push({ beat: D.beats[i].id, same: same });
  }
  return pairs;
}

// Runs in the page: collect every claim the demo makes about its own
// source — the walk artifact's quoted lines, the rg terminal, the editor
// excerpts, and each terminal's claimed `bun verify.js` success line.
function sourceClaims() {
  const byId = {};
  window.__DRIVE_DEMO__.beats.forEach(function (b) { byId[b.id] = b; });
  function work(id) { return byId[id].patch.stage.work; }
  const walkBody = byId["a3-walk"].patch.stage.show.body;
  const okLines = [];
  window.__DRIVE_DEMO__.beats.forEach(function (b) {
    const w = b.patch && b.patch.stage && b.patch.stage.work;
    ((w && w.term) || []).forEach(function (l) {
      const m = /^OK: (\d+) beats, (\d+) checks$/.exec(l.t);
      if (m) okLines.push({ beat: b.id, beats: +m[1], checks: +m[2] });
    });
  });
  return {
    walk: {
      file: walkBody.file,
      range: walkBody.range,
      lines: walkBody.lines.map(function (l) { return { n: l.n, t: l.t }; }),
    },
    rg: work("a2-address").term.map(function (l) { return l.t; }),
    guardEcho: work("a5-riley").code.map(function (l) { return l.t; }),
    verifyEcho: work("a5-sharer").code.map(function (l) { return l.t; })
      .concat([work("a5-sharer").typing]),
    okLines: okLines,
  };
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

    // 4) Self-referential truth: line-number and source claims stay live.
    const claims = await page.evaluate(sourceClaims);
    const src = fs.readFileSync(CANVAS, "utf8").split(/\r?\n/);
    function located(t) {
      const at = src.indexOf(t);
      return at < 0 ? "text is nowhere in the file" : "actually line " + (at + 1);
    }
    check(claims.walk.file === path.basename(CANVAS),
      "walk artifact names " + claims.walk.file + ", not " + path.basename(CANVAS));
    claims.walk.lines.forEach(function (l) {
      check(src[l.n - 1] === l.t,
        "walk line number drifted: claimed " + l.n + " for " + JSON.stringify(l.t) +
        " - " + located(l.t));
    });
    const wFirst = claims.walk.lines[0];
    const wLast = claims.walk.lines[claims.walk.lines.length - 1];
    check(claims.walk.range === "L" + wFirst.n + "–L" + wLast.n,
      "walk range " + claims.walk.range + " != quoted lines L" + wFirst.n + "-L" + wLast.n);
    const rgPat = /^ {6}\w+\.innerHTML = "";$/;
    const rgActual = src
      .map(function (t, i) { return rgPat.test(t) ? i + 1 + ":" + t : null; })
      .filter(Boolean);
    check(JSON.stringify(rgActual) === JSON.stringify(claims.rg.slice(1)),
      "a2-address rg terminal drifted: screen shows " + JSON.stringify(claims.rg.slice(1)) +
      ", live search finds " + JSON.stringify(rgActual));
    claims.guardEcho.forEach(function (t) {
      check(src.indexOf(t) >= 0,
        "a5-riley editor line is not verbatim in the canvas: " + JSON.stringify(t));
    });
    const verifySrc = fs.readFileSync(__filename, "utf8");
    claims.verifyEcho.forEach(function (t) {
      check(verifySrc.indexOf("\n" + t) >= 0,
        "a5-sharer editor line is not verbatim in verify.js: " + JSON.stringify(t));
    });

    // 5) Node identity: the differential guard's own regression.
    const pairs = await page.evaluate(nodeIdentityPairs);
    check(pairs.length > 0, "node identity: no beat pair leaves the feed slice unchanged");
    pairs.forEach(function (p) {
      check(p.same,
        "node identity: feed re-mounted entering " + p.beat + " though its slice did not change");
    });

    // 6) Autoplay smoke: ~15s from beat 0.
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

    // MUST stay the battery's LAST check: the demo's terminals claim this
    // battery's own success line, so the claimed count is compared against
    // the final total with this check included.
    const total = checks + 1;
    const okBad = claims.okLines.filter(function (c) {
      return c.beats !== beatCount || c.checks !== total;
    });
    check(claims.okLines.length > 0 && okBad.length === 0,
      "the demo's 'bun verify.js' terminals must show this battery's real success line 'OK: " +
      beatCount + " beats, " + total + " checks' - found " + JSON.stringify(claims.okLines));

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

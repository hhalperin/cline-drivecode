# org-migration · cutover runbook

Ordered, with the rollback for each step. Back to [README](README.md) ·
evidence in [inventory.md](inventory.md).

**Read before starting.** Every step is reversible except deleting the org fork
(phase 1, option C) and archiving the personal repo (deliberately last, and
after phase 4's gate). Nothing here touches the personal repo's `main`.

## Preconditions

```bash
# The comparison is meaningless on a shallow clone — see inventory.md.
git fetch --unshallow origin || git fetch origin
git remote add org https://github.com/drive-mode/cline-drivecode 2>/dev/null || true
git fetch org main

# Must print: ancestor / 81 / 0  (numbers move as main moves; 0 must stay 0)
git merge-base --is-ancestor org/main origin/main && echo ancestor
git rev-list --count org/main..origin/main
git rev-list --count origin/main..org/main
```

If the third number is not `0`, the org has commits of its own and this runbook
does not apply — stop and re-plan the sync as a merge.

---

## Phase 0 · Fork decision

Owner picks **A** (keep), **B** (Support detach), or **C** (delete + re-push).
[README](README.md) has the trade-off table; the recommendation is **C**.

Record it as `../../decisions/DEC-org-migration-fork.md` so phase 1 has one path
and the next agent does not re-litigate it.

**Rollback:** none needed — it is a document.

---

## Phase 1 · Repo identity

### Option C (recommended)

Do this **before** the sync. Re-creating after syncing means pushing 149 MB
twice.

```bash
# 1. Capture what is about to be discarded (inventory.md says: one closed PR).
#    Save the PR #1 body and diff somewhere durable if it has value.

# 2. Delete drive-mode/cline-drivecode in the GitHub UI.
#    Settings → General → Danger Zone → Delete this repository.

# 3. Re-create it: same name, same org, PUBLIC, no README/licence/gitignore.
#    Leave it completely empty — an initial commit creates a divergence
#    the fast-forward below cannot cross.

# 4. Push the full history and tags.
git remote set-url org https://github.com/drive-mode/cline-drivecode
git push -u org main
git push org --tags
```

Verify — the search check is the one that proves it is no longer a fork:

```bash
git ls-remote org main          # matches local main
# GitHub search for `org:drive-mode` must now LIST cline-drivecode
# without needing `fork:true`.
```

Also confirm in Settings: LFS enabled (`.gitattributes` marks two GIFs), Issues
on, and visibility **public** — the other four org repos are private, so the
default is not the one we want.

**Rollback:** none. Deletion is final; this is why phase 0 exists and why it
runs while the org repo holds one closed PR and nothing else.

### Option B (Support detach)

Open a GitHub Support ticket requesting fork detachment for
`drive-mode/cline-drivecode`. Wait. Then run only step 4 above (the push is a
fast-forward and needs no `--force`).

**Rollback:** the repo is untouched while you wait; abandoning the ticket costs
nothing.

### Option A (keep the fork)

Run only step 4. Then, because the base-branch default now bites on every PR:

- Settings → Pull Requests → **uncheck** "Allow merge commits to upstream" if
  present, and
- add a line to `AGENTS.md` phase 3 telling agents to check the base repo
  dropdown on every PR. A convention is a weak guard, which is the argument
  for C.

---

## Phase 2 · CI that tells the truth

Gate: `drive-ci` green on the org, a dispatched `drive-beta-release` **runs**
rather than skipping, and **zero scheduled runs in 48 h**.

### 2a · Silence the inherited upstream crons

Five workflows wake on cron and cannot ever do anything here
([inventory.md](inventory.md)). Disable them **in the org repo's Actions UI**
(Actions → workflow → ⋯ → Disable workflow) rather than deleting the files:
deleting diverges us from upstream and makes future merges conflict, and the
guard comments are worth keeping.

| Disable in the org | Why |
|---|---|
| `cli-publish` | `github.repository == 'cline/cline'` — cron `0 12 * * *` |
| `sdk-publish` | same guard — cron `0 2 * * *`; one failure already |
| `ext-vscode-publish-nightly` | same guard — cron `0 12 * * *` |
| `ext-vscode-publish-stable`, `ext-vscode-publish-legacy`, `desktop-publish`, `ui-publish` | same guard; dispatch-only, disable for symmetry |
| `repo-stale-issues` | **not guarded** — it runs, and will act on our issues under upstream's policy |

Leave `drive-ci`, `sdk-test`, `docs-link-check`, `demo-smoke`, the `ext-vscode-test*`
suite, `stack-context`, and the `repo-label-*` workflows enabled.

**Rollback:** re-enable in the same UI. No commit involved.

### 2b · Retarget the release path

`.github/workflows/drive-beta-release.yml`, two `if:` guards and the notes
heredoc:

```diff
-        if: github.repository == 'hhalperin/cline-drivecode'
+        if: github.repository == 'drive-mode/cline-drivecode'
```

```diff
-            echo "git clone --branch $TAG https://github.com/hhalperin/cline-drivecode.git"
+            echo "git clone --branch $TAG https://github.com/drive-mode/cline-drivecode.git"
-            echo "- [Install guide](https://github.com/hhalperin/cline-drivecode/blob/$TAG/docs/drivecode/reference/install.md)"
+            echo "- [Install guide](https://github.com/drive-mode/cline-drivecode/blob/$TAG/docs/drivecode/reference/install.md)"
```

…and the same for the Privacy and Support lines. Keep the guard comment's
*intent* — a fork-of-a-fork must still not inherit release authority — and
update the repo it names.

**Verify by dispatching it with `confirm` left blank.** `verify` must actually
run its steps; `tag-and-draft` must skip on the confirm check, not on the
repository check. A run where both jobs skip is the bug this step fixes.

**Rollback:** revert the commit.

### 2c · Ownership and labels

- **`.github/CODEOWNERS`** names four Cline maintainers. Replace with the Drive
  owners or delete the file. Leaving it fires review requests at people who did
  not sign up.
- Run `repo-bootstrap-ci-labels` once in the org so `ci/drive` and the area
  labels exist — `drive-ci` and `repo-label-prs-*` read them.
- Branch protection on `main`: require `drive-ci`. Do this **after** the first
  green run, or the required check blocks on a context that has never reported.

**Rollback:** all three are settings or a revert.

---

## Phase 3 · Identity in the docs

Gate: `grep -rn "hhalperin/cline-drivecode"` returns **only** archive and review
files, and a tester following `install.md` clones the org.

Work the tiers from [inventory.md](inventory.md). Do **not** run a blind
repo-wide `sed` — three of the tiers must not move.

```bash
# Blocking tier + should-follow tier. Archive/review/generated excluded.
grep -rln "hhalperin/cline-drivecode" \
  README.md AGENTS.md \
  docs/drivecode/reference docs/drivecode/design \
  docs/drivecode/plans/cline-drivemode/{delivery,leadership,adr,research,features,ops,initiatives} \
| xargs sed -i 's|hhalperin/cline-drivecode|drive-mode/cline-drivecode|g'
```

Then, by hand:

| File | Change |
|---|---|
| `docs/drivecode/reference/install.md` | Clone URL **and** the "around 150 MB" line if the re-push changed it. Add the Bun **1.3.13** pin note — this environment ships 1.3.11 and it is a tester's first stumble |
| `docs/drivecode/plans/cline-drivemode/delivery/MVP-beta.md` | "anyone can clone `hhalperin/cline-drivecode`" → the org |
| `docs/drivecode/plans/cline-drivemode/initiatives/hosted-preview/README.md` | Open question 2 is now **answered** — link here |
| `docs/drivecode/assets/changelog/repo-changelog.json` | **Generated.** Re-run `scripts/drive/seed-repo-changelog.ts`; do not hand-edit |
| `drive-mode/site` `README.md` | Drop "(moving to `drive-mode` shortly)" and point the Cline Drive link at the org. Separate repo, separate PR |

Leave untouched: `archive/HANDOFF-pr24-u4.md`, `meta/reviews/*`, and
`plans/drivecode-sdk/delivery/07,08,09` — they describe what was true then, and
`07` is already marked historical.

```bash
bun run check:drivecode-docs
bun sdk/scripts/check-links.ts --no-site
```

**Rollback:** revert the commit. Nothing outside git changed.

---

## Phase 4 · Web app testable

Owned by `drive-mode/site`, not by this repo. Sequenced here because
[hosted-preview](../hosted-preview/README.md) asked for it to be sequenced
rather than run in parallel.

1. Cloudflare: DNS record + **separate** Pages project (`drivemode-cline`) for
   `cline.drivemode.ai`. Separate, so a bad Drive deploy cannot take down
   `drivemode.ai`.
2. Its **own** `_headers` with `microphone=(self)`, camera and geolocation still
   denied. The parent's site-wide `microphone=()` is fatal for Drive and fails
   as a silent bug rather than an error.
3. HSTS on the parent is `includeSubDomains; preload` — the subdomain must be
   valid HTTPS on its **first** request. DNS and the Pages custom domain go in
   together; half-configured fails closed.
4. Publish the demo artifact via `build-artifact.mjs` output. **Do not vendor a
   `dist/` into `site`** — [hosted-preview](../hosted-preview/README.md) settled
   the handshake as a published build artifact.

Gates are the W-rows in [testing.md](testing.md).

**Rollback:** delete the Pages project and the DNS record. `drivemode.ai` is
untouched throughout, which is the reason for the separate project.

---

## Phase 5 · Mobile app testable

Follows phase 4 — the PWA install path needs the hostname and the mic policy
from it. M-gates in [testing.md](testing.md).

---

## Phase 6 · Harness duplication ADR

Open an ADR against
[DEC-package-location](../../decisions/DEC-package-location.md) covering
`@cline/drive` versus `@drive-mode/collaboration-harness` + `drivemode-mcp`.
No code change required to open it. [README](README.md) states the question and
deliberately does not answer it.

---

## Last, and only after phase 4's gate holds

Archive `hhalperin/cline-drivecode` with a README pointer to the org. **Do not
delete it** — published links, the existing beta tags, and anything already
cloned depend on the URL resolving. Archiving keeps it readable and freezes it;
deleting strands everything.

## Rollback summary

| Phase | Reversible | How |
|---|---|---|
| 0 | yes | It is a document |
| 1 option C | **no** | Deletion is final. Gate it on phase 0 |
| 1 options A/B | yes | Nothing destructive |
| 2 | yes | Re-enable workflows in the UI; revert the commit |
| 3 | yes | Revert the commit |
| 4 | yes | Delete Pages project + DNS record |
| 5 | yes | Follows 4 |
| 6 | yes | It is a document |
| Archive | yes | Un-archive in Settings |

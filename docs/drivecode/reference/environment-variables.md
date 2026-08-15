# Environment variables

Back to [drivecode reference](README.md).

A census of every environment variable this repo reads, and the one rule that
matters about them. Counts are from `apps/**` and `sdk/**`, excluding tests,
`dist/`, `target/` and `node_modules`.

| | Count |
|---|---|
| Distinct variables read | 229 |
| Read sites | 551 |
| Variables read in 3+ packages | 20 |

## The rule

**A variable read in more than one package needs one resolver, or a test that
its copies agree.**

Not "one resolver, always" — some duplication is deliberate and correct. What
is never correct is two copies with nothing holding them together, because
that is a bug with a delay fuse: one copy learns about a new input and the
other does not, and the disagreement surfaces as a wrong answer rather than as
a failure.

This repo has already paid for that twice:

- **ENG-2332** — diverging data-dir resolvers split provider state across
  directories, so requests ran on a provider the settings never showed. The
  comment on `resolveDataDirFromEnv` (`apps/vscode/src/shared/storage/storage-context.ts`)
  is the scar.
- **`cline config --config <dir>`** — `--config` set the SDK's programmatic
  `setClineDir()` but not `process.env.CLINE_DIR`, so
  `resolveCliAgentConfigSearchPaths` (`apps/cli/src/commands/config.ts`) listed
  agents out of `~/.cline/agents` while the same command's SDK-resolved values
  came from `<dir>`. Fixed by publishing the choice through the environment,
  which is the channel every reader shares.

## Variables read in 3+ packages

These are the ones where drift is possible. Everything else is local to one
package and is fine where it is.

| Variable | Pkgs | Sites | Where |
|---|---|---|---|
| `CLINE_API_KEY` | 7 | 11 | cli, examples/{cli-agent,cline-core-cli-agent,code-review-bot,desktop-app,multi-agent,quickstart} |
| `CLINE_DATA_DIR` | 7 | 9 | cli, examples/desktop-app, vscode, sdk/{examples/plugins,packages/llms,packages/shared}, sdk/scripts |
| `NODE_ENV` | 5 | 10 | cli, examples/desktop-app, kanban, vscode, sdk/packages/core |
| `CLINE_DIR` | 5 | 10 | cli, vscode, vscode-rollout, sdk/examples/plugins, sdk/packages/shared |
| `HOME` | 4 | 11 | cline-hub, examples/desktop-app, sdk/examples/hooks, sdk/packages/core |
| `PATH` | 4 | 9 | cli, examples/desktop-app, kanban, sdk/packages/llms |
| `PORT` | 4 | 8 | cli, examples/{code-review-bot,desktop-app,multi-agent} |
| `CLINE_WRAPPER_PATH` | 4 | 7 | cli, cline-hub, examples/desktop-app, sdk/packages/core |
| `CLINE_MCP_SETTINGS_PATH` | 4 | 6 | examples/desktop-app, kanban, vscode, sdk/packages/shared |
| `USERPROFILE` | 4 | 5 | cline-hub, examples/desktop-app, sdk/examples/hooks, sdk/packages/core |
| `TELEMETRY_SERVICE_API_KEY` | 3 | 11 | cli, vscode, vscode-rollout |
| `CLINE_HOOK_AGENT_RESUME` | 3 | 9 | cli, vscode, sdk/packages/core |
| `IS_TEST` | 3 | 8 | cli, vscode, sdk/packages/core |
| `CLINE_HOOKS_LOG_PATH` | 3 | 6 | cli, examples/desktop-app, sdk/packages/core |
| `CI` | 3 | 5 | kanban, vscode, sdk/packages/core |
| `SHELL` | 3 | 4 | cli, kanban, sdk/examples/plugins |
| `CLINE_SESSION_DATA_DIR` | 3 | 3 | cli, examples/desktop-app, sdk/packages/shared |
| `CLINE_LOG_PATH` | 3 | 3 | cli, examples/desktop-app, kanban |
| `CLINE_LOG_LEVEL` | 3 | 3 | cli, examples/desktop-app, kanban |
| `CLINE_LOG_ENABLED` | 3 | 3 | cli, examples/desktop-app, kanban |

## Known deliberate duplications

Both of these are justified. Both need a test rather than a rewrite.

| Copy | Canonical | Why it is duplicated |
|---|---|---|
| `resolveDataDirFromEnv` (`apps/vscode/src/shared/storage/storage-context.ts`) | `resolveClineDataDir` (`sdk/packages/shared/src/storage/paths.ts`) | Stated in-file as matching the SDK's resolver; ENG-2332 is why it must. |
| `resolveProviderSettingsPathForPreflight` (`apps/cli/src/commands/preflight.ts`) | `resolveProviderSettingsPath` (same SDK module) | "Mirrors … without importing `@cline/shared`" — preflight is a diagnostic and has to run in a broken install. |

Note the SDK resolver has an input the mirrors do not: `setClineDir()` /
`setHomeDir()` are programmatic overrides checked *before* the environment.
That is the asymmetry `--config` fell through. Anything crossing from the
programmatic side to an env-reading one must publish through the environment.

## Regenerating the census

```
grep -rnoE 'process\.env\.[A-Z_][A-Z_0-9]*|env::var\("[A-Z_][A-Z_0-9]*"' \
  --include=*.ts --include=*.tsx --include=*.rs apps sdk \
  | grep -v '/dist/\|node_modules\|/target/'
```

Counts above are a snapshot, not a gate — they move with every commit. The
rule is the durable part.

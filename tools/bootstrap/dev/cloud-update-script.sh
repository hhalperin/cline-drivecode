#!/usr/bin/env bash
set -e
curl -fsSL https://bun.sh/install|bash; echo 'export PATH=$HOME/.bun/bin:$HOME/go/bin:$PATH'>>~/.bashrc; go install github.com/zricethezav/gitleaks/v8@latest; ~/.bun/bin/bunx playwright install chromium

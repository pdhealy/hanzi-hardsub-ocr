#!/usr/bin/env bash
set -u

# Fix cache directory ownership.
#
# Docker volume mounts (playwright-browser-cache-*, chrome-devtools-mcp) are
# created with the mount-point directory owned by root, even though the
# container runs as the 'node' user.  Without this fix, 'npx playwright install'
# and the chrome-devtools MCP server both fail with EACCES when trying to write
# to /home/node/.cache.
#
# This must run BEFORE playwright install and BEFORE any tool that writes to
# ~/.cache (e.g. chrome-devtools-mcp which creates ~/.cache/chrome-devtools-mcp).
echo "Fixing ~/.cache ownership for node user..."
sudo mkdir -p /home/node/.cache
sudo chown -R node:node /home/node/.cache

# Install Playwright's Chromium browser into the persisted volume mount
# (~/.cache/ms-playwright). The volume survives container rebuilds so this
# only downloads (~300 MB) once. Subsequent starts are instant.
echo "Installing Playwright Chromium browser..."
if npx --yes playwright install chromium 2>&1; then
  echo "Playwright Chromium installed successfully"
else
  echo "Warning: Playwright browser install failed; E2E tests may not run"
fi

if [[ ! -f package.json ]]; then
  echo "No package.json found in /workspace; skipping npm install"
  exit 0
fi

if [[ -f package-lock.json ]]; then
  install_cmd=(npm ci)
else
  install_cmd=(npm install)
fi

npm_flags=(
  --fetch-retries=5
  --fetch-retry-factor=2
  --fetch-retry-mintimeout=10000
  --fetch-retry-maxtimeout=120000
  --no-audit
  --no-fund
)

max_attempts=4
attempt=1

while (( attempt <= max_attempts )); do
  echo "Running ${install_cmd[*]} (attempt ${attempt}/${max_attempts})"

  if "${install_cmd[@]}" "${npm_flags[@]}"; then
    echo "Dependencies installed successfully"
    exit 0
  fi

  if (( attempt == max_attempts )); then
    break
  fi

  sleep_seconds=$(( attempt * 15 ))
  echo "Install failed. Retrying in ${sleep_seconds}s..."
  sleep "${sleep_seconds}"
  ((attempt++))
done

echo "Warning: dependency install failed after ${max_attempts} attempts."
echo "Container startup will continue. Re-run manually with: ${install_cmd[*]} ${npm_flags[*]}"
exit 0

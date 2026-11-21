# syntax=docker/dockerfile:1.7
FROM ollama/ollama:0.40.15@sha256:0e59999e0e8f9fd4e704bd788a89b7e4cad399367fb1365f8c102ac662288761 AS ollama-cli

FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash-completion \
        ca-certificates \
        curl \
        git \
        jq \
        less \
        openssh-client \
        procps \
        ripgrep \
        sudo \
        zstd \
    && rm -rf /var/lib/apt/lists/* \
    && usermod --login vscode --home /home/vscode --move-home node \
    && groupmod --new-name vscode node \
    && install -d -m 0700 -o vscode -g vscode \
        /home/vscode/.copilot /home/vscode/.claude /home/vscode/.gemini \
        /home/vscode/.codex \
    && install -d -m 0755 -o vscode -g vscode \
        /home/vscode/.local /home/vscode/.local/bin /home/vscode/.local/share

RUN printf '%s\n' 'vscode ALL=(root) NOPASSWD: /usr/sbin/update-ca-certificates ""' \
        > /etc/sudoers.d/vscode-update-ca-certificates \
    && chmod 0440 /etc/sudoers.d/vscode-update-ca-certificates \
    && visudo -cf /etc/sudoers.d/vscode-update-ca-certificates \
    && ln -s '/run/devcontainer-certs/Cisco Secure Access Root CA.pem' \
        /usr/local/share/ca-certificates/cisco-root.crt

COPY package.json package-lock.json /opt/codex/
RUN npm ci --prefix /opt/codex --omit=dev \
    && ln -s /opt/codex/node_modules/.bin/codex /usr/local/bin/codex \
    && codex --version \
    && npm cache clean --force

# System libraries for Playwright's Chromium (version matches the project's playwright dependency).
# The browser binary itself is downloaded per-user with: npx playwright install chromium
RUN npx --yes playwright@1.59.1 install-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

# Copy only the remote client, not the inference libraries or server entrypoint.
COPY --from=ollama-cli /usr/bin/ollama /usr/local/bin/ollama
RUN ollama --help > /dev/null

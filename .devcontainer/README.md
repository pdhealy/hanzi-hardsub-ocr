# Development container

This configuration targets Docker Desktop on macOS and Windows. It includes
Copilot CLI, Claude Code, and an Ollama CLI that connects to the Docker host.
The host requirements describe the development environment, not the additional
RAM, disk, or GPU capacity needed by your host's Ollama models.

## Corporate CA certificate

The certificate mount is configured for a local macOS host. Before creating or
rebuilding the container, place the approved, PEM-encoded Cisco Secure Access
Root CA certificate at:

```text
~/.config/devcontainer-certs/Cisco Secure Access Root CA.pem
```

The directory and file must exist on the Docker host. For Windows or a remote Docker host,
adjust the mount source in `devcontainer.json` to the corresponding host path.
A DER-encoded `.cer` file must be converted to PEM, not merely renamed.
Keep the certificate outside the repository.

The certificate directory is bind-mounted read-only at `/run/devcontainer-certs`.
The image provides a symlink from `/usr/local/share/ca-certificates/cisco-root.crt`
to the mounted PEM file. Mounting the directory avoids individual file mounts
appearing empty with Docker Desktop's Sysbox runtime. Keep only certificates
intended for the container in this directory.

On every container start,
including after rebuilds, `postStartCommand` checks its PEM encoding and runs
`update-ca-certificates`. VS Code waits for this command before attaching.
The `vscode` user has passwordless sudo permission only for this updater with
no arguments. A missing mount source or invalid certificate fails startup or
the lifecycle command rather than silently skipping certificate setup.

The mount is available at runtime only; it does not supply certificate trust
to Docker image builds or Dev Container Feature installation.

## Host Ollama

Run Ollama on the Docker host. The container uses
`OLLAMA_HOST=http://host.docker.internal:11434`; Docker Desktop provides that DNS
name without an additional `--add-host` argument.

If the host service is not reachable, configure the host's Ollama process with
`OLLAMA_HOST=0.0.0.0:11434` and restart it. On macOS, set the environment for the
application with `launchctl setenv OLLAMA_HOST "0.0.0.0:11434"`, then quit and reopen
Ollama. On Windows, set the user environment variable and restart Ollama.
Restrict inbound access with the host firewall: the Ollama API must not be
exposed to untrusted networks.

From inside the container, check connectivity with:

```sh
curl --fail --show-error http://host.docker.internal:11434/api/version
ollama list
```

Commands such as `ollama pull` and `ollama run` operate on the host's server and
model storage. Do not run `ollama serve` inside the container.

Only the CLI binary is copied from the version- and digest-pinned official
Ollama image. Its GPU/inference libraries and server entrypoint are not included
in the final image. Building may still download large upstream image layers;
Docker's build cache avoids repeating those downloads. Both Linux amd64 and
arm64 are supported by the pinned image.

The previous `ollama-models` volume is no longer mounted. It is not deleted or
migrated automatically; preserve it if it contains models you still need.

For Docker Engine on Linux, add
`"runArgs": ["--add-host=host.docker.internal:host-gateway"]` to
`devcontainer.json` and allow connections from Docker's bridge network to the
host service. Remote Docker hosts require their own reachable Ollama endpoint.

## Persistent tool configuration

The Copilot Feature installs its binary in `/usr/local/bin`, which is not
writable by `vscode`. After container creation, `postCreateCommand` copies the
binary into `/home/vscode/.local/bin` as `vscode`. `remoteEnv.PATH` puts that
directory first for lifecycle commands, terminals, and editor processes, so the
Feature's subsequent post-start `copilot update` can update the user-owned
installation without sudo or changing permissions on `/usr/local/bin`.
Rebuilding recreates this copy from the Feature installation; the executable
itself is not stored in the configuration volume.

Workspace-scoped named volumes preserve `~/.copilot`, `~/.claude`, `~/.gemini`,
and `~/.codex` across rebuilds. They are initialized from user-owned, private
directories in the image. `CLAUDE_CONFIG_DIR` explicitly selects the persistent Claude
configuration directory, including its `.claude.json` state file. `CODEX_HOME`
selects the persistent Codex directory for configuration, file-backed
authentication, and session state. Gemini
configuration is preserved if you use Gemini;
this configuration does not install its CLI.

Existing container-local settings are not automatically migrated. Back up
configuration you need before rebuilding, including Claude's existing
`~/.claude.json`, which now belongs at `~/.claude/.claude.json`. Authentication
stored outside these directories or in an OS keychain may still require signing
in again. Back up any existing `~/.codex` directory before the first rebuild
with the new mount, then restore it into the mounted directory as `vscode`;
the new volume does not migrate state from the old container.

These volumes can contain credentials and conversation history. Do not share
them between users. Moving the workspace can change its devcontainer ID and
therefore select new volumes. Removing a volume deletes its persisted state.

## Build and editor settings

The Docker build context is restricted to the Dockerfile, `.dockerignore`,
and the container's `package.json` and `package-lock.json`. Codex has an exact
version in this manifest and is installed with `npm ci` into `/opt/codex`;
`/usr/local/bin/codex` exposes the command on `PATH`. This pins its dependency
graph without installing the repository's development dependencies in the image.

Dependabot checks weekly for root npm development dependencies, container npm
dependencies (including Codex), Dev Container Features, and Docker image updates.
Review and merge its manifest/lockfile updates, then rebuild to apply container
updates. For a manual Codex update, run from the repository root:

```sh
npm install --prefix .devcontainer --package-lock-only --save-exact '@openai/codex@<version>'
```

Commit both container npm manifests together. Feature artifacts are pinned by
`devcontainer-lock.json`; applications downloaded independently by features and
APT packages are not pinned by the Codex lockfile.

VS Code installs Claude Code and Container Tools, and uses Bash for integrated
terminals. Editor Copilot support uses the Copilot Chat extension bundled with
current VS Code releases. Do not explicitly install the deprecated
`GitHub.copilot` extension here: its Marketplace redirect can attempt to
downgrade the built-in `GitHub.copilot-chat` extension and fail during setup.
On older VS Code releases without bundled Copilot Chat, install the compatible
extension manually or upgrade VS Code. This does not affect Copilot CLI,
which is installed separately by the Dev Container Feature.
The hadolint extension is not preinstalled because it
requires a separate `hadolint` executable that this image does not include.
The editor waits through the post-start certificate setup before attaching.

### Port forwarding and applying startup fixes

Workspace settings in `.vscode/settings.json` disable automatic port forwarding
and restoration of previously forwarded ports. Internal tool listeners and
URLs printed in terminals should not automatically create host-side forwards.
Forward an application port explicitly through VS Code's **Ports** view when
needed. Host Ollama does not require a forwarded container port: the container
connects outbound to `host.docker.internal:11434`.

These settings do not close tunnels that are already open. In the current
session, use **Stop Forwarding Port** for unwanted entries in the **Ports** view.
Run **Dev Containers: Rebuild Container** to apply the Copilot installation and
PATH changes. After attaching, `command -v copilot` should report
`/home/vscode/.local/bin/copilot`, and `copilot update` should no longer fail
with an installation-directory permission error.

Certificate output such as `0 added, 0 removed; done.` is successful when the
mounted certificate is already trusted. Docker's repeated **What's next /
Docker Debug** messages are informational suggestions, not container errors.

If OpenSSL reports `Could not read certificate`, validate the host file with
`openssl x509 -inform PEM -in "$HOME/.config/devcontainer-certs/Cisco Secure Access Root CA.pem" -noout`.
If it succeeds on the host but the container sees a zero-byte certificate,
rebuild to apply the directory mount and image symlink; restarting the old
container does not change its mounts.

### Copilot audit hooks

Copilot audit scripts live in the workspace's `.copilot/hooks` directory.
Completed tool calls are logged under the workspace's `.copilot/logs`, not the
home-directory Copilot volume. No script installation is needed. See
[the hook documentation](../.github/hooks/README.md) for configuration and checks.

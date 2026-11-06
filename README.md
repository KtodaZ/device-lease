# Device Lease

Keep cooperating coding agents from using the same emulator, simulator, or phone at once. A small Node.js CLI manages expiring leases, heartbeats, and handoffs. One portable Agent Skill works with Claude Code and Codex. No marketplace, MCP server, daemon, npm registry account, or runtime dependencies required.

## Quick start

Requires **Node.js 22.13+ on 22.x, or 23.4+**. A current supported LTS is recommended. SQLite is built into Node; some older releases print an experimental SQLite warning on stderr. JSON results remain on stdout.

```sh
git clone https://github.com/KtodaZ/device-lease.git
cd device-lease
node skills/device-lease/scripts/cli.mjs init
node skills/device-lease/scripts/cli.mjs doctor
node skills/device-lease/scripts/cli.mjs reserve --device emulator-5554 --owner agent-a --purpose "UI verification" --json
```

`reserve` returns a private token. Keep it in your agent's session or a private automation variable. Renew before device interactions and release when finished:

```sh
# DEVICE_LEASE_TOKEN contains the token returned by reserve.
node skills/device-lease/scripts/cli.mjs heartbeat --device emulator-5554 --json
node skills/device-lease/scripts/cli.mjs release --device emulator-5554 --message "Finished; device left at home screen" --json
```

Alternatively, pipe the token into `--token-stdin`. Do not paste literal tokens into command arguments on shared hosts: arguments may appear in process listings. Tokens authorize lease changes independently of the display owner or agent session. `status` never reveals tokens, and only token hashes are persisted.

For an optional command on PATH, run `npm install --global .` from this checkout. This links to the checkout, so keep it at its installed path and update it only while clients are stopped. First check `command -v device-lease` (`Get-Command device-lease` in PowerShell); do not overwrite an existing implementation until migration is complete. Direct `node` usage and skill installation work without a global npm install.

## Install the skill

From this checkout, install either or both. Each command refuses to overwrite any existing target:

```sh
# Claude Code
node scripts/install-skill.mjs --target "$HOME/.claude/skills/device-lease"
# Codex
node scripts/install-skill.mjs --target "$HOME/.agents/skills/device-lease"
```

Restart the agent session. Ask it to use the device-lease skill before shared device work, or invoke `/device-lease` in Claude Code or `$device-lease` in Codex. The installed folder includes the CLI; it needs only Node on PATH. In PowerShell, use `$HOME` in the quoted target paths.

Skill selection is advisory. Add a short standing instruction to your team's `CLAUDE.md` and `AGENTS.md` if leases must apply to every device task:

> Before shared device work, use the device-lease skill. All clients must use our agreed device host, OS account, state root, and canonical device IDs. Stop device interactions on any failed heartbeat. Do not bypass contention by changing IDs or state roots.

Keep both installed copies at the same version. To upgrade, stop all clients, move each installed skill to a backup folder, and rerun the installer. Do not alter or remove state during an upgrade.

## Configuration

`init` creates `~/.config/device-lease/config.json` without overwriting an existing file. You can use `init --config /absolute/path/config.json --root /absolute/path/state` for a custom setup. Edit the JSON to add optional aliases:

```json
{
  "root": "~/.device-leases",
  "idleTimeoutMinutes": 15,
  "historyLimit": 20,
  "strictDevices": true,
  "devices": {
    "android-main": "emulator-5554",
    "android-qa": "emulator-5554",
    "ios-main": "YOUR-SIMULATOR-UDID"
  }
}
```

Both Android aliases resolve to one lease. Canonical IDs are opaque, case-sensitive strings; use the exact same ID everywhere. The tool does not discover devices or normalize OS-specific IDs. Alias mappings must be consistent between clients. Changing an alias does not migrate a lease. Strict mode rejects unknown labels and IDs, preventing pool typos from creating separate leases. It defaults to enabled whenever `devices` is nonempty; set `strictDevices:false` to allow arbitrary literal IDs. With no configured pool, arbitrary IDs are allowed. Agree on the pool before use.

Precedence is **flag → environment → config → default**. No repository-local configuration is automatically loaded and no Git information is collected.

| Setting | Flag | Environment | Default |
| --- | --- | --- | --- |
| Config path | `--config` | `DEVICE_LEASE_CONFIG` | `~/.config/device-lease/config.json` |
| State directory | `--root` | `DEVICE_LEASE_ROOT` | `~/.device-leases` |
| New lease TTL | `--idle-timeout-minutes` | `DEVICE_LEASE_IDLE_TIMEOUT_MINUTES` | 15 minutes |
| Handoffs per device | `--history-limit` | `DEVICE_LEASE_HISTORY_LIMIT` | 20 |
| Display owner | `--owner` on reserve | `DEVICE_LEASE_OWNER` | `agent` |
| Token | `--token` or `--token-stdin` | `DEVICE_LEASE_TOKEN` | Required for heartbeat/release |

Paths must be absolute or begin with `~/`. Explicitly selecting a missing or invalid config is an error; a missing default config uses defaults. TTL is a decimal integer from 1–1440 minutes and is stored with each lease; changing the default does not change existing leases. History limits are 0–1000 and prune that device's stored handoffs on release when positive. Zero disables new handoffs without deleting existing ones. All clients should agree on retention settings. Free devices without history are not persisted.

## Workstations, CI, and virtual machines

The supported coordination boundary is **one host, one OS account, one local state directory**. Every agent and CI job sharing a device must run this CLI at that boundary. The state directory is private (`0700`) and the database is private (`0600`) on POSIX. Windows users must place it in a profile directory protected by their Windows ACLs; POSIX modes are not enforced there.

- **Device inside one VM:** install and run the CLI inside that VM, on its local disk.
- **Several VMs sharing one host's device:** run every lease command on the device host through an existing authorized SSH connection, using one service account. Give that account one shared config. For workplace access, use the restricted SSH adapter below instead of granting clients a general shell. Keep device-control permissions and tools separate.
- **Independent devices per VM:** each VM can have its own local state because the physical resources do not overlap.

For already trusted shell access, an example command from a VM after installing the CLI on the device host:

```sh
ssh device-host 'device-lease reserve --device emulator-5554 --purpose "UI verification" --json'
# Pipe the private token to the remote CLI through stdin to renew/release.
ssh device-host device-lease heartbeat --device emulator-5554 --token-stdin --json
```

The heartbeat example expects token input through redirected stdin or a pipe; it is not an interactive prompt. Use an absolute remote CLI/config path if a noninteractive SSH shell does not load your PATH. Run all commands on the same host so that expiry uses that host's clock. SSH transport failure means ownership is unconfirmed: stop device use. This project does not create SSH credentials, execute device commands, or provide a remote server.

### Restricted SSH access

An optional `scripts/ssh-lease.mjs` adapter accepts JSON requests through OpenSSH's `SSH_ORIGINAL_COMMAND`. It never evaluates remote shell text, permits only lease commands and their relevant fields, fixes the config on the host, and strips lease-setting environment overrides. Heartbeat/release read their token from stdin. It cannot initialize config, change the root, or execute device-control commands.

A host administrator can provision a dedicated account, initialize its local config/state, and restrict each authorized key with an entry shaped like this (replace paths and the public key):

```text
restrict,command="/absolute/path/node /opt/device-lease/scripts/ssh-lease.mjs --config /var/lib/device-lease/config.json" ssh-ed25519 PUBLIC_KEY
```

Disable password login, unrestricted keys, and other shell access for that account according to workplace policy. The Node binary and repository/config should be managed by the administrator; state belongs to the service account. `restrict` disables forwarding and PTY access. This is a lease-only endpoint for trusted clients, not per-user authorization or tenant isolation.

```sh
ssh lease-host '{"command":"reserve","device":"android-main","owner":"ci-agent","purpose":"UI verification"}'
# Supply the returned token through stdin for this command:
ssh lease-host '{"command":"heartbeat","device":"android-main"}'
```

If a reserve reply is lost, the claim remains until expiry; inspect status and wait for expiry rather than bypassing it. An authenticated service with per-client identities may be more suitable for a broader remote deployment; MCP could be a thin adapter over that service later. The CLI and skill remain the initial interface.

**Never put the database on NFS, SMB, VM shared folders, or a synced/cloud-storage directory.** Linux filesystem detection rejects several common network/FUSE/VM-share types; Windows rejects UNC paths. macOS filesystem detection is informational only, and mapped Windows drives and synced directories are not detected. `doctor` reports its filesystem type; the operator must verify local storage. Separate VM disks, copied databases, different OS accounts, and different roots cannot coordinate the same shared device. See [SQLite's network-filesystem guidance](https://www.sqlite.org/useovernet.html).

## Safety and failure behavior

SQLite write transactions serialize reserve, heartbeat, and release, including recovery after a killed process. Contending database operations wait up to five seconds, then return `DB_BUSY` if still blocked. A device with an unexpired lease returns `BUSY`; there is no automatic wait for the device to become free, takeover, or force-release command. Expired leases can be replaced. An old token cannot renew or release a replacement lease. Release and its handoff commit atomically. After clock rollback, effective lease time freezes at the last stored time until the clock catches up; `doctor` and `status` warn, while holders can still renew/release. This can delay expiry. Clock jumps forward can expire leases early.

Leases are **advisory coordination for trusted agents**, not a security boundary or a device-control proxy. A lease does not prevent another program from accessing a device. Expiry does not stop an emulator, an app, a previous holder, or a long-running test. Heartbeat before interactions and during lengthy operations; stop on a failed heartbeat. The CLI never boots, shuts down, erases, installs, or uninstalls devices.

`status`, `history --device ID`, and `doctor` show state without exposing tokens. Purpose/owner labels and handoff text are intentionally stored locally; avoid secrets and personal information. Current/expired rows remain until replacement or release. Files contain no automatic hostnames, usernames, branch names, or agent session IDs. Database corruption, newer schemas, and unsafe permissions produce errors; never delete the database to bypass them. Stop all clients and resolve the cause first. Host snapshots/restores and copied state can resurrect old leases: quiesce clients before those operations.

With `--json`, stdout contains one JSON result including `ok`, or an error containing `ok:false`, `code`, and `message` (plus optional `details`). Runtime warnings may appear on stderr. Plain mode prints formatted JSON for successful results and errors on stderr.

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 2 | Device busy |
| 3 | Lease lost: absent, expired, or token mismatch |
| 64 | Usage or config error |
| 70 | Runtime, storage, migration, or safety error |
| 75 | Database busy; ownership cannot be confirmed, so stop device interactions |

## Migrating older directory-based leases

This is a new protocol and is not wire-compatible with the earlier directory-lock implementation.

1. Stop **every** old client, including repository wrappers, scheduled jobs, and agents using other state roots. Finish their device work and release reservations with the old CLI.
2. Back up the old state. Once no reservations remain, move the old state directory aside. Preserve handoffs for reference; do not copy tokens or lock entries into the new directory.
3. Agree on one new local root and canonical ID mapping, then update all clients together. Run `init`, `doctor`, and a reserve/heartbeat/release smoke test with an unused example ID before real use.

The new CLI rejects `.lock` entries on reserve, heartbeat, and status even when stale; token-authorized release remains available. Old roots with 0755 permissions fail earlier with `UNSAFE_ROOT`; move the retired root aside and let the new CLI create a private one. The old tool may use a Git-common directory unless its environment overrides the root. These guards cannot detect clients on a different root or prevent old clients from starting later. Never mix protocols. This repository does not modify your existing installation automatically.

## Development and distribution

```sh
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/device-lease
```

Tests use disposable directories and synthetic IDs; no emulator, simulator, or real lease is touched. They cover separate-process contention, token fencing, expiry boundaries, crash rollback, config precedence, permissions, legacy detection, JSON errors, and skill installation. CI runs macOS and Linux across Node 22.13, Node 24, and the current release; Windows CI covers CLI/config/install behavior too.

The CLI and skill are distributed directly from this GitHub repository under the [MIT license](LICENSE). Start from a tagged, reviewed commit for workplace adoption. No npm publication or marketplace registration is needed. Report bugs via GitHub issues; for a security issue, use GitHub private vulnerability reporting when enabled rather than posting tokens or local state publicly.

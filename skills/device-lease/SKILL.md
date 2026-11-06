---
name: device-lease
description: Coordinate shared Android emulators, iOS simulators, and physical devices between cooperating coding agents using host-local leases. Use before working with a shared device and when renewing, releasing, or handing off a device lease.
license: MIT
---

# Device leases

Requires Node.js 22.13+ on 22.x, or 23.4+, and command access to the device host. State must use one local filesystem and one OS account. This provides neither distributed locking nor device control.

Use the bundled CLI to reserve a shared device before interacting with it. Resolve `scripts/cli.mjs` relative to this SKILL.md, not the project working directory. A globally installed `device-lease` command is optional; verify it is this implementation before using it.

All agents sharing a device must use the same host, OS account, state root, and canonical device ID. Respect the user's configured device pool and control tools. This skill grants no extra permissions and does not replace device automation tools.

## Workflow

1. Run `node <skill-dir>/scripts/cli.mjs doctor --json` and `status --json` with the configured root or config path. Stop on safety/storage/config errors. During initial setup, establish which device host and state root all clients will use; do not invent a separate root to bypass a busy lease.
2. Reserve with `reserve --device <canonical-ID-or-configured-alias> --owner <short-label> --purpose <task> --json`. Keep the returned token private. Only a successful reserve grants a lease. To hold a lease longer than the default, add `--idle-timeout-minutes <1-1440>` to `reserve`; there is no `--ttl` option. `BUSY` means pick another permitted device or report the contention; never delete locks or override a holder.
3. Renew using `heartbeat --device <same-ID> --token-stdin --json` with the token provided on stdin. Heartbeat before each interaction and during long work, comfortably before the lease expires. The default TTL is 15 minutes; long builds, suspended VMs, or disconnected sessions can outlast it. Use an appropriate configured TTL without assuming expiry stops the previous user's app.
4. If a heartbeat fails, stop device interactions until ownership is reestablished. `LEASE_LOST` means the token is absent, expired, or replaced; never release or shut down a device now held by someone else.
5. Finish device work and required cleanup while still holding a valid lease, then `release --device <same-ID> --token-stdin --message <handoff> --json`. Follow the user's shutdown and cleanup rules. Handoffs should describe relevant device state without secrets or personal data.

The token is the credential; changing the display owner or agent session does not invalidate it. Status never reveals tokens. Supply tokens through stdin or the `DEVICE_LEASE_TOKEN` environment variable; avoid literal tokens in command arguments or checked-in files.

For a POSIX shell with a private `lease_token` variable, renewal can use `printf '%s' "$lease_token" | node <skill-dir>/scripts/cli.mjs heartbeat --device <ID> --token-stdin --json`. Do not assume variables persist between agent shell calls; maintain the token in private session state. Explicit token flags override the token environment variable. Do not combine `--token` and `--token-stdin`. `--token-stdin` reads until end of input, so it waits indefinitely when stdin is left open, as it often is in agent shells. Always pipe or redirect the token (for example `< <private-token-file>`), or set `DEVICE_LEASE_TOKEN` for that one command instead.

Use `--config <absolute-path>` or `DEVICE_LEASE_CONFIG` for a shared configuration. `--root` / `DEVICE_LEASE_ROOT` overrides the state location. Defaults are `~/.config/device-lease/config.json` and `~/.device-leases`. Missing optional configuration uses defaults; an explicitly selected missing file is an error. `init` creates a starter config and refuses to overwrite an existing one. Configuration supports `root`, `idleTimeoutMinutes`, `historyLimit`, `devices` (alias-to-canonical-ID map), and `strictDevices`. Strict device checking defaults on for a nonempty pool; unknown IDs then fail. Flags override environment, then config, then defaults. `DB_BUSY` (exit 75) means storage contention and unconfirmed ownership; stop device interactions and resolve contention. See `--help` for all flags and exit codes.

## Hosts, VMs, and limitations

- For a device inside one VM, run all lease clients inside that VM. For a device shared by multiple VMs, run all lease commands on the device host through an already authorized SSH connection and one service account. Workplace deployments should use the repository's restricted SSH adapter or an approved equivalent, not grant general shell access for leases. Device control itself must follow the user's approved tools; the lease CLI only coordinates ownership.
- Never put the database on NFS, SMB, a VM shared folder, or a cloud-synced directory. Separate local databases cannot coordinate one shared device. Root changes and configuration aliases must be agreed by all clients before use.
- Locks are advisory and coordinate trusted agents, not hostile users. Clock rollback caps remaining expiry to one TTL on the corrected clock, keeps expired leases expired, and warns in the detecting status/doctor output; holders can still renew/release. Stop on database corruption, unknown schema, or legacy-state errors. Never reset the database, change roots, erase devices, or remove someone else's state to recover automatically.
- Migrating from older directory-based leases requires stopping every old client and resolving existing reservations first. The CLI rejects `.lock` entries in its root but cannot detect old clients using other roots. Do not run both protocols together.

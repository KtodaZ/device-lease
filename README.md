<h1 align="center">📱 Device Lease</h1>

<p align="center">
  Keep your agents from using the same emulator at once.
</p>

<p align="center">
  <a href="https://github.com/KtodaZ/device-lease/actions/workflows/test.yml"><img src="https://github.com/KtodaZ/device-lease/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/runtime-Node.js-417E38?logo=nodedotjs&amp;logoColor=white" alt="Node.js runtime" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563EB" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="docs/configuration.md">Configure</a> ·
  <a href="docs/remote-hosts.md">VMs &amp; SSH</a> ·
  <a href="docs/operations.md">Safety &amp; migration</a>
</p>

Two agents, one emulator: one is testing a screen while the other launches an app. Device Lease gives cooperating agents a way to reserve the device, keep the lease alive, and hand it back when they're done.

One portable Agent Skill works with **Claude Code and Codex**. The bundled Node.js CLI also works in shell scripts and CI, with no external runtime dependencies.

```text
Agent A reserves the device → lease granted
Agent B tries the same ID  → BUSY
Agent A releases          → ready for the next agent
```

| What you get | How it works |
| --- | --- |
| Shared device pools | Aliases resolve to canonical IDs; strict pools reject typos. |
| Expiring leases | Heartbeats renew ownership; expired leases can be reclaimed. |
| Private tokens | Only token hashes are stored, and status never reveals tokens. |
| Useful handoffs | Leave the next agent a note about the device's state. |

## Install

Requires **Node.js 22.13+ on 22.x, or 23.4+**. A current supported LTS is recommended.

> [!IMPORTANT]
> All clients sharing a device must use **one host, one OS account, and one local state directory**. Leases are advisory: they do not block device access or stop a previous holder's app. Already using the older directory-based tool? [Migrate first](docs/operations.md#migrating-older-directory-based-leases).

Clone the repo and check your setup:

```sh
git clone https://github.com/KtodaZ/device-lease.git
cd device-lease
node skills/device-lease/scripts/cli.mjs init
node skills/device-lease/scripts/cli.mjs doctor
```

Install either skill, or both. Each command refuses to overwrite an existing target.

**Claude Code**

```sh
node scripts/install-skill.mjs --target "$HOME/.claude/skills/device-lease"
```

**Codex**

```sh
node scripts/install-skill.mjs --target "$HOME/.agents/skills/device-lease"
```

Restart the agent session, then ask:

> Use the device-lease skill before working with the shared emulator.

You can also invoke `/device-lease` in Claude Code or `$device-lease` in Codex. The installed folder includes the CLI; it needs only Node on PATH. In PowerShell, use `$HOME` in the quoted target paths.

Skill selection is advisory. For a team-wide rule, add the [standing instruction](docs/usage.md#install-the-skill) to your `CLAUDE.md` and `AGENTS.md`.

## Use it your way

| Guide | What's inside |
| --- | --- |
| [CLI and skill setup](docs/usage.md) | Reserve, renew, release, token handling, PATH setup, and upgrades. |
| [Configuration](docs/configuration.md) | Device aliases, strict pools, timeouts, history, and environment overrides. |
| [Remote hosts and VMs](docs/remote-hosts.md) | Shared-host setups and the restricted SSH adapter. |
| [Safety and migration](docs/operations.md) | Expiry, clock recovery, storage limits, exit codes, and the old lease format. |
| [Contributing](docs/contributing.md) | Tests, validation, bug reports, and distribution. |

For a device inside one VM, run the CLI inside that VM. When several VMs share a host's devices, run all lease commands on that host. **Never put the database on NFS, SMB, VM shared folders, or a synced/cloud-storage directory.** See the [remote-host guide](docs/remote-hosts.md) before setting up shared access.

## Contributions welcome

Got a fix or an improvement? [Send a pull request](docs/contributing.md). Don't like it? [Fork it](https://github.com/KtodaZ/device-lease/fork) and make it your own.

[MIT license](LICENSE) · [Report a bug](https://github.com/KtodaZ/device-lease/issues) · [Report a vulnerability privately](https://github.com/KtodaZ/device-lease/security/advisories/new)

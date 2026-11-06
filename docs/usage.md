[← Device Lease](../README.md)

# CLI and skill setup

Run these commands from your cloned checkout. No marketplace, MCP server, daemon, npm registry account, or runtime dependencies required.

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

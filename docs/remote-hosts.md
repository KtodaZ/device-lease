[← Device Lease](../README.md)

# Remote hosts and VMs

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

## Restricted SSH access

An optional `scripts/ssh-lease.mjs` adapter accepts JSON requests through OpenSSH's `SSH_ORIGINAL_COMMAND`. It never evaluates remote shell text, permits only lease commands and their relevant fields, fixes the config on the host, and strips lease-setting environment overrides. Configure a nonempty device pool with `strictDevices:true` for this endpoint so clients cannot create arbitrary device rows. Heartbeat/release read their token from stdin. It cannot initialize config, change the root, or execute device-control commands.

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

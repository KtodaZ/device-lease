[← Device Lease](../README.md)

# Safety and failure behavior

SQLite write transactions serialize reserve, heartbeat, and release, including recovery after a killed process. Contending database operations wait up to five seconds, then return `DB_BUSY` if still blocked. A device with an unexpired lease returns `BUSY`; there is no automatic wait for the device to become free, takeover, or force-release command. Expired leases can be replaced. An old token cannot renew or release a replacement lease. Release and its handoff commit atomically. When clock rollback is detected, remaining expiry is capped to one stored TTL on the corrected clock and already-expired leases stay expired. The correction commits even when a claim returns `BUSY`, so abandoned leases cannot stay stuck at a bogus future date. The detecting command's status/doctor output warns; holders can still renew/release. Clock jumps forward can expire leases early. Recorded acquisition/activity timestamps reflect the host clock at the time they were written.

Leases are **advisory coordination for trusted agents**, not a security boundary or a device-control proxy. A lease does not prevent another program from accessing a device. Expiry does not stop an emulator, an app, a previous holder, or a long-running test. Heartbeat before interactions and during lengthy operations; stop on a failed heartbeat. The CLI never boots, shuts down, erases, installs, or uninstalls devices.

`status`, `history --device ID`, and `doctor` show state without exposing tokens. Purpose/owner labels and handoff text are intentionally stored locally; avoid secrets and personal information. Current/expired rows remain until replacement or release. Files contain no automatic hostnames, usernames, branch names, or agent session IDs. Database corruption, newer schemas, and unsafe permissions produce errors; never delete the database to bypass them. Stop all clients and resolve the cause first. Host snapshots/restores and copied state can resurrect old leases: quiesce clients before those operations.

With `--json`, stdout contains one JSON result including `ok`, or an error containing `ok:false`, `code`, and `message` (plus optional `details`). Runtime warnings may appear on stderr. Plain mode prints formatted JSON for successful results and errors on stderr.

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 2 | Device busy |
| 3 | Lease lost: absent, expired, or token mismatch |
| 64 | Usage or config error |
| 70 | Runtime, storage, or safety error |
| 75 | Database busy; ownership cannot be confirmed, so stop device interactions |

## Conflicting lease tools

All clients sharing a device must use the same lease tool and state root. Separate tools can each grant a lease for the same device without knowing about the other.

A `LEGACY_STATE` error means the configured state root contains `.lock` entries used by another lease implementation. Reserve, heartbeat, and status stop on these conflicts; token-authorized release remains available. Identify the clients involved and resolve their reservations before continuing. Do not delete lock entries to bypass the error. The CLI cannot detect another tool using a different state root.

[← Device Lease](../README.md)

# Configuration

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

Both Android aliases resolve to one lease. Canonical IDs are opaque, case-sensitive strings; use the exact same ID everywhere. The tool does not discover devices or normalize OS-specific IDs. Alias mappings must be consistent between clients. Changing an alias does not move an existing lease to another device ID. Strict mode rejects unknown labels and IDs, preventing pool typos from creating separate leases. It defaults to enabled whenever `devices` is nonempty; set `strictDevices:false` to allow arbitrary literal IDs. With no configured pool, arbitrary IDs are allowed. Agree on the pool before use.

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

[← Device Lease](../README.md)

# Contributing

```sh
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/device-lease
```

Tests use disposable directories and synthetic IDs; no emulator, simulator, or real lease is touched. They cover separate-process contention, token fencing, expiry boundaries, crash rollback, config precedence, permissions, legacy detection, JSON errors, and skill installation. CI runs macOS and Linux across Node 22.13, Node 24, and the current release; Windows CI covers CLI/config/install behavior too.

The CLI and skill are distributed directly from this GitHub repository under the [MIT license](../LICENSE). Start from a tagged, reviewed commit for workplace adoption. No npm publication or marketplace registration is needed. Report bugs via GitHub issues; for a security issue, use GitHub private vulnerability reporting when enabled rather than posting tokens or local state publicly.

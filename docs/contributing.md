[← Device Lease](../README.md)

# Contributing

Contributions are welcome, including fixes, documentation improvements, and changes proposed by coding agents.

## Submit a pull request

You do not need collaborator access to contribute. Fork this repository, make your changes in the fork, and open a pull request for review.

1. [Fork `KtodaZ/device-lease`](https://github.com/KtodaZ/device-lease/fork) into your GitHub account.
2. Clone your fork, replacing `YOUR-USERNAME` with its owner:

   ```sh
   git clone https://github.com/YOUR-USERNAME/device-lease.git
   cd device-lease
   git switch -c describe-your-change
   ```

3. Make your changes and run the relevant checks below.
4. Commit your changes and push the branch to your fork:

   ```sh
   git add <changed-files>
   git commit -m "Describe the change"
   git push -u origin describe-your-change
   ```

5. Open a pull request from your fork's branch to **`KtodaZ/device-lease:main`**. Explain the problem, what changed, and how you checked it. Maintainers review proposed changes before merging.

Direct push access to `KtodaZ/device-lease` is reserved for maintainers and explicitly invited collaborators. Public visibility does not grant write access.

If a coding agent reports that it cannot push, confirm that it is authenticated to an account with write access to **your fork** and is pushing there. Its GitHub integration must also be authorized for the fork. Work-account policies may restrict external forks or pull requests; those restrictions need to be resolved with your organization.

## Checks

For code changes, run:

```sh
npm test
```

For changes to the skill instructions, also run the skill-creator validator if it is available in your environment:

```sh
python3 /path/to/skill-creator/scripts/quick_validate.py skills/device-lease
```

For documentation-only changes, check the wording, commands, and links. You do not need to install skill-creator or run the runtime test suite.

Tests use disposable directories and synthetic IDs; no emulator, simulator, or real lease is touched. They cover separate-process contention, token fencing, expiry boundaries, crash rollback, config precedence, permissions, legacy detection, JSON errors, and skill installation. CI runs macOS and Linux across Node 22.13, Node 24, and the current release; Windows CI covers CLI/config/install behavior too.

## License and reporting issues

The CLI and skill are distributed directly from this GitHub repository under the [MIT license](../LICENSE). Start from a tagged, reviewed commit for workplace adoption. No npm publication or marketplace registration is needed. Report bugs via GitHub issues; for a security issue, use GitHub private vulnerability reporting when enabled rather than posting tokens or local state publicly.

# Pi Status

> A live, theme-aware status line for [Pi](https://pi.dev) — context usage, estimated cost, model & thinking level, directory, and Git branch at a glance.

[![CI](https://github.com/pi-contrib/pi-status/actions/workflows/ci.yml/badge.svg)](https://github.com/pi-contrib/pi-status/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/pi-contrib/pi-status)](https://github.com/pi-contrib/pi-status/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![Pi Status footer showing context usage, estimated cost, model, directory, and Git branch](docs/status-line.png)

## How it works

Pi Status follows your active Pi theme and replaces the interactive footer with context usage (Braille gauge and percentage), estimated branch cost (marking OAuth subscriptions with `· subscription`), human-readable active model, provider (when multiple are configured), and thinking level, directory, and Git branch. Cost is calculated from the active conversation branch, not a billing record. Secondary qualifiers compact and trailing labels truncate gracefully before dropping segments in narrow terminals, and other extensions’ status messages are preserved cleanly on a second line.

## Requirements

- Pi 1.6.0 (the version checked in CI)
- A true-color terminal and a Nerd Font for the icons

## Installation

Install the latest code from GitHub without a registry login:

```sh
pi install git:github.com/pi-contrib/pi-status
```

Or, after configuring npm authentication for `npm.pkg.github.com` and the `@pi-contrib`
scope, install the latest release from GitHub Packages:

```sh
pi install npm:@pi-contrib/pi-status
```

For a reproducible install, append a release tag (for GitHub) or a version (for npm).
Restart Pi or run `/reload`. No extra configuration is required.

## Development

Use Node.js 22 locally or enter the Nix dev shell with `nix develop`:

```sh
npm ci --ignore-scripts
npm run check
npm run lint
npm test
npm pack --dry-run
pi -e ./src/index.ts
```

Run `npm run format` to apply Biome formatting, import sorting, and safe lint fixes.

Release Please creates release PRs. Merging one tags the release and publishes the npm
package to GitHub Packages. The repository must allow Actions to create pull requests,
and the organization must allow the workflow to publish packages.

## License

MIT. The footer layout and palette are adapted from Claude Status.

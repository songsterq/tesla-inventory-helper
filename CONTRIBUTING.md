# Contributing

Thanks for wanting to help. This is a local-only Chrome MV3 extension (WXT + TypeScript + Vitest). Issues and pull requests are welcome.

## Before you start

1. **Check existing issues** — someone may already be working on it.
2. **Open an issue first** for anything larger than a small bugfix or typo: new sites, default-rule changes, permission changes, or UI redesigns. That saves rework.
3. **Keep scope tight** — one concern per PR. Prefer fixing or adding one behavior over mega-refactors.

## Development setup

Requires Node.js and npm.

```bash
git clone https://github.com/songsterq/tesla-inventory-helper.git
cd tesla-inventory-helper
npm install
npm run dev
```

Load the unpacked extension from `.output/chrome-mv3` in `chrome://extensions` (Developer mode → Load unpacked).

Useful commands:

| Command | What it does |
|---------|----------------|
| `npm run dev` | Dev build with auto-reload |
| `npm test` | Vitest (must pass for every PR) |
| `npm run compile` | TypeScript check (must pass) |
| `npm run build` | Production build |
| `npx wxt zip` | CWS-style zip under `.output/` |

Architecture, rule-engine details, and release notes live in [`AGENTS.md`](./AGENTS.md). Skim it if your change touches rules, storage migrations, Tesla.com URL routing, the third-party popover, or the watchlist auto-check.

## What to work on

| Good fits | Needs discussion first |
|-----------|-------------------------|
| Bug fixes with a clear repro | New host / third-party site |
| Tests for missing coverage | Changing default HW4 rules or serial cutoffs |
| Small UX polish (popup, popover) | New permissions or broader host access |
| Docs clarity | Backend, accounts, analytics, or remote config |
| Performance / reliability on allowed sites | Scraping sites outside the fixed allowlist |

**Out of scope for this project:** sending listing data off-device, accounts, analytics, or anything that breaks the local-only privacy model described in the README.

## Changing default rules

Default HW4 rules and `HW4_SERIAL_2023` in the decoder must stay in sync — the same VIN should not glow as a match on Tesla.com while the popover guesses HW3 (or the reverse).

If you propose a cutoff or rule change:

1. Cite **community evidence** (and note uncertainty). Transitions were gradual; cutoffs intentionally err slightly high to avoid HW3 false-positives.
2. Scope 2023 serial cutoffs **per model line** — serials are not comparable across Model 3 / Y / S / X.
3. Do **not** apply Model Y serials to Model 3 (or other lines). Model 3 is HW4-only from 2024 in the defaults; that is intentional.
4. Users who already saved custom rules keep their copy. Pushing a new default to users who saved an older default requires a `rulesItem` version bump and a careful migration (see AGENTS.md). Never migrate by overwriting arbitrary user rules.

## Adding a third-party site

The site allowlist is intentional and review-sensitive (Chrome Web Store). Updates need:

1. `ALLOWLIST_MATCHES` in `entrypoints/thirdparty.content/index.ts`
2. Matching `host_permissions` / manifest surface (see AGENTS.md — keep these in sync)
3. A short note for the permission justification in `docs/chrome-web-store.md` (reviewer-only copy can name hosts; **public** store description must not list hostnames)

Open an issue before implementing so scope and CWS impact can be agreed.

## Pull request checklist

- [ ] Branch from `main`; descriptive branch name (`fix/…`, `feat/…`)
- [ ] `npm test` and `npm run compile` pass
- [ ] Tests updated when behavior changes (especially `src/rules.ts`, `src/decoder.ts`, `src/vin.ts`, watchlist / auto-check)
- [ ] No drive-by refactors unrelated to the change
- [ ] `DEBUG` in the third-party content script stays `false` unless the PR is explicitly about debug logging
- [ ] Do not bump `package.json` version unless the maintainer asks (releases are cut separately)
- [ ] PR description: what problem, how you fixed it, how you tested (manual steps on Tesla.com / a listing site when UI is involved)

## Commit messages

Short, imperative, focused on why:

- `Scope 2023 HW4 rules per model line`
- `Detect sold used cars via inventory redirect`

Avoid version bumps and “wip” noise in commits you want merged.

## Code style

- Match surrounding TypeScript style; no new framework or build stack without prior agreement.
- Prefer pure logic in `src/` with Vitest coverage; keep content scripts thin where possible.
- Do not add dependencies unless the PR justifies why existing code cannot do it.

## Reporting bugs

Include:

1. Extension version (Chrome Web Store or local build)
2. Browser version
3. Page URL shape (you can redact query strings; say whether used inventory, used order, or a third-party listing)
4. Expected vs actual
5. Console errors from the page or the extension service worker, if any

For VIN / hardware misclassification, a **full 17-character VIN** (or enough positions for the disputed rule) is usually required. Only share a VIN if you are comfortable doing so in a public issue.

## Security / privacy

There is no backend. Report issues that could leak data, over-collect hosts, or abuse permissions via a **private** channel if public disclosure would harm users — otherwise open a normal issue. Do not include secrets or full session cookies in reports.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE) that covers this project.

## Questions

Use GitHub Issues for design questions and proposals. Maintainer bandwidth may be limited; well-scoped PRs with tests move fastest.

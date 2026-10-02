# Genix Coding Agent

**Internal development tool — Genix employees only.**

This repository contains an internal Genix development tool: the Genix Coding Agent CLI (`genixcode`). It is maintained by Genix for use by Genix employees on Genix work. It is not a public or general-purpose product.

## Approved software only

Genix employees must not install or use any software that has not been approved by Genix. Only approved tools may be used for Genix work. If you are unsure whether a tool is approved, do not use it — check with your manager or the IT team first.

## Relationship to opencode

This is a customised version of [opencode](https://github.com/anomalyco/opencode), built and maintained internally by Genix. It is locked to Genix-approved services.

Genix employees must not use opencode or its cloud service in any way. This includes, but is not limited to:

- Installing or running the public opencode CLI, desktop app, or any other opencode-distributed application
- Creating or signing in to an opencode account
- Sending code, prompts, or any other Genix data to opencode's cloud service, gateway, or hosted models
- Purchasing or using opencode subscriptions, credits, or paid plans

Only this internal Genix build may be used.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/opencode/` | Agent core and the `genixcode` CLI |
| `packages/core/` | Shared runtime, including the fork-owned provider lock and managed key file |
| `packages/tui/` | Terminal UI components |
| `packages/desktop/` | The GenixCode desktop app (Electron) |
| `packages/app/` | The UI the desktop app renders |

Upstream code retained from opencode is kept as close to unmodified as practical so the fork can be rebased; see [FORK.md](FORK.md) for the divergence convention, the provider lock, and the branding changes.

## Building locally

Build the CLI binary for the current platform:

```bash
cd packages/opencode && bun run build --single --skip-install
```

The binary is written to `packages/opencode/dist/opencode-<platform>-<arch>/bin/genixcode`.

Build the desktop app (requires a desktop-capable machine — it runs Electron):

```bash
cd packages/desktop && bun run build && bun run package
```

Artefacts are written to `packages/desktop/dist/`. Set `OPENCODE_CHANNEL` to `dev` (default), `beta`
or `prod` to choose the application id, product name and icons. The desktop app has no auto-update
feed; builds are distributed internally. Each release also carries a Linux `.deb` for x64 and arm64,
built by `fork-publish.yml` and attached to the GitHub release.

Full build, release, and publishing details are in [FORK.md](FORK.md).

## Support

For access, configuration, issues, or questions, contact the Genix internal development team through the usual internal support channels.

## Licence

This project is a derivative of [opencode](https://github.com/anomalyco/opencode) and retains its upstream licensing. See [LICENSE](LICENSE) and the third-party licence notices bundled with each package. Referencing the upstream project here does not authorise use of opencode or its services — see the section above.

# GenixCode Desktop

<!-- fork_change - Genix branding and build notes; see ../../FORK.md § Desktop app -->

The GenixCode desktop app, built with Electron. It embeds the server from
`packages/opencode`, so the provider lock and the managed key file apply here
exactly as they do to the CLI.

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```

`OPENCODE_CHANNEL` selects `dev` (default), `beta` or `prod`, which decides the
application id, product name and icons. There is no auto-update feed: builds are
distributed internally.

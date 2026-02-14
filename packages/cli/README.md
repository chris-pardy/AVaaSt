# @avaast/cli

Command-line interface for managing AVaaSt services.

## Purpose

The CLI is the primary user interface for starting, monitoring, and validating AVaaSt
deployments. It wraps the controller and gateway packages, provides configuration loading
from files and environment variables, and exposes health-check commands.

## Installation

The CLI is part of the AVaaSt monorepo. After building:

```bash
pnpm build
```

Run commands with:

```bash
pnpm --filter @avaast/cli start
# or directly:
node packages/cli/dist/index.js start
```

## Commands

### `avaast start`

Start the AVaaSt gateway and controller.

```
Usage: avaast start [options]

Options:
  -c, --config <path>      Path to avaast.json config file
  -l, --log-level <level>  Log level: debug, info, warn, error (default: "info")
```

Starts the controller first (to begin watching the PDS), then the gateway. Runs until
interrupted with `SIGINT` or `SIGTERM`.

### `avaast status`

Check the health of a running AVaaSt instance.

```
Usage: avaast status [options]

Options:
  -c, --config <path>  Path to avaast.json config file
```

Checks both the gateway (`GET /admin/status`) and controller (`GET /internal/deploy/status`),
displaying endpoint count, uptime, and deploy states.

Example output:

```
Gateway:    HEALTHY (2 endpoints, uptime 120s)
Controller: HEALTHY
  Deploys:
    bafyabc12345 ACTIVE
    bafydef67890 RETIRED
```

### `avaast validate`

Validate configuration without starting services.

```
Usage: avaast validate [options]

Options:
  -c, --config <path>  Path to avaast.json config file
```

Parses and validates all configuration values against the Zod schema, displaying the
resolved settings or error messages.

## Configuration

The CLI loads configuration from three sources (later sources override earlier):

1. **Config file** — `avaast.json` in the working directory, or the path given with `-c`
2. **Environment variables** — `AVAAS_WATCH_DID`, `AVAAS_PDS_ENDPOINT`, `AVAAS_PORT`, etc.
3. **Zod validation** — applies defaults and validates constraints

See the [root README](../../README.md#configuration) for the full variable reference.

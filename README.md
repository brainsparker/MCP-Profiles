# MCP Profiles

**Portable, reusable operating systems for AI agents.**

Most agent platforms treat every agent as interchangeable — pick a model, attach tools, send prompts. But a Growth PM, a software engineer, and a financial analyst should not behave the same way. They need different memory, retrieval, sources, tools, and workflows.

An **MCP Profile** defines an agent's *identity* independently of the model:

- **Memory** sources
- **Retrieval** strategy and preferred sources
- **Tool** access (permissions)
- **Workflow** rules and operating procedures
- **Persona** (role, objectives, voice)

The same underlying model, paired with different profiles, behaves like different agents.

## How it works

This repo ships two things:

1. **A language-agnostic spec** — profiles are YAML, validated by [`spec/profile.schema.json`](./spec/profile.schema.json) (JSON Schema draft 2020-12). The schema is the durable, shareable primitive; any language can consume it.
2. **A reference MCP gateway** (TypeScript) — a real [Model Context Protocol](https://modelcontextprotocol.io) server that is *also* a client to your downstream MCP servers.

```
   ┌─────────────┐      MCP       ┌──────────────────┐      MCP       ┌─────────────────┐
   │  MCP client │ ───────────▶   │  mcp-profiles    │ ───────────▶   │ amplitude-mcp   │
   │ (the agent) │   (server)     │     gateway      │   (client)     │ notion-mcp      │
   └─────────────┘ ◀───────────   │                  │ ◀───────────   │ linear-mcp …    │
                   only the tools  │ active profile → │  all tools     └─────────────────┘
                   the profile     │ filters + routes │
                   permits         └──────────────────┘
```

The gateway connects to your downstream MCP servers, aggregates their tools, and **re-exposes only the tools the active profile permits**. Switching profiles at runtime reshapes the exposed tools/resources/prompts and emits `tools/list_changed` so the client re-fetches — same model, a different operating system.

## Quick start

```bash
npm install
npm run build

# Run the gateway over stdio with the example profiles
node dist/index.js --profile growth-pm \
  --profiles-dir ./profiles \
  --config ./mcp-profiles.config.json
```

Options (CLI flag > env var > default):

| Flag | Env | Default | Purpose |
|---|---|---|---|
| `--profile <id>` | `MCP_PROFILE` | first loaded | active profile at startup |
| `--profiles-dir <path>` | `MCP_PROFILES_DIR` | `./profiles` | directory of YAML profiles |
| `--config <path>` | `MCP_PROFILES_CONFIG` | `./mcp-profiles.config.json` | downstream server registry |

### Inspect it

```bash
npm run inspect   # builds + launches the MCP Inspector against growth-pm
```

In the Inspector: the **Tools** tab shows only the permitted tools (plus the built-in `switch_profile` / `list_profiles`), **Resources** shows `profile://active` / persona / memory, and **Prompts** shows the profile's procedures. Call `switch_profile` and watch the tool list change live.

### Wire it into a client

See [`examples/client-config/claude-desktop.json`](./examples/client-config/claude-desktop.json).

## Profiles

A profile is YAML (see [`profiles/`](./profiles) and the [spec README](./spec/README.md)):

```yaml
apiVersion: mcp-profiles/v1
kind: Profile
metadata: { id: growth-pm, name: Growth PM }
persona:
  role: Growth Product Manager
  voice: Concise, hypothesis-driven, metrics-first.
tools:
  defaultPolicy: deny           # the enforcement surface
  allow:
    - { server: amplitude-mcp, tools: ["query_event", "get_funnel"] }
    - { server: notion-mcp, tools: ["*"] }
  deny:
    - { server: notion-mcp, tools: ["delete_page"] }
workflow:
  rules: ["State the hypothesis and target metric before proposing an experiment."]
```

Profiles reference downstream servers **by id only**. Connection details and secrets live separately in [`mcp-profiles.config.json`](./mcp-profiles.config.json) (`${VAR}` placeholders are read from the environment), so profiles stay shareable and secret-free.

## Built-in tools

| Tool | Purpose |
|---|---|
| `switch_profile` | Activate a different profile; reshapes the exposed surface. |
| `list_profiles` | List available profiles and which is active. |

## Development

```bash
npm run dev         # watch mode (tsx)
npm run typecheck   # tsc --noEmit
npm test            # vitest (unit + e2e with a real mock downstream)
npm run gen:types   # regenerate src/profile/types.ts from the JSON Schema
```

## Status & roadmap

**MVP (this repo):** YAML profile spec + JSON Schema, gateway with deny-by-default tool permissions, namespacing, downstream proxying (stdio + streamable HTTP clients), runtime profile switching with `list_changed`, persona/rules/procedures as prompts, inline memory as resources, stdio transport.

**Deferred:** streamable-HTTP *server* transport + per-session active profile; proxying downstream resources/prompts; live `mcp-resource`/`file` memory + a real retrieval engine (retrieval is declarative metadata today); on-demand connect/disconnect on switch; profile inheritance (`extends`); a shareable profile registry; OAuth for remote downstreams.

## License

MIT © Brian Sparker

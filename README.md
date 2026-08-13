# agentbin

A tiny, self-hosted pastebin for **Agent session logs**. `curl` a JSONL session
file at it and get back a UUID-backed, server-rendered **static-ish** page you
can share. Storage is a single SQLite file; runtime dependencies are zero.

Built with [Bun](https://bun.sh) + TypeScript. No frontend framework, no client
build step, no external services.

## Features

- **Auto-detects** the log format — currently:
  | Format | Id | Source location |
  |---|---|---|
  | Claude Code | `claude-code` | `~/.claude/projects/<dir>/<sid>.jsonl` |
  | CodeBuddy Code | `codebuddy` | `~/.codebuddy/projects/<hash>/<sid>.jsonl` |
  | Pi | `pi` | `~/.pi/agent/sessions/<dir>/<ts>_<uuid>.jsonl` |
- Renders a clean transcript: user/assistant turns, collapsible **thinking**,
  **tool calls** with their results paired together, markdown (fenced code,
  lists, headings, inline code), model + token stats.
- The browser page is plain server-rendered HTML — collapsible sections use
  native `<details>`, and a few lines of vanilla JS add copy / expand-all.
- **Extensible**: every format is a small `Parser`; adding one is ~80 lines.

## Quick start

```bash
bun install
bun run start          # serves on http://0.0.0.0:3000
```

Paste a session:

```bash
curl --data-binary @session.jsonl http://localhost:3000/
# → { "id": "<uuid>", "url": "http://localhost:3000/<uuid>", "format": "claude-code", ... }
```

Open the returned `url`. Other endpoints:

| Route | Description |
|---|---|
| `POST /` (or `/paste`) | Accept a JSONL body, return the share JSON |
| `GET /<id>` | Rendered transcript page |
| `GET /<id>/raw` | Original JSONL (`application/x-ndjson`) |
| `GET /<id>/json` | Normalized intermediate representation |
| `GET /healthz` | Liveness probe |

> `curl -H "Accept: text/plain" --data-binary @s.jsonl http://localhost:3000/`
> returns just the URL, for scripting.

## Configuration

Environment variables (all optional):

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Where `agentbin.db` lives |
| `MAX_BODY` | `20971520` | Max accepted paste size (bytes) |

## Storage

One SQLite database (`bun:sqlite`, no driver dependency) with a single
`sessions` table. Each row keeps the raw JSONL plus the parsed, normalized IR
used for rendering. No public index/list page — UUIDs are unguessable and logs
may be sensitive, so pages are only reachable via their link.

## Architecture

```
src/
  index.ts          Bun.serve entrypoint + routing
  config.ts         env config
  db.ts             bun:sqlite schema + helpers
  ir.ts             normalized IR types + tool-result pairing
  markdown.ts       tiny dependency-free markdown renderer
  render.ts         server-side HTML (CSS + landing + transcript)
  util.ts           escape / format helpers
  parsers/
    index.ts        registry + auto-detection (score-based sniffing)
    claude.ts       Claude Code dialect
    codebuddy.ts    CodeBuddy Code (flat OpenAI-Responses-shaped events)
    pi.ts           Pi (session header + message tree)
    helpers.ts      shared content/usage normalizers
```

Each parser implements the `Parser` interface from `ir.ts`:

```ts
export interface Parser {
  id: string;                 // stored in the DB, returned in POST response
  label: string;              // badge text
  sniff(line: Record<string, unknown>): number;   // detection score per line
  parse(lines: string[]): SessionIR;              // normalize to IR
}
```

To add a format (e.g. Codex): create `src/parsers/codex.ts`, export a
`codexParser`, register it in `src/parsers/index.ts`'s `PARSERS` array, and add
a fixture under `fixtures/`. Detection and rendering come for free.

## Development

```bash
bun run dev        # watch mode
bun test           # parser tests against fixtures/
bun run typecheck  # tsc --noEmit
```

## Conventional commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

- **type** — `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **scope** — optional module/area, e.g. `parsers`, `render`, `db`, `api`
- **subject** — imperative, lowercase, ≤ 72 chars, no trailing period

Examples:

```
feat(parsers): add CodeBuddy Code session format
fix(render): escape model name in session badge
docs(readme): document conventional commits
```

A `.gitmessage` template is provided. Enable it per-repo (or globally) with:

```bash
git config commit.template .gitmessage
```

## Notes on format differences

- **Claude Code** stores an Anthropic-Messages-shaped transcript: top-level
  `type` of `summary`/`user`/`assistant`/`system`, with tool results riding on a
  following `user` line as `tool_result` blocks.
- **CodeBuddy Code** uses a *flat* event stream (`message`, `reasoning`,
  `function_call`, `function_call_result`, `topic`) with an OpenAI-Responses
  feel; one assistant turn spans several events and is grouped by
  `providerData.messageId`.
- **Pi** starts with a `type: "session"` header, then `type: "message"` entries
  whose `message.role` is `user`/`assistant`/`toolResult`/`bashExecution`/…

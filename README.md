# World Wide Canvas

One giant, shared, anonymous grid that anyone can draw on — from any device, in real time. Glide around a white graph-paper world, zoom into your spot, and paint cells like pixel art while everyone else's cells appear live around you. Think **r/place meets 2b2t**: open, persistent, and a little bit chaotic.

> Status: **v1 core loop.** Draw · see others live · it persists. Anonymous with light guardrails.

<!-- Add a demo GIF here once deployed: ![demo](docs/demo.gif) -->

## What it does

- **Infinite-feeling, finite world** — a very large bounded plane (65536×65536 cells ≈ 4.3B, default), **centered on the origin**: coordinates run negative-to-positive (−32768…32767 per axis) with `0,0` in the middle as a shared spawn point. It's so large you can't see it all even fully zoomed out, so remote builds are found by shared coordinates — "distance is your defense," 2b2t-style.
- **Real-time** — paint a cell and everyone viewing that area sees it instantly over WebSockets.
- **Persistent** — the world is saved to disk and reloads exactly as you left it.
- **Any device** — mouse + keyboard on desktop (WASD, scroll, drag), touch on mobile (drag, pinch, tap).
- **Zoom to explore, zoom in to paint** — pull way out to survey the whole canvas (view-only); painting turns on once you're zoomed in close enough to aim.
- **Any color** — a hue wheel with saturation / lightness / metallic sliders, plus a native color picker with a live hex readout. Cells store full RGB.
- **Bookmarked coordinates** — name and save spots, click to jump back. Saved per-browser (localStorage).
- **Anonymous, with guardrails** — no signup. A *charge budget* (build steadily, but you can't nuke the world at once) plus rate limiting stop any single user from taking over, while a huge world lets you build far from spawn's chaos. Every edit is logged for moderation/replay. Griefing is possible by design — distance is your protection.

## How it works

The whole design turns on one idea: the world is split into fixed **256×256 chunks**, and the client only ever loads the chunks currently on screen — exactly like map tiles. That's what makes an "infinite" shared canvas cheap to sync and render.

```
┌─────────┐   viewport (which chunks am I looking at?)   ┌──────────────┐
│ Browser │ ───────────────────────────────────────────▶ │  ws server   │
│ Canvas  │ ◀─────────── chunk data / live edits ───────  │ (Node + ws)  │
└─────────┘                                                └──────┬───────┘
     ▲          paint (x, y, color, brush)                        │
     └──────────────────────────────────────────────────┐        ▼
                                                    in-memory chunks
                                                    + SQLite (snapshots
                                                      & append-only edit log)
```

- **A cell edit is tiny** — `(x, y, r, g, b)`. Cells store full RGBA (alpha 0 = unpainted), so any color from the wheel is allowed. Conflicts resolve last-write-wins, so there's no locking or merge logic.
- **The server is authoritative** — it validates every paint (bounds, color bytes, brush cap, rate limit, charges), applies it, broadcasts to everyone viewing that chunk, and appends it to the edit log.
- **Storage is swappable** — v1 keeps the live world in memory and persists to **SQLite** behind a small `StorageAdapter` interface. Swapping in Redis + Postgres for multi-node scale later needs no changes to the game logic.

### Project layout

```
shared/   protocol messages, chunk math, charge budget, config  (imported by both sides)
server/   ws server, in-memory ChunkStore, StorageAdapter (SQLite), guardrails
client/   Vite app: Canvas2D renderer, camera, input/nav, painting UI, ws client
```

## Run it locally

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. Open it in two windows and paint in one — the other updates live. The server runs on `:8787`; Vite proxies `/ws` to it in dev.

```bash
npm test        # pure-logic unit tests (chunk math, charges, store, line-fill)
npm run typecheck
```

### Production build

```bash
npm run build:client   # bundles the client into dist/client
npm start              # server serves dist/client AND the WebSocket on one port
```

## Configuration

Everything tunable lives in one place: [`shared/config.ts`](shared/config.ts). Change a value and both client and server follow. Highlights:

| Setting | Default | Meaning |
| --- | --- | --- |
| `worldWidth` / `worldHeight` | 65536 | World size in cells (origin-centered) |
| `chunkSize` | 256 | Cells per chunk side |
| `palette` | 32 colors | Legacy palette — only used to migrate old chunks; live painting uses the free-color wheel |
| `voidColor` | `#000000` | Color shown outside the world limits |
| `minPaintCellPx` | 4.8 | Zoom-in threshold before painting is allowed (lower = paint further zoomed out) |
| `maxBrushSize` | 10 | Largest NxN brush |
| `chargesEnabled` / `server.rateLimitEnabled` | `true` | Master switches for the charge budget and anti-flood rate limit |
| `chargeMax` / `chargeRefillMs` | 1000 / 200 | Charge budget: burst 1000 cells, +1 every 200ms (~5/sec sustained) |

Env overrides for hosting: `PORT` and `WWC_DB_FILE`.

## Deploy

Needs an always-on host with a **persistent disk** (for the SQLite file) and **WebSocket** support. The included `Dockerfile` runs anywhere Docker does.

**Fly.io** (config in `fly.toml`):

```bash
fly launch --no-deploy                                  # claim an app name
fly volumes create world_data --size 1 --region iad     # persistent world storage
fly deploy
```

**Railway / Render / a VPS:** build the image from the `Dockerfile`, mount a volume at `/app/data`, and expose the port. That's it.

## Roadmap (deferred from v1)

- **Per-IP limits (before going public)** — charges + rate limit are currently per-connection, so reconnecting / opening tabs refills the burst. Key them by IP so the anti-takeover budget can't be bypassed.
- Overview "mip" tiles for a fast, fully zoomed-out view of the whole world
- Minimap and live chat
- Accounts (optional) + a proper admin dashboard (region revert, bans) on top of the edit log
- Redis + Postgres adapter for multi-node scale
- Optional donations / premium

## License

MIT — see [LICENSE](LICENSE).

# WHO DAT? — two-player guessing game

**Play:** https://whodat.demarioking.com (linked from the Game Zone on https://demarioking.com)

WHO DAT? has its own Cloudflare **Pages** project (`whodat`, root directory = this repo's root).
Every push to `main` redeploys it. It's independent of the main website and of TURK.

## Where the files are

| Path | What it is |
|---|---|
| `site/` | The game page: HTML, CSS, JS (engine, characters, sound, app), images, favicon, and security headers (`_headers`). |
| `functions/api/[[path]].js` | The online-play server: a Pages Function that handles everything under `/api/`. |
| `functions/_lib/` | Room logic, database code, and name cleaning. The server reuses the same `site/js/engine.js` the browser uses. |
| `wrangler.jsonc` | Pages settings, including the `WHODAT_DB` database binding. |
| `test/` | Automated tests and a local stand-in for Cloudflare Pages. |

## Cloudflare setup (one time)

- **Pages project:** `whodat`, connected to this GitHub repo, production branch `main`, build command empty, build output `site`.
- **Database binding:** `WHODAT_DB` → D1 database `whodat-game` (set in `wrangler.jsonc`; if the dashboard asks, add it under Settings → Bindings).
- **Custom domain:** `whodat.demarioking.com` (Custom domains tab). Cloudflare creates the DNS record automatically.

No secrets or API keys are used anywhere.

## How it plays

1. Both players secretly pick a mystery player from the same 24 characters.
2. On your turn, **type your own yes/no question**.
3. Your opponent answers **YES** or **NO**.
4. **You knock characters down yourself** — tap a portrait to knock it down, tap again to bring it back.
   The game never eliminates anyone for you (there is no auto-eliminate option, on purpose).
5. **Done — End Turn** passes control. You can't end a turn before your question is answered.
6. **Make Final Guess** on your turn: right = win, wrong = lose. One guess per match.

Chat (WHO DAT CHAT) is completely separate: it never asks a question, ends a turn or touches a board.

## Online multiplayer

- Rooms are rows in the free Cloudflare D1 database `whodat-game` (binding `WHODAT_DB`, table `whodat_rooms`, created
  automatically). Rooms untouched for a day are deleted.
- The server is the only source of truth. Each browser only receives its own mystery player; the opponent's is sent only
  after the match ends. The opponent's board is only ever sent as a count.
- Each player gets a secret 48-character token stored in their browser. Only the two seated players can read the room or
  its chat; everyone else gets "You're not in this room". Reloading or losing signal rejoins the same seat, board and chat.
- Updates arrive by long polling (the browser asks "anything new?" and the server answers as soon as something changes).
- Limits: questions 140 characters, chat 280 characters, 8 chat messages per 10 seconds, 40 moves per 5 seconds,
  last 100 chat messages kept. Rooms untouched for a day are deleted.
- Leaving mid-match counts as a loss. After a match, both players tap Replay for a rematch (who asks first alternates).

## Testing

Needs Node.js 22.13 or newer. No install step is needed.

```
npm test          # 15 checks: game engine, characters, online rooms, privacy, chat, reconnects
npm run local     # serves the game at http://localhost:8788/
```

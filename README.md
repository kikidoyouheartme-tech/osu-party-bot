<p align="center">
  <img src="public/logo.png" width="148" alt="osu!Party">
</p>

<h1 align="center">osu!Party</h1>

<p align="center">
  A self-hosted Bancho multiplayer referee bot with fair local ELO, automatic host rotation, map regulations, and a local lobby dashboard.
</p>

<p align="center">
  <a href="https://ronaldonater.com/osu-ahr">Command reference</a>
  &nbsp;•&nbsp;
  <a href="https://github.com/ronaldonater/osu-ahr-bot/issues">Report an issue</a>
  &nbsp;•&nbsp;
  <a href="https://ko-fi.com/ronaldonater">Support the project</a>
</p>

---

## What it does

The bot creates and manages osu! multiplayer lobbies through Bancho. It rotates host turns automatically, keeps local competitive records for every game mode, validates selected beatmaps against configurable regulations, and provides a browser-based control panel at <code>http://localhost:3000</code>.

| Lobby flow | Competitive play | Dashboard |
| --- | --- | --- |
| Queue-based host rotation | Per-mode ELO and player statistics | Create and manage multiple lobbies |
| Five-minute map-pick and start timers | Fractional placement ELO with dynamic K-factor | Configure regulations before or after creation |
| Voting for skip, start, abort, and kick | Global best-score and leaderboard notices | Browse player stats and activity logs |
| Optional random Team VS events | Local and global leaderboards | Edit names, passwords, ranked state, and more |

## Quick start

### Requirements

- Node.js 22 or newer
- An osu! OAuth application
- A dedicated osu! account for the Bancho bot
- A legacy osu! API key, required by bancho.js

### Install and configure

~~~sh
npm install
Copy-Item .env.example .env
~~~

Open <code>.env</code> and set your credentials:

~~~dotenv
DATABASE_URL="file:./dev.db"
OSU_CLIENT_ID="your_client_id"
OSU_CLIENT_SECRET="your_client_secret"
BANCHO_USERNAME="your_bot_username"
BANCHO_PASSWORD="your_bot_password"
BANCHO_API_KEY="your_legacy_api_key"
DASHBOARD_TOKEN="a_long_random_secret"
ADMIN_OSU_IDS="your_osu_profile_id"
PORT=3000
~~~

<code>ADMIN_OSU_IDS</code> uses numeric osu! profile IDs, separated by commas when you need more than one administrator.

### Start the bot

~~~sh
npm run db:generate
npm run db:migrate
npm run dev
~~~

Then open [http://localhost:3000](http://localhost:3000), enter the <code>DASHBOARD_TOKEN</code> from your <code>.env</code>, and create a lobby. For a production-style build, use:

~~~sh
npm run build
npm start
~~~

## Local dashboard

The dashboard is the simplest way to create a room and apply its starting rules before anybody joins. It supports:

- Lobby title, optional password, game mode, team mode, and win condition
- Map-star, length, BPM, AR, HP, OD, CS, map-status, and year regulations
- Ranked or unranked lobbies, Free Mod, map conversion settings, and random-event chance
- Active-lobby editing, room closure, optional inactive-room recreation, and a per-lobby activity console
- Per-mode player lookup, player-stat editing, and paginated ELO leaderboards

The dashboard HTML, CSS, and client script live in [public/](public).

## Commands

Commands are case-insensitive. Username parameters can include spaces, and <code>mode</code> accepts <code>osu</code>, <code>taiko</code>, <code>catch</code>, or <code>mania</code>. Players can also use <code>!cmds</code> in a lobby to receive the web reference:

> [ronaldonater.com/osu-ahr](https://ronaldonater.com/osu-ahr)

### Player commands

| Command | Purpose |
| --- | --- |
| <code>!queue</code> | Show the current host queue |
| <code>!skip</code> | Skip as host, or vote to skip the current host |
| <code>!autoskip on/off</code> | Toggle automatic skipping of your host turn |
| <code>!start [seconds]</code> | Start as host after 0–120 seconds, or vote to start |
| <code>!abort</code> | Vote to abort the active match |
| <code>!votekick [username]</code> | Vote to remove a player from the lobby |
| <code>!regulations</code> | Show the active map regulations |
| <code>!pstats [username] [mode]</code> | Show local PartyPoints and match statistics |
| <code>!rank [username] [mode]</code> | Show a player's local ranking |
| <code>!top [local] [mode]</code> | View the local or global ELO leaderboard |
| <code>!playtime</code> or <code>!pt [username]</code> | Show the current lobby-session playtime |
| <code>!timeleft</code> or <code>!tl</code> | Show remaining time in the active match |
| <code>!lastscore</code> or <code>!ls</code> | Show the most recent lobby result |
| <code>!bestscore</code> or <code>!bs [username]</code> | Show a global best score for the selected map |
| <code>!how</code> or <code>!h</code> | Explain the local ELO system |
| <code>!version</code> or <code>!v</code> | Show the installed bot version |
| <code>!donate</code> | Share the project support link |
| <code>!bug</code> | Share the GitHub issue tracker |
| <code>!cmds</code> | Share the online command reference |

### Host-only commands

| Command | Purpose |
| --- | --- |
| <code>!update</code> | Refresh the selected beatmap from osu! |
| <code>!stop</code> | Cancel the pending start timer |
| <code>!skip</code> | Immediately rotate to the next queued host |
| <code>!start [seconds]</code> | Start the selected map |

### Administrator commands

Administrator commands begin with <code>*</code>; permissions are controlled by <code>ADMIN_OSU_IDS</code>.

| Command | Purpose |
| --- | --- |
| <code>*start</code> | Start the selected map immediately |
| <code>*skip</code> | Force host rotation |
| <code>*abort</code> | Abort the active match |
| <code>*kick [username]</code> | Remove a player from the lobby |
| <code>*close</code> | Close the lobby |
| <code>*order player1, player2, player3</code> | Replace the host queue order |
| <code>*resetelo confirm</code> | Reset all players' ELO and competitive statistics |
| <code>*eventchance [0-100]</code> | Set the random-event probability |
| <code>*ranked on/off</code> | Toggle whether matches affect ELO and statistics |

### Lobby settings and denylist

| Command | Purpose |
| --- | --- |
| <code>*keep size [1-16]</code> | Set the lobby size and enable its lock setting |
| <code>*keep password [password]</code> | Set and retain the password for a password-protected lobby |
| <code>*keep mods [mods...]</code> | Set the lobby modifiers and enable their lock setting |
| <code>*keep title [title]</code> | Set and retain the lobby title |
| <code>*no keep size|password|mods|title</code> | Remove the selected lobby-setting lock |
| <code>*denylist add [username]</code> | Deny a known player from the host queue |
| <code>*denylist remove [username]</code> | Restore a denied player |

### Map regulations

Use <code>*regulation [setting] [value]</code>. Multiple numeric settings can be updated at once, for example <code>*regulation min_star=5.25 max_star=6.5999</code>.

| Command | Purpose |
| --- | --- |
| <code>*regulation enable</code> | Enable regulation checking |
| <code>*regulation disable</code> or <code>*no regulation</code> | Disable regulation checking |
| <code>*regulation min_star [number]</code> | Set the minimum star rating |
| <code>*regulation max_star [number]</code> | Set the maximum star rating |
| <code>*regulation min_length [seconds]</code> | Set the minimum map length |
| <code>*regulation max_length [seconds]</code> | Set the maximum map length |
| <code>*regulation gamemode osu|taiko|fruits|mania</code> | Restrict the allowed osu! game mode |
| <code>*regulation allow_convert</code> | Allow converted maps |
| <code>*regulation disallow_convert</code> | Deny converted maps |
| <code>*regulation freemod</code> | Enable Free Mod for the lobby configuration |
| <code>*regulation no_freemod</code> | Disable Free Mod for the lobby configuration |
| <code>*regulation status all</code> | Allow every supported beatmap status |
| <code>*regulation status ranked loved qualified pending graveyard wip</code> | Set the allowed beatmap statuses |
| <code>*regulation min_bpm [number]</code> / <code>max_bpm [number]</code> | Set the BPM range |
| <code>*regulation min_ar [number]</code> / <code>max_ar [number]</code> | Set the approach-rate range |
| <code>*regulation min_hp [number]</code> / <code>max_hp [number]</code> | Set the HP-drain range |
| <code>*regulation min_od [number]</code> / <code>max_od [number]</code> | Set the overall-difficulty range |
| <code>*regulation min_cs [number]</code> / <code>max_cs [number]</code> | Set the circle-size range |
| <code>*regulation min_last_updated_year [year]</code> / <code>max_last_updated_year [year]</code> | Set the last-ranked or last-updated year range |

## ELO and match records

Ranked Head-to-Head games use fractional placement ELO. All finishers receive a result based on placement, tied scores share an averaged rank, and disconnects tie for last. Ratings are compared with the lobby's average ELO.

| Matches played before the game | K-factor |
| --- | ---: |
| 0–10 | 40 |
| 11–100 | 24 |
| 101+ | 16 |

Each game mode maintains its own ELO and stats. A player must complete at least three matches to appear on ELO leaderboards, though ratings continue updating before then. One-player games and random events are unranked and do not change ELO or competitive statistics.

## Project structure

~~~text
src/
  adapters/       Bancho IRC and osu! API integrations
  services/       ELO, map regulations, team balancing, and votes
  lobby-controller.ts
  index.ts        Express API and dashboard server
prisma/
  schema.prisma   SQLite data model
public/
  index.html      Local dashboard
  app.js          Dashboard behavior
  old-osu-theme.css
~~~

## Scripts

| Script | Description |
| --- | --- |
| <code>npm run dev</code> | Run the bot with watch mode |
| <code>npm run build</code> | Compile TypeScript to <code>dist/</code> |
| <code>npm start</code> | Run the compiled build |
| <code>npm test</code> | Build and run ELO tests |
| <code>npm run db:generate</code> | Generate the Prisma client |
| <code>npm run db:migrate</code> | Create or apply Prisma migrations |

## Notes for public deployment

Use a dedicated bot account and keep its credentials and dashboard token private. For a remote deployment, use a durable database such as PostgreSQL, serve the dashboard behind TLS, and configure reconnect and recovery behavior appropriate for your host.

## Credits

The local dashboard theme is adapted from [Stern](https://github.com/osuTitanic/titanic/tree/main/services/stern), inspired by the classic osu! website.

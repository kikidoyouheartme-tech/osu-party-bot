<p align="center">
  <img src="public/logo.png" width="160" alt="osu!Party">
</p>

<h1 align="center">osu!Party</h1>

<p align="center">
  <strong>A Mario Party-style Bancho multiplayer referee bot for osu! featuring Grand Prix cycles, dynamic rotating minigames, PartyPoints, silent lobby management, and a classic web dashboard.</strong>
</p>

<p align="center">
  <a href="https://github.com/kikidoyouheartme-tech/osu-party-bot"><img src="https://img.shields.io/badge/Node.js-22%2B-brightgreen.svg" alt="Node.js 22+"></a>
  <a href="https://github.com/kikidoyouheartme-tech/osu-party-bot"><img src="https://img.shields.io/badge/TypeScript-5.7-blue.svg" alt="TypeScript"></a>
  <a href="https://github.com/kikidoyouheartme-tech/osu-party-bot"><img src="https://img.shields.io/badge/Bancho.js-0.12-ff66aa.svg" alt="Bancho.js"></a>
  <a href="https://github.com/kikidoyouheartme-tech/osu-party-bot"><img src="https://img.shields.io/badge/Prisma-SQLite-1b222d.svg" alt="Prisma SQLite"></a>
  <a href="https://github.com/kikidoyouheartme-tech/osu-party-bot/issues"><img src="https://img.shields.io/badge/Issues-Report_Bug-orange.svg" alt="Report an issue"></a>
  <a href="https://ko-fi.com/ronaldonater"><img src="https://img.shields.io/badge/Support-Ko--Fi-ff5e5b.svg" alt="Support on Ko-fi"></a>
</p>

<p align="center">
  <a href="#core-features">Core Features</a> &nbsp;•&nbsp;
  <a href="#minigame-rotation">Minigame Catalog</a> &nbsp;•&nbsp;
  <a href="#quick-start">Quick Start</a> &nbsp;•&nbsp;
  <a href="#web-dashboard">Web Dashboard</a> &nbsp;•&nbsp;
  <a href="#chat-commands">Chat Commands</a> &nbsp;•&nbsp;
  <a href="#architecture">Architecture</a>
</p>

---

## What is osu!Party?

**osu!Party** transforms standard Bancho multiplayer into an engaging, tournament-style party game. Instead of standard repetitive rotations, players compete across **10-round Grand Prix sessions** featuring dynamically rolled minigames, custom objectives, automated map picks, and unique scoring metrics.

Points are awarded per round, wagers can be placed, win streaks are tracked, and sessions conclude with a podium ceremony celebrating the top 3 finalists before resetting for the next Grand Prix.

| 🎮 Party Grand Prix | 🎯 Dynamic Objectives | 🛡️ Silent Lobby Keeper | 📊 Web Dashboard |
| --- | --- | --- | --- |
| 10-round tournament cycles with real-time session standings | Accuracy targets, elimination, bounties, TAG co-op, & wagers | Zero Bancho chat spam for metadata locks & auto-start | Classic 2007-themed local control panel on `:3000` |
| Final podium celebrations & all-time PartyPoints leaderboards | Mod challenges (HD, HR, DT, FL) & automated community rewinds | Star rating buffer (`±0.10★`) & pre-start state enforcement | Live standings, regulation editor, activity logs, & weight presets |

---

## Core Features

### 🏆 Grand Prix Cycles & PartyPoints
- **10-Round Championship Sessions:** Tracks round progression from Round 1/10 to Round 10/10 with live session standings and victory announcements.
- **Podium Finish Ceremonies:** Concludes each Grand Prix with an ASCII podium ceremony (`1st`, `2nd`, `3rd` places) and awards all-time PartyPoints.
- **Fair Placement Scoring:** Points are calculated dynamically based on placement (`N - rank`), with bonus payouts for special objectives.
- **Win Streaks & Records:** Persists active win streaks, longest streaks, play time, and match podium counts in SQLite via Prisma.

### 🎲 17+ Diverse Minigames across 9 Categories
- **Standard & Team Showdowns:** Head-to-Head score, pure Accuracy, Team VS Score, and Team Sync Accuracy.
- **Objective Gimmicks:** Closest accuracy to a hidden target (Target Practice), lowest miss count (Russian Roulette), combo endurance (Streak Keeper), and room leader bounties (Bounty Hunter).
- **Mod Challenges:** Forced mod matchups including Speedom (Forced DT), Pixel Perfect (Forced HR), Blind Rhythm (Forced HD), and Lights Out / Blindfolded (Forced FL / HD FL).
- **Automated Overrides & Co-op:**
  - **Relay Race (Tag Co-op):** Bancho TAG2 / TAG4 co-op relay with custom map pools.
  - **Boss Battle:** Automatically queries the host's #1 all-time top score from the osu! API and locks into their exact mods (with strict `!mp mods None` enforcement for NoMod plays).
  - **Host's Addiction:** Loads the host's all-time most played beatmap.
  - **Community & Ranked Rewinds:** Curated pools of historical Map of the Year winners and vintage ranked classics.
  - **Host Turn Retention:** When the bot loads an automated special map, the human host retains their host turn for the next round!
- **Social & Gambling:** PartyPoint Wager allows players to wager their session PartyPoints with `!bet <amount>` for a 2x payout if they finish in the Top 2.
- **Asymmetric & Elimination:** 1 vs. All Juggernaut battles and Sudden Death Battle Royale.

### 🛡️ Silent LobbyKeeper & MatchStarter
- **Zero Chat Clutter:** Metadata enforcements (room title, password, team modes, win conditions) execute silently in the background without spamming IRC warnings.
- **Pre-Start Enforcement:** Sequentially enforces forced mods (including NoMod `!mp mods None`), compound `!mp set`, and title reversion immediately prior to match launch.
- **Silent Auto-Start:** Immediately dispatches `!mp start` the exact moment all players in the room ready up.
- **Star Rating Tolerance Buffer:** Incorporates a `±0.10★` floating-point tolerance buffer, preventing false rejections of maps (e.g. `8.01★` with DT in an `8★` lobby).
- **Dynamic Default Lobby Titles:** Automatically generates descriptive room titles when left blank:
  - Both bounds: `osu!Party | Custom Minigames | AHR | 5.00★ - 8.00★`
  - Floor only: `osu!Party | Custom Minigames | AHR | 6.00★+`
  - Ceiling only: `osu!Party | Custom Minigames | AHR | Up to 7.00★`
  - Unconstrained / Disabled: `osu!Party | Custom Minigames | AHR | No Star Limit`
- **Late-Joiner Notifications:** When a player connects mid-session, the bot automatically broadcasts the active ruleset (`[Minigame] Active Ruleset: ...`) to catch them up.
- **Auto-Recreation:** Seamlessly recreates closed or inactive lobbies automatically if Bancho terminates them.

---

## Minigame Catalog

| Minigame | Category | Picker | Scoring Metric | Description |
| --- | --- | --- | --- | --- |
| **Classic Showdown** | Standard Matchup | Host | Score | Standard Head-to-Head battle. Highest total score wins! |
| **Precision Master** | Standard Matchup | Host | Accuracy | Score doesn't matter! Pure accuracy (%) decides the winner. |
| **Team Clash (Score)** | Team Matchup | Host | Team Score | Red vs Blue showdown. Winning team splits placement points. |
| **Team Sync (Accuracy)** | Team Matchup | Host | Team Accuracy | Highest combined average team accuracy (%) wins. |
| **Target Practice** | Objective Gimmick | Host | Target Acc | Aim for the target Acc without going over! Closest accuracy wins (NF). |
| **Russian Roulette** | Objective Gimmick | Host | Lowest Misses | Survive with clean hits. Lowest miss count takes first place! |
| **Streak Keeper** | Objective Gimmick | Host | Max Combo | Keep the chain alive! Highest peak combo anywhere in the map wins. |
| **Bounty Hunter** | Objective Gimmick | Host | Bounty Score | Standard score race, but beating the room leader awards a massive point bonus! |
| **Speedom** | Mod Challenge | Host | Score | The Freedom to Speed! Forced Double Time (DT). |
| **Pixel Perfect** | Mod Challenge | Host | Score | Small circles, high OD, and AR10. Forced Hard Rock (HR). |
| **Blind Rhythm** | Mod Challenge | Host | Score | Trust your ear! Vanishing approach circles with forced Hidden (HD). |
| **Lights Out** | Mod Challenge | Host | Score | Highest score inside the flashlight beam under forced Flashlight (FL). |
| **Blindfolded** | Mod Challenge | Host | Score | Extreme restricted sightlines! Forced Hidden + Flashlight (HD FL). |
| **Relay Race** | Automated Tag | Bot Tag | Tag Acc/Misses | Turn-based co-op relay! TAG2 for 2 players, TAG4 for 3+ players (NF). |
| **Boss Battle** | Automated Override | Bot API | Score | Face the host's legacy! Loads the host's #1 top score with exact mods. |
| **Host's Addiction** | Automated Override | Bot API | Score | Host comfort pick! Loads the host's all-time most played beatmap. |
| **Community Choice** | Automated Override | Bot Pool | Score | Historical prestige! Randomly chosen Map of the Year winner. |
| **Ranked Rewind** | Automated Override | Bot Pool | Score | Vintage Bancho classics! Random pick from top ranked maps of a vintage year. |
| **Loved Classics** | Automated Override | Bot Pool | Score | Community legends! Random pick from top loved maps of a vintage year. |
| **PartyPoint Wager** | Social / Gambling | Host | Wager | Wager session points with `!bet <amount>`; 2x payout for Top 2! |
| **Juggernaut** | Asymmetric Battle | Host | Juggernaut | 1st-place leader solo on Red vs. Blue lobby average score. |
| **Battle Royale** | Elimination | Host | Elimination | Pass > Fail! Ties broken by highest score under forced Sudden Death (SD). |

---

## Quick Start

### Requirements

- **Node.js 22.x** or newer
- **Dedicated osu! account** for your Bancho IRC bot
- **osu! OAuth Application** (v2 API credentials from your [osu! account settings](https://osu.ppy.sh/home/account/edit#oauth))
- **Legacy Bancho API Key** (v1 API key required by `bancho.js`)

### 1. Clone & Install Dependencies

```sh
git clone https://github.com/kikidoyouheartme-tech/osu-party-bot.git
cd osu-party-bot
npm install
```

### 2. Configure Environment

Copy the example configuration:

```sh
cp .env.example .env
```

Open `.env` and fill in your credentials:

```dotenv
DATABASE_URL="file:./dev.db"
OSU_CLIENT_ID="12345"
OSU_CLIENT_SECRET="your_oauth_client_secret"
BANCHO_USERNAME="PartyBot"
BANCHO_PASSWORD="irc_password_from_osu_account"
BANCHO_API_KEY="your_legacy_osu_api_key_v1"
DASHBOARD_TOKEN="your_secure_dashboard_token"
ADMIN_OSU_IDS="your_numeric_osu_user_id"
PORT=3000
```

> **Note:** `ADMIN_OSU_IDS` uses numeric osu! user IDs (e.g. `2` for peppy). Separate multiple administrators with commas.

### 3. Initialize Database & Launch

```sh
# Generate Prisma Client and apply migrations
npm run db:generate
npm run db:migrate

# Launch development server with hot reloading
npm run dev
```

For production builds:

```sh
npm run build
npm start
```

Visit **`http://localhost:3000`**, enter your `DASHBOARD_TOKEN`, and start creating party lobbies!

---

## Web Dashboard

The local web dashboard runs on port `3000` with an authentic, responsive retro theme inspired by classic osu! website design.

- **Lobby Creator & Dynamic Defaults:** Launch new lobbies with customized regulations, passwords, and auto-interpolated titles.
- **Live Grand Prix Monitor:** View real-time round progress (`Round X/10`), active players, session PartyPoints, all-time PartyPoints, and win streaks.
- **Minigame Rotation & Weights Form:**
  - Adjust total rounds per Grand Prix (1–100).
  - Customize weights for each minigame individually.
  - One-click presets:
    - **Default:** Balanced mix of all party games.
    - **No Gimmicks:** Restricts pool to Standard Showdowns, Speedom, and Pixel Perfect.
    - **Chaos:** Maximizes probabilities for Wagers, Boss Battles, Sudden Death, and Blindfolded.
- **In-Flight Regulations Editor:** Update star rating limits, BPM, length, AR/OD/HP/CS, Free Mod, and allowed statuses live without restarting the room.
- **Activity Console:** Real-time log streamer tracking IRC traffic, referee actions, and score calculations.
- **Player Database & Leaderboards:** Look up player statistics, edit competitive records, and browse global rankings.

---

## Chat Commands

Commands are case-insensitive and can be run directly inside Bancho multiplayer chat.

### Player Commands

| Command | Aliases | Description |
| --- | --- | --- |
| `!queue` | | View the current host queue and player turns |
| `!minigame` | `!game`, `!rules` | Show details and rules of the currently active minigame |
| `!round` | `!cycle` | Show current Grand Prix round (`Round X/10`) |
| `!points` | `!pts` | View your current session and all-time PartyPoints |
| `!leaderboard` | `!standings` | Display the current lobby standings sorted by session points |
| `!bet <amount>` | `!wager` | Wager session PartyPoints during PartyPoint Wager minigames |
| `!reroll` | `!vr`, `!votereroll` | Vote to re-roll the minigame (majority vote; retains host & round) |
| `!skip` | | Host skips turn, or players vote to skip current host |
| `!autoskip [on/off]` | | Toggle auto-skipping your host turns when in queue |
| `!start [sec]` | | Host starts countdown, or players vote to start |
| `!abort` | | Host aborts match, or players vote to abort active game |
| `!votekick <user>` | | Vote to kick a disruptive player from the room |
| `!regulations` | | Display active lobby beatmap rules and star rating limits |
| `!pstats [user] [mode]` | `!stats` | View a player's PartyPoints, matches, wins, and win streak |
| `!rank [user] [mode]` | | View a player's local rank and leaderboard position |
| `!top [local] [mode]` | `!t` | View top 5 players on the PartyPoints leaderboard |
| `!playtime [user]` | `!pt` | View current lobby session playtime |
| `!timeleft` | `!tl` | View estimated remaining time in the active match |
| `!lastscore` | `!ls` | Show results of the most recently completed map |
| `!bestscore [user]` | `!bs` | Show global best score on the current beatmap |
| `!cmds` | `!commands`, `!help` | Display quick command helper in chat |
| `!bug` | | Get the link to report issues on GitHub |
| `!donate` | | Share the support link |
| `!version` | `!v` | Display installed bot version |

### Host-Only Commands

| Command | Description |
| --- | --- |
| `!update` | Refresh metadata of the selected beatmap directly from the osu! API |
| `!stop` | Stop an active start countdown timer |
| `!skip` | Immediately rotate host to the next player in the queue |
| `!start [sec]` | Start the match immediately (default 5 seconds) |

### Administrator Commands

Administrator commands begin with `*` and require the user's osu! profile ID to be listed in `ADMIN_OSU_IDS`.

| Command | Description |
| --- | --- |
| `*reroll` | Force an immediate re-roll of the current round's minigame |
| `*start` | Instantly start the match with 0-second countdown |
| `*skip` | Force immediate host rotation regardless of votes |
| `*abort` | Force match abort and score discard |
| `*order p1, p2, p3` | Override and rearrange the host queue order |
| `*kick <username>` | Immediately kick a user from the lobby |
| `*close` | Gracefully close and clean up the lobby |
| `*ranked [on/off]` | Toggle whether matches award PartyPoints and affect stats |
| `*resetpoints confirm` | Reset competitive PartyPoints across all players |
| `*keep size <1-16>` | Lock lobby size to prevent changes |
| `*keep password <pass>` | Lock room password |
| `*keep mods <mods...>` | Lock room mods to specific combination |
| `*keep title <title>` | Lock lobby title |
| `*no keep <setting>` | Remove a specific lobby lock |
| `*regulation <args>` | Modify map regulation boundaries via chat |
| `*no regulation` | Disable map regulations entirely |
| `*denylist add/remove` | Prevent or allow specific users from receiving host turns |

---

## Architecture

```text
osu-party-bot/
├── prisma/
│   └── schema.prisma          # SQLite schema (Player, Lobby, LobbyPlayer, Match, Score)
├── public/                    # Retro web dashboard
│   ├── app.js                 # Dashboard frontend logic & API client
│   ├── index.html             # Dashboard markup & forms
│   ├── logo.png               # osu!Party branding logo
│   └── old-osu-theme.css      # Authentic classic osu! stylesheet
├── src/
│   ├── adapters/
│   │   ├── bancho.ts          # bancho.js gateway, rate limiting, IRC event handling
│   │   └── osu.ts             # osu! v2 API client (OAuth token refresh, beatmaps, scores)
│   ├── data/                  # Curated map pools
│   │   ├── community-choice-maps.ts
│   │   ├── loved-classics-maps.ts
│   │   ├── ranked-rewind-maps.ts
│   │   ├── tag2-maps.ts
│   │   └── tag4-maps.ts
│   ├── plugins/               # Decoupled lobby lifecycle modules
│   │   ├── LobbyKeeper.ts     # Silent background title, password, & mod lock enforcer
│   │   └── MatchStarter.ts    # Silent auto-start on all-ready trigger
│   ├── services/              # Core game engines & business logic
│   │   ├── lobby-cycle.ts     # State isolation & regulation bypass logic
│   │   ├── party-map-pickers.ts # Automated pick resolution (Boss Battle, Tag, Rewinds)
│   │   ├── party-minigames.ts # Minigame registry, weights, & random roll engine
│   │   ├── party-regulation.ts # Star rating buffer (±0.10★) & map rule validator
│   │   └── party-scoring.ts   # Multi-metric round evaluator & podium formatter
│   ├── index.ts               # Express API, dashboard endpoints, & bot supervisor
│   ├── lobby-controller.ts    # Central Bancho lobby controller & chat command handler
│   └── types.ts               # Shared TypeScript interfaces & defaults
└── dist/                      # Compiled JavaScript output
```

---

## Development & Testing

osu!Party maintains high test coverage using Node.js's native test runner (`node:test`). Tests verify minigame weighting, scoring formulas, target accuracy, elimination tie-breakers, star rating tolerances, pre-start enforcement, title reversion, and late-joiner announcements:

```sh
# Run TypeScript compilation and full test suite
npm test
```

Sample test output:

```text
✔ 10-round cycle counter progression and reset
✔ automated pick pacing prevents consecutive bot picks
✔ rollNextMinigame excludes PartyPoint Wager on round 1
✔ star rating floating-point tolerance buffer allows slight decimal overflows within ±0.10★
✔ LobbyKeeper silently enforces title, password, and forced mods without chat warnings
✔ MatchStarter executes silent auto-start immediately when all players ready
✔ Boss Battle resolves NoMod top play with overrideMods 'None' and issues !mp mods None
✔ pre-start enforcement reverts altered room title immediately prior to match launch
✔ generateDefaultLobbyTitle dynamic star range interpolation and fallback formatting
✔ late-joiner receives active minigame ruleset announcement when joining active session
ℹ tests 52
ℹ pass 52
ℹ fail 0
```

---

## Notes for Production & Hosting

- **Dedicated Account:** Always host using a dedicated osu! secondary account registered for bot use.
- **Database Durability:** By default, Prisma uses SQLite (`dev.db`). For high-concurrency or distributed instances, configure Prisma to use PostgreSQL or MySQL in `prisma/schema.prisma`.
- **Security:** Ensure `DASHBOARD_TOKEN` is kept confidential and set to a cryptographically strong string.
- **Bancho IRC Limits:** `BanchoRateLimiter` enforces strict adherence to Bancho's 10 messages per 5-second rate limit to prevent account silences.

---

## Credits & Acknowledgements

- **[bancho.js](https://github.com/ThePooN/bancho.js):** Bancho IRC multiplayer protocol client.
- **[Prisma](https://www.prisma.io/):** Type-safe database ORM.
- **Dashboard Styling:** Adapted from [Stern](https://github.com/osuTitanic/titanic/tree/main/services/stern), celebrating classic osu! 2007 aesthetic design.
- **Created by:** [ronaldonater](https://ko-fi.com/ronaldonater) & contributors.

| # | Minigame / Event | Category | Map Picker | Forced Mods / Mode | Win Condition / Logic |
| --- | --- | --- | --- | --- | --- |
| **1** | **Classic Showdown** | Standard Matchup | Host | None (`!mp set 0 0`) | Highest total score |
| **2** | **Precision Master** | Standard Matchup | Host | None (`!mp set 0 1`) | Highest overall accuracy (%) |
| **3** | **Team Clash (Score)** | Team Matchup | Host | None (`!mp set 2 0`) | Combined team score; winning side splits points |
| **4** | **Team Sync (Accuracy)** | Team Matchup | Host | None (`!mp set 2 1`) | Highest average team accuracy (%) |
| **5** | **Target Practice** | Objective Gimmick | Host | `NF` | Closest to rolled target Acc (%) |
| **6** | **Russian Roulette** | Objective Gimmick | Host | `NF` | Lowest total miss count |
| **7** | **Streak Keeper** | Objective Gimmick | Host | `NF` | Highest peak max combo achieved anywhere in the map |
| **8** | **Bounty Hunter** | Objective Gimmick | Host | `NF` | Standard score; bonus points for beating 1st-place leader |
| **9** | **Blindfolded** | Mod Challenge | Host | `HD FL NF` | Highest total score under restricted vision |
| **10** | **Blind Rhythm** | Mod Challenge | Host | `HD NF` | Highest score with vanishing circles |
| **11** | **Pixel Perfect** | Mod Challenge | Host | `HR NF` | Highest score with smaller CS, AR10, and tight OD |
| **12** | **Lights Out** | Mod Challenge | Host | `FL NF` | Highest score inside the flashlight beam |
| **13** | **Speedom** | Mod Challenge | Host | `DT NF` | Highest score at 1.5x speed |
| **14** | **Relay Race (Tag Co-op)** | Automated Tag | Bot (by lobby size) | `NF` (`!mp set 1 0`) | Turn-based tag play; ranked by personal accuracy & misses |
| **15** | **Boss Battle** | Automated Override | Bot (API) | Host's Top Mods + `NF` | Host's personal #1 top play; standard score wins |
| **16** | **Host's Addiction** | Automated Override | Bot (API) | `NF` | Host's all-time most played map; standard score wins |
| **17** | **Community Choice Rewind** | Automated Override | Bot (Pool) | `NF` | Random historical Map of the Year winner |
| **18** | **Ranked Rewind (Top 3)** | Automated Override | Bot (Pool) | `NF` | Random year, then random pick from top 5 most played ranked maps |
| **19** | **Loved Classics (Top 3)** | Automated Override | Bot (Pool) | `NF` | Random year, then random pick from top 5 most played loved maps |
| **20** | **PartyPoint Wager** | Social / Gambling | Host | `NF` | Optional `!bet <amount>` during prep; 2x payout if finishing Top 2 (adjusts based on player count in lobby) |
| **21** | **Juggernaut (1 vs. All)** | Asymmetric Battle | Host | `NF` (`!mp set 2 0`) | 1st-place leader solo on Red vs. Blue lobby average score |
| **22** | **Sudden Death: Battle Royale** | Elimination | Host | `SD` (No `NF`) | Pass > Fail; ties broken by highest score / distance survived |
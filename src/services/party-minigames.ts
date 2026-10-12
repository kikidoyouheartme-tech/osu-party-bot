import { getRandomTag2MapId } from "../data/tag2-maps.js";
import { getRandomTag4MapId } from "../data/tag4-maps.js";

export type MinigameCategory =
  | "Standard Matchup"
  | "Team Matchup"
  | "Objective Gimmick"
  | "Mod Challenge"
  | "Automated Tag"
  | "Automated Override"
  | "Social / Gambling"
  | "Asymmetric Battle"
  | "Elimination";

export type MapPickerStrategy =
  | "host"
  | "bot_tag"
  | "bot_api_host_top"
  | "bot_api_host_most_played"
  | "bot_pool_community_choice"
  | "bot_pool_ranked_rewind"
  | "bot_pool_loved_classics";

export type ScoringMetric =
  | "score"
  | "accuracy"
  | "team_score"
  | "team_accuracy"
  | "target_accuracy"
  | "misses"
  | "combo"
  | "bounty"
  | "wager"
  | "juggernaut"
  | "elimination"
  | "tag_accuracy_misses";

export interface MinigameDefinition {
  id: string;
  name: string;
  category: MinigameCategory;
  description: string;
  mapPicker: MapPickerStrategy;
  teamMode: number;   // 0 = Head-to-Head, 1 = Tag Co-op, 2 = Team VS, 3 = Tag Team VS
  scoreMode: number;  // 0 = Score, 1 = Accuracy, 2 = Combo, 3 = ScoreV2
  forcedMods: string; // e.g., "NF", "HD FL NF", "SD"
  scoringMetric: ScoringMetric;
  dynamicMods?: boolean;
}

export const PARTY_MINIGAMES: MinigameDefinition[] = [
  // 1. Standard Matchups
  {
    id: "classic-showdown",
    name: "Classic Showdown",
    category: "Standard Matchup",
    description: "Standard Head-to-Head battle. Highest total score wins!",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "score",
  },
  {
    id: "precision-master",
    name: "Precision Master",
    category: "Standard Matchup",
    description: "Score doesn't matter! Pure accuracy (%) decides the winner.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 1,
    forcedMods: "",
    scoringMetric: "accuracy",
  },

  // 2. Team Matchups
  {
    id: "team-clash-score",
    name: "Team Clash (Score)",
    category: "Team Matchup",
    description: "Red vs Blue showdown! Winning team splits placement points based on total score.",
    mapPicker: "host",
    teamMode: 2,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "team_score",
  },
  {
    id: "team-sync-accuracy",
    name: "Team Sync (Accuracy)",
    category: "Team Matchup",
    description: "Sync your timing! Highest combined average accuracy (%) wins.",
    mapPicker: "host",
    teamMode: 2,
    scoreMode: 1,
    forcedMods: "",
    scoringMetric: "team_accuracy",
  },

  // 3. Objective Gimmicks
  {
    id: "target-practice",
    name: "Target Practice",
    category: "Objective Gimmick",
    description: "Aim for the target Acc without going over! Closest accuracy wins.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 1,
    forcedMods: "NF",
    scoringMetric: "target_accuracy",
  },
  {
    id: "russian-roulette",
    name: "Russian Roulette",
    category: "Objective Gimmick",
    description: "Survive with clean hits. Lowest total miss count takes first place!",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "misses",
  },
  {
    id: "streak-keeper",
    name: "Streak Keeper",
    category: "Objective Gimmick",
    description: "Keep the chain alive! Highest peak max combo anywhere in the map wins.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 2,
    forcedMods: "",
    scoringMetric: "combo",
  },
  {
    id: "bounty-hunter",
    name: "Bounty Hunter",
    category: "Objective Gimmick",
    description: "Standard score race, but beating the room leader awards a massive PartyPoint bounty!",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "bounty",
  },

  // 4. Mod Challenges
  {
    id: "blindfolded",
    name: "Blindfolded",
    category: "Mod Challenge",
    description: "Restricted sightlines! Forced Hidden + Flashlight.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "HD FL",
    scoringMetric: "score",
  },
  {
    id: "blind-rhythm",
    name: "Blind Rhythm",
    category: "Mod Challenge",
    description: "Trust your ear! Vanishing approach circles with forced HD.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "HD",
    scoringMetric: "score",
  },
  {
    id: "pixel-perfect",
    name: "Pixel Perfect",
    category: "Mod Challenge",
    description: "Small circles, high OD, and AR10. Forced Hard Rock.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "HR",
    scoringMetric: "score",
  },
  {
    id: "lights-out",
    name: "Lights Out",
    category: "Mod Challenge",
    description: "Highest score inside the flashlight beam under forced Flashlight.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "FL",
    scoringMetric: "score",
  },
  {
    id: "speedom",
    name: "Speedom",
    category: "Mod Challenge",
    description: "The Freedom to Speed! Forced Double Time.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "DT",
    scoringMetric: "score",
  },

  // 5. Automated Tag
  {
    id: "relay-race",
    name: "Relay Race (Tag Co-op)",
    category: "Automated Tag",
    description: "Turn-based co-op relay! TAG2 for 2 players, TAG4 for 3+ players.",
    mapPicker: "bot_tag",
    teamMode: 1,
    scoreMode: 0,
    forcedMods: "NF",
    scoringMetric: "tag_accuracy_misses",
  },

  // 6. Automated Overrides
  {
    id: "boss-battle",
    name: "Boss Battle",
    category: "Automated Override",
    description: "Face the host's legacy! Loads the host's #1 top play with their exact mods.",
    mapPicker: "bot_api_host_top",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "score",
    dynamicMods: true,
  },
  {
    id: "hosts-addiction",
    name: "Host's Addiction",
    category: "Automated Override",
    description: "Host comfort pick! Loads the host's all-time most played map.",
    mapPicker: "bot_api_host_most_played",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "score",
  },
  {
    id: "community-choice-rewind",
    name: "Community Choice Rewind",
    category: "Automated Override",
    description: "Historical prestige! Randomly chosen Map of the Year winner.",
    mapPicker: "bot_pool_community_choice",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "score",
  },
  {
    id: "ranked-rewind",
    name: "Ranked Rewind (Top 3)",
    category: "Automated Override",
    description: "Vintage Bancho classics! Random year, then random pick from top 5 most played ranked maps.",
    mapPicker: "bot_pool_ranked_rewind",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "score",
  },
  {
    id: "loved-classics",
    name: "Loved Classics (Top 3)",
    category: "Automated Override",
    description: "Community legends! Random year, then random pick from top 5 most played loved maps.",
    mapPicker: "bot_pool_loved_classics",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "score",
  },

  // 7. Social / Gambling
  {
    id: "partypoint-wager",
    name: "PartyPoint Wager",
    category: "Social / Gambling",
    description: "Put points on the line! Use !bet <amount> during prep; 2x payout if finishing Top 2.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "wager",
  },

  // 8. Asymmetric Battle
  {
    id: "juggernaut",
    name: "Juggernaut (1 vs. All)",
    category: "Asymmetric Battle",
    description: "1st-place leader solo on Red vs. Blue lobby average score.",
    mapPicker: "host",
    teamMode: 2,
    scoreMode: 0,
    forcedMods: "",
    scoringMetric: "juggernaut",
  },

  // 9. Elimination
  {
    id: "sudden-death-battle-royale",
    name: "Sudden Death: Battle Royale",
    category: "Elimination",
    description: "Pass > Fail! Ties broken by highest score or distance survived under forced SD.",
    mapPicker: "host",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "SD",
    scoringMetric: "elimination",
  },
];

export function getMinigame(id: string): MinigameDefinition | undefined {
  return PARTY_MINIGAMES.find((m) => m.id === id);
}

export function rollNextMinigame(
  previousMinigame?: MinigameDefinition | string,
  weights?: Record<string, number>,
  currentRound?: number
): MinigameDefinition {
  const prevGame = typeof previousMinigame === "string" ? getMinigame(previousMinigame) : previousMinigame;
  let eligible = PARTY_MINIGAMES.filter((g) => g.id !== prevGame?.id);

  // If first round, exclude PartyPoint Wager since players don't have session points yet
  if (currentRound === 1) {
    eligible = eligible.filter((g) => g.id !== "partypoint-wager");
  }

  // If previous round was an automated map picker, force host picker for next round
  if (prevGame && prevGame.mapPicker !== "host") {
    eligible = eligible.filter((g) => g.mapPicker === "host");
  }

  // Filter out disabled games (weight === 0)
  if (weights) {
    eligible = eligible.filter((g) => (weights[g.id] ?? 100) > 0);
  }

  if (eligible.length === 0) {
    eligible = PARTY_MINIGAMES.filter((g) => g.mapPicker === "host");
    if (currentRound === 1) {
      eligible = eligible.filter((g) => g.id !== "partypoint-wager");
    }
  }

  if (eligible.length === 0) {
    eligible = PARTY_MINIGAMES.filter((g) => (currentRound === 1 ? g.id !== "partypoint-wager" : true));
  }

  // Weighted random roll
  const totalWeight = eligible.reduce((acc, g) => acc + (weights?.[g.id] ?? 100), 0);
  if (totalWeight <= 0) {
    return eligible[0] ?? PARTY_MINIGAMES[0];
  }
  let randomVal = Math.random() * totalWeight;

  for (const game of eligible) {
    const weight = weights?.[game.id] ?? 100;
    if (randomVal < weight) return game;
    randomVal -= weight;
  }

  return eligible[0] ?? PARTY_MINIGAMES[0];
}

export function selectTagMapId(playerCount: number): number {
  return playerCount <= 2 ? getRandomTag2MapId() : getRandomTag4MapId();
}

export function rollTargetAccuracy(): number {
  const val = 75 + Math.random() * 25;
  return Math.round(val * 100) / 100;
}

export function getBanchoSetupCommands(minigame: MinigameDefinition, overrideMods?: string): string[] {
  const commands: string[] = [];
  commands.push(`!mp set ${minigame.teamMode} ${minigame.scoreMode}`);
  const modsToUse = overrideMods !== undefined ? overrideMods : minigame.forcedMods;
  if (modsToUse) {
    commands.push(`!mp mods ${modsToUse}`);
  } else {
    commands.push(`!mp mods freemod`);
  }
  return commands;
}
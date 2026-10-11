import type { PrismaClient } from "@prisma/client";
import type { MinigameDefinition } from "./party-minigames.js";

export interface RawPlayerScore {
  playerId: number;
  username: string;
  score: number;
  accuracy: number;
  combo: number;
  misses: number;
  passed: boolean;
  team?: "Red" | "Blue" | "None";
  wagerAmount?: number;
}

export interface EvaluatedScoreResult {
  playerId: number;
  username: string;
  placement: number;
  pointsEarned: number;
  previousPoints: number;
  newPoints: number;
  details?: string;
}

export interface MatchScoringContext {
  minigame?: MinigameDefinition;
  targetAccuracy?: number;
  leaderPlayerId?: number;
}

export function evaluateRoundScores(
  scores: RawPlayerScore[],
  context: MatchScoringContext = {}
): EvaluatedScoreResult[] {
  if (scores.length === 0) return [];

  const metric = context.minigame?.scoringMetric ?? "score";
  const sorted = [...scores];

  switch (metric) {
    case "accuracy":
      sorted.sort((a, b) => b.accuracy - a.accuracy || b.score - a.score);
      break;

    case "target_accuracy": {
      const target = context.targetAccuracy ?? 95.0;
      sorted.sort((a, b) => {
        const aUnder = a.accuracy <= target;
        const bUnder = b.accuracy <= target;
        if (aUnder && !bUnder) return -1;
        if (!aUnder && bUnder) return 1;
        const diffA = Math.abs(target - a.accuracy);
        const diffB = Math.abs(target - b.accuracy);
        return diffA - diffB || b.score - a.score;
      });
      break;
    }

    case "misses":
      sorted.sort((a, b) => {
        if (a.passed && !b.passed) return -1;
        if (!a.passed && b.passed) return 1;
        const missA = typeof a.misses === "number" && !isNaN(a.misses) ? a.misses : 0;
        const missB = typeof b.misses === "number" && !isNaN(b.misses) ? b.misses : 0;
        return missA - missB || b.score - a.score;
      });
      break;

    case "combo":
      sorted.sort((a, b) => b.combo - a.combo || b.score - a.score);
      break;

    case "elimination":
      sorted.sort((a, b) => {
        if (a.passed && !b.passed) return -1;
        if (!a.passed && b.passed) return 1;
        return b.score - a.score;
      });
      break;

    case "tag_accuracy_misses":
      sorted.sort((a, b) => {
        if (a.passed && !b.passed) return -1;
        if (!a.passed && b.passed) return 1;
        const missA = typeof a.misses === "number" && !isNaN(a.misses) ? a.misses : 0;
        const missB = typeof b.misses === "number" && !isNaN(b.misses) ? b.misses : 0;
        return missA - missB || b.accuracy - a.accuracy || b.score - a.score;
      });
      break;

    case "team_score":
    case "team_accuracy":
    case "juggernaut":
    case "score":
    case "bounty":
    default:
      sorted.sort((a, b) => b.score - a.score);
      break;
  }

  const n = sorted.length;
  return sorted.map((player, index) => {
    const placement = index + 1;
    let points = Math.max(1, n - index);

    // Bounty Hunter bonus: knocking out the leader awards +3 extra points
    if (metric === "bounty" && context.leaderPlayerId && player.playerId !== context.leaderPlayerId) {
      const leaderIndex = sorted.findIndex(s => s.playerId === context.leaderPlayerId);
      if (leaderIndex !== -1 && index < leaderIndex) {
        points += 3;
      }
    }

    // Sudden death fail penalty: failing gives 0 placement points
    if (metric === "elimination" && !player.passed) {
      points = 0;
    }

    // Wager minigame handling
    if (metric === "wager" && player.wagerAmount && player.wagerAmount > 0) {
      const wagerCutoff = n <= 4 ? 1 : n <= 8 ? 2 : n <= 12 ? 3 : 4;
      const wagerWon = placement <= wagerCutoff;
      const wagerNet = wagerWon ? player.wagerAmount : -player.wagerAmount;
      points = Math.max(0, points + wagerNet);
    }

    return {
      playerId: player.playerId,
      username: player.username,
      placement,
      pointsEarned: points,
      previousPoints: 0,
      newPoints: points,
    };
  });
}

/**
 * Persists match results and PartyPoints increments to the database.
 */
export async function persistMatchPoints(
  db: PrismaClient,
  params: {
    lobbyId: number;
    beatmapId?: number;
    minigameId: string;
    gameMode: string;
    results: EvaluatedScoreResult[];
    rawScores?: RawPlayerScore[];
  }
) {
  const { lobbyId, beatmapId, minigameId, gameMode, results } = params;
  const rawScoreMap = new Map((params.rawScores ?? []).map((s) => [s.playerId, s]));

  for (const res of results) {
    const player = await db.player.findUnique({ where: { id: res.playerId } });
    const currentAllTime = player?.allTimePoints ?? 0;
    const isWinner = res.placement === 1;
    const currentStreak = isWinner ? (player?.streak ?? 0) + 1 : 0;
    const longestStreak = Math.max(player?.longestStreak ?? 0, currentStreak);

    res.previousPoints = currentAllTime;
    res.newPoints = currentAllTime + res.pointsEarned;

    await db.player.upsert({
      where: { id: res.playerId },
      create: {
        id: res.playerId,
        username: res.username,
        allTimePoints: res.pointsEarned,
        matches: 1,
        wins: isWinner ? 1 : 0,
        streak: currentStreak,
        longestStreak,
      },
      update: {
        username: res.username,
        allTimePoints: { increment: res.pointsEarned },
        matches: { increment: 1 },
        wins: { increment: isWinner ? 1 : 0 },
        streak: currentStreak,
        longestStreak,
      },
    });

    await db.lobbyPlayer.upsert({
      where: {
        lobbyId_playerId: {
          lobbyId,
          playerId: res.playerId,
        },
      },
      create: {
        lobbyId,
        playerId: res.playerId,
        sessionPoints: res.pointsEarned,
      },
      update: {
        sessionPoints: { increment: res.pointsEarned },
      },
    });

    const modeStat = await db.playerModeStats.findUnique({
      where: {
        playerId_mode: {
          playerId: res.playerId,
          mode: gameMode,
        },
      },
    });
    const currentModeStreak = isWinner ? (modeStat?.streak ?? 0) + 1 : 0;
    const longestModeStreak = Math.max(modeStat?.longestStreak ?? 0, currentModeStreak);

    await db.playerModeStats.upsert({
      where: {
        playerId_mode: {
          playerId: res.playerId,
          mode: gameMode,
        },
      },
      create: {
        playerId: res.playerId,
        mode: gameMode,
        points: res.pointsEarned,
        matches: 1,
        wins: isWinner ? 1 : 0,
        streak: currentModeStreak,
        longestStreak: longestModeStreak,
      },
      update: {
        points: { increment: res.pointsEarned },
        matches: { increment: 1 },
        wins: { increment: isWinner ? 1 : 0 },
        streak: currentModeStreak,
        longestStreak: longestModeStreak,
      },
    });
  }

  await db.match.create({
    data: {
      lobbyId,
      beatmapId: beatmapId ?? null,
      gameMode,
      minigameId,
      endedAt: new Date(),
      scores: {
        create: results.map((r) => {
          const raw = rawScoreMap.get(r.playerId);
          return {
            playerId: r.playerId,
            score: raw?.score ?? 0,
            placement: r.placement,
            pointsEarned: r.pointsEarned,
            accuracy: raw?.accuracy ?? null,
            misses: raw?.misses ?? null,
            team: raw?.team ?? null,
            winner: r.placement === 1,
          };
        }),
      },
    },
  });
}

export interface VictoryAnnouncementContext {
  metric: string;
  winner: EvaluatedScoreResult;
  winnerRaw?: RawPlayerScore;
  targetAccuracy?: number;
  leaderPlayerId?: number;
  leaderUsername?: string;
  winningTeam?: "Red" | "Blue" | string;
}

export function formatVictoryAnnouncement(options: VictoryAnnouncementContext): string {
  const { metric, winner, winnerRaw, targetAccuracy, leaderPlayerId, leaderUsername, winningTeam } = options;
  const pts = winner.pointsEarned;
  const name = winner.username;
  const score = winnerRaw?.score ?? 0;

  switch (metric) {
    case "target_accuracy": {
      const target = targetAccuracy ?? 95.0;
      const acc = winnerRaw?.accuracy ?? 0;
      return `[Results] ${name} had the closest accuracy to ${target}% with ${acc}%! (+${pts} PartyPoints)`;
    }
    case "misses": {
      const misses = winnerRaw?.misses ?? 0;
      return `[Results] ${name} survived with the lowest miss count of ${misses} misses! (+${pts} PartyPoints)`;
    }
    case "accuracy": {
      const acc = winnerRaw?.accuracy ?? 0;
      return `[Results] ${name} achieved the highest accuracy with ${acc}%! (+${pts} PartyPoints)`;
    }
    case "combo": {
      const combo = winnerRaw?.combo ?? 0;
      return `[Results] ${name} secured the longest streak with a ${combo}x combo! (+${pts} PartyPoints)`;
    }
    case "elimination": {
      return `[Results] ${name} was the last survivor standing! (+${pts} PartyPoints)`;
    }
    case "bounty": {
      const isLeader = leaderPlayerId !== undefined && winner.playerId === leaderPlayerId;
      if (isLeader) {
        return `[Results] ${name} defended their bounty with ${score} points! (+${pts} PartyPoints)`;
      } else {
        const targetName = leaderUsername ?? "the leader";
        return `[Results] ${name} claimed the bounty on ${targetName} with ${score} points! (+${pts} PartyPoints)`;
      }
    }
    case "team_score":
    case "team_accuracy": {
      const team = winningTeam ?? winnerRaw?.team ?? "Red";
      return `[Results] Team ${team} took the victory! (+${pts} PartyPoints to team members)`;
    }
    default: {
      return `[Results] ${name} finished in 1st place with ${score} points! (+${pts} PartyPoints)`;
    }
  }
}
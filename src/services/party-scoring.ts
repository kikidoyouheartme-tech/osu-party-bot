import { PrismaClient } from "@prisma/client";

export interface RawPlayerScore {
  playerId: number;
  username: string;
  score: number;
  accuracy?: number;
  misses?: number;
  passed?: boolean;
  wagerAmount?: number;
}

export interface ProcessedScoreResult {
  playerId: number;
  username: string;
  score: number;
  placement: number;
  pointsEarned: number;
  accuracy?: number;
  misses?: number;
  winner: boolean;
  wagerWon: boolean;
  wagerNet: number;
}

/**
 * Calculates standard FFA points using the (N - rank) formula.
 * In an 8-player room: Rank 1 gets 7 pts, Rank 2 gets 6 pts, ..., Last gets 0 pts.
 */
export function calculateRankPoints(totalPlayers: number, placement: number): number {
  if (totalPlayers <= 1) return 1;
  return Math.max(0, totalPlayers - placement);
}

/**
 * Determines placement cutoff for winning wagers based on player count.
 */
export function getWagerThreshold(playerCount: number): number {
  if (playerCount <= 4) return 1;
  if (playerCount <= 8) return 2;
  if (playerCount <= 12) return 3;
  return 4;
}

/**
 * Evaluates match results, sorts placements, and computes point rewards.
 */
export function evaluateRoundScores(
  rawScores: RawPlayerScore[],
  pointMultiplier = 1.0
): ProcessedScoreResult[] {
  // Sort descending by score; ties broken by higher accuracy
  const sorted = [...rawScores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.accuracy ?? 0) - (a.accuracy ?? 0);
  });

  const totalPlayers = sorted.length;
  const wagerCutoff = getWagerThreshold(totalPlayers);

  return sorted.map((player, index) => {
    const placement = index + 1;
    const basePoints = calculateRankPoints(totalPlayers, placement);
    const scaledPoints = Math.round(basePoints * pointMultiplier);

    const wager = player.wagerAmount ?? 0;
    const wagerWon = wager > 0 && placement <= wagerCutoff;
    const wagerNet = wager > 0 ? (wagerWon ? wager : -wager) : 0;

    const totalPointsEarned = Math.max(0, scaledPoints + wagerNet);

    return {
      playerId: player.playerId,
      username: player.username,
      score: player.score,
      placement,
      pointsEarned: totalPointsEarned,
      accuracy: player.accuracy,
      misses: player.misses,
      winner: placement === 1,
      wagerWon,
      wagerNet,
    };
  });
}

/**
 * Commits the match results and point rewards to SQLite via a single Prisma transaction.
 */
export async function persistMatchPoints(
  db: PrismaClient,
  params: {
    lobbyId: number;
    beatmapId?: number;
    minigameId: string;
    gameMode?: string;
    results: ProcessedScoreResult[];
  }
) {
  const { lobbyId, beatmapId, minigameId, gameMode = "osu", results } = params;

  return await db.$transaction(async (tx) => {
    // 1. Create the Match row
    const match = await tx.match.create({
      data: {
        lobbyId,
        beatmapId: beatmapId ?? null,
        minigameId,
        gameMode,
        teamEvent: false,
        endedAt: new Date(),
      },
    });

    for (const r of results) {
      // 2. Ensure Player exists and update career stats
      const existingPlayer = await tx.player.findUnique({
        where: { id: r.playerId },
      });

      const currentStreak = r.winner ? (existingPlayer?.streak ?? 0) + 1 : 0;
      const longestStreak = Math.max(
        existingPlayer?.longestStreak ?? 0,
        currentStreak
      );

      await tx.player.upsert({
        where: { id: r.playerId },
        create: {
          id: r.playerId,
          username: r.username,
          allTimePoints: r.pointsEarned,
          matches: 1,
          wins: r.winner ? 1 : 0,
          streak: currentStreak,
          longestStreak,
        },
        update: {
          username: r.username,
          allTimePoints: { increment: r.pointsEarned },
          matches: { increment: 1 },
          wins: { increment: r.winner ? 1 : 0 },
          streak: currentStreak,
          longestStreak,
        },
      });

      // 3. Update LobbyPlayer session points
      await tx.lobbyPlayer.upsert({
        where: {
          lobbyId_playerId: {
            lobbyId,
            playerId: r.playerId,
          },
        },
        create: {
          lobbyId,
          playerId: r.playerId,
          sessionPoints: r.pointsEarned,
        },
        update: {
          sessionPoints: { increment: r.pointsEarned },
        },
      });

      // 4. Update mode-specific stats
      await tx.playerModeStats.upsert({
        where: {
          playerId_mode: {
            playerId: r.playerId,
            mode: gameMode,
          },
        },
        create: {
          playerId: r.playerId,
          mode: gameMode,
          points: r.pointsEarned,
          matches: 1,
          wins: r.winner ? 1 : 0,
          streak: currentStreak,
          longestStreak,
        },
        update: {
          points: { increment: r.pointsEarned },
          matches: { increment: 1 },
          wins: { increment: r.winner ? 1 : 0 },
          streak: currentStreak,
          longestStreak,
        },
      });

      // 5. Create Score record linked to the Match
      await tx.score.create({
        data: {
          matchId: match.id,
          playerId: r.playerId,
          score: r.score,
          placement: r.placement,
          pointsEarned: r.pointsEarned,
          accuracy: r.accuracy ?? null,
          misses: r.misses ?? null,
          winner: r.winner,
        },
      });
    }

    return match;
  });
}
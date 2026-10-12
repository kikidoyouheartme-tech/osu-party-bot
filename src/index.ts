import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BanchoGateway } from "./adapters/bancho.js";
import { OsuApi } from "./adapters/osu.js";
import { LobbyController, generateDefaultLobbyTitle } from "./lobby-controller.js";
import { DEFAULT_CONFIG, type LobbyConfig } from "./types.js";
import { PARTY_MINIGAMES } from "./services/party-minigames.js";

const env = z.object({
  DATABASE_URL: z.string(),
  OSU_CLIENT_ID: z.string(),
  OSU_CLIENT_SECRET: z.string(),
  BANCHO_USERNAME: z.string(),
  BANCHO_PASSWORD: z.string(),
  BANCHO_API_KEY: z.string().min(1),
  DASHBOARD_TOKEN: z.string().min(12),
  PORT: z.coerce.number().default(3000),
}).parse(process.env);

const db = new PrismaClient();
const osu = new OsuApi(env.OSU_CLIENT_ID, env.OSU_CLIENT_SECRET);
const bancho = new BanchoGateway(env.BANCHO_USERNAME, env.BANCHO_PASSWORD, env.BANCHO_API_KEY);
const controllers = new Map<number, LobbyController>();
const recreatingLobbies = new Set<number>();

const activeConfig = {
  totalRounds: DEFAULT_CONFIG.totalRounds ?? 10,
  minigameWeights: {} as Record<string, number>,
  ranked: DEFAULT_CONFIG.ranked !== false,
};

const configSchema = z.object({
  eventChance: z.number().min(0).max(1).optional(),
  ranked: z.boolean().optional(),
  autoRecreateOnInactivity: z.boolean().optional(),
  teamMode: z.number().int().min(0).max(3).optional(),
  scoreMode: z.number().int().min(0).max(3).optional(),
  totalRounds: z.number().int().min(1).max(100).optional(),
  minigameWeights: z.record(z.string(), z.number().min(0).max(100)).optional(),
  regulations: z.object({
    enabled: z.boolean().optional(),
    minStar: z.number().min(0).optional(),
    maxStar: z.number().min(0).optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    minBpm: z.number().min(0).optional(),
    maxBpm: z.number().min(0).optional(),
    minAr: z.number().min(0).max(11).optional(),
    maxAr: z.number().min(0).max(11).optional(),
    minHp: z.number().min(0).max(10).optional(),
    maxHp: z.number().min(0).max(10).optional(),
    minOd: z.number().min(0).max(11).optional(),
    maxOd: z.number().min(0).max(11).optional(),
    minCs: z.number().min(0).max(10).optional(),
    maxCs: z.number().min(0).max(10).optional(),
    minLastUpdatedYear: z.number().int().min(2007).max(2100).optional(),
    maxLastUpdatedYear: z.number().int().min(2007).max(2100).optional(),
    gameMode: z.enum(["osu", "taiko", "fruits", "mania"]).optional(),
    allowConvert: z.boolean().optional(),
    freeMod: z.boolean().optional(),
    allowedStatuses: z.array(z.string().min(1)).max(10).optional(),
  }).partial().optional(),
}).partial();

async function createLobby(input: { title?: string; password?: string; config?: Partial<LobbyConfig> }) {
  const rawTitle = input.title?.trim() || input.config?.title?.trim();
  const title = rawTitle || generateDefaultLobbyTitle(input.config);
  const config: LobbyConfig = {
    ...DEFAULT_CONFIG,
    totalRounds: activeConfig.totalRounds,
    minigameWeights: { ...activeConfig.minigameWeights },
    ranked: activeConfig.ranked,
    ...input.config,
    title,
    password: input.password,
    regulations: { ...DEFAULT_CONFIG.regulations, ...input.config?.regulations },
    locks: { ...DEFAULT_CONFIG.locks, ...input.config?.locks },
  };
  const room = await bancho.makeLobby(title, input.password);
  if (config.regulations.freeMod) await room.command("!mp mods 0 freemod");
  const banchoId = room.id();
  if (!banchoId) throw new Error("Could not identify newly-created multiplayer lobby");
  const lobby = await db.lobby.create({
    data: { banchoId, name: title, password: input.password, config: config as any },
  });
  const controller = new LobbyController(db, lobby.id, room, osu, config, env.BANCHO_USERNAME);
  controller.onClosed(() => void recreateClosedLobby(lobby.id, controller));
  await controller.start();
  controllers.set(lobby.id, controller);
  return lobby;
}

async function recreateClosedLobby(lobbyId: number, controller: LobbyController) {
  controllers.delete(lobbyId);
  if (!controller.shouldAutoRecreate() || recreatingLobbies.has(lobbyId)) return;
  recreatingLobbies.add(lobbyId);
  try {
    const replacement = await createLobby(controller.recreationInput());
    console.log(`Recreated inactive lobby ${lobbyId} as lobby ${replacement.id} (mp/${replacement.banchoId}).`);
  } catch (error) {
    console.error(`Could not recreate inactive lobby ${lobbyId}:`, error);
  } finally {
    recreatingLobbies.delete(lobbyId);
  }
}

async function main() {
  await db.$connect();
  await bancho.connect();
  const app = express();
  app.use(express.json());
  app.use(express.static("public"));
  app.use((req, res, next) =>
    req.header("authorization") === `Bearer ${env.DASHBOARD_TOKEN}`
      ? next()
      : res.status(401).json({ error: "dashboard token required" })
  );

  app.get("/health", (_req, res) => res.json({ ok: true, lobbies: controllers.size }));

  app.get(["/api/config", "/config"], (_req, res) => {
    const first = controllers.values().next().value;
    if (first) {
      const c = first.getConfig();
      return res.json({
        totalRounds: c.totalRounds ?? activeConfig.totalRounds,
        minigameWeights: c.minigameWeights ?? activeConfig.minigameWeights,
        ranked: c.ranked ?? activeConfig.ranked,
      });
    }
    return res.json(activeConfig);
  });

  app.post(["/api/config", "/config"], async (req, res, next) => {
    try {
      const body = z.object({
        totalRounds: z.number().int().min(1).max(100).optional(),
        minigameWeights: z.record(z.string(), z.number().min(0).max(100)).optional(),
        ranked: z.boolean().optional(),
      }).parse(req.body);

      if (body.totalRounds !== undefined) activeConfig.totalRounds = body.totalRounds;
      if (body.minigameWeights !== undefined) activeConfig.minigameWeights = body.minigameWeights;
      if (body.ranked !== undefined) activeConfig.ranked = body.ranked;

      for (const controller of controllers.values()) {
        controller.updateConfig(body);
      }

      return res.json({ ok: true, config: activeConfig });
    } catch (e) {
      next(e);
    }
  });

  app.post("/players", async (req, res, next) => {
    try {
      const input = z.object({
        username: z.string().min(1).max(64),
        mode: z.enum(["osu", "taiko", "fruits", "mania"]).default("osu"),
      }).parse(req.body);

      const user = await osu.user(input.username);
      if (!Number.isInteger(user.id) || !user.username) {
        return res.status(404).json({ error: "osu! user not found." });
      }

      const player = await db.player.upsert({
        where: { id: user.id },
        create: { id: user.id, username: user.username },
        update: { username: user.username },
      });

      const stats = await db.playerModeStats.upsert({
        where: { playerId_mode: { playerId: player.id, mode: input.mode } },
        create: { playerId: player.id, mode: input.mode },
        update: {},
      });

      return res.status(201).json({
        id: player.id,
        username: player.username,
        mode: input.mode,
        points: stats.points,
        matches: stats.matches,
        wins: stats.wins,
        streak: stats.streak,
        longestStreak: stats.longestStreak,
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/players", async (req, res, next) => {
    try {
      const query = z.object({
        username: z.string().min(1).max(64),
        mode: z.enum(["osu", "taiko", "fruits", "mania"]).default("osu"),
      }).parse(req.query);

      const player = (
        await db.player.findMany({
          where: { username: { contains: query.username } },
          take: 10,
        })
      ).find((candidate) => candidate.username.toLowerCase() === query.username.toLowerCase());

      if (!player) return res.status(404).json({ error: "No local player record found." });

      const stats = await db.playerModeStats.findUnique({
        where: { playerId_mode: { playerId: player.id, mode: query.mode } },
      });

      const playerScores = await db.score.findMany({
        where: { playerId: player.id },
        include: { match: { select: { minigameId: true } } },
      });
      const first = playerScores.filter((s) => s.placement === 1).length;
      const second = playerScores.filter((s) => s.placement === 2).length;
      const third = playerScores.filter((s) => s.placement === 3).length;

      const minigameCounts = new Map<string, number>();
      for (const s of playerScores) {
        if (s.match.minigameId) {
          minigameCounts.set(s.match.minigameId, (minigameCounts.get(s.match.minigameId) ?? 0) + 1);
        }
      }
      let mostPlayedId = "";
      let maxCount = 0;
      for (const [mgId, count] of minigameCounts) {
        if (count > maxCount) {
          maxCount = count;
          mostPlayedId = mgId;
        }
      }
      const mostPlayedMinigame = mostPlayedId
        ? (PARTY_MINIGAMES.find((m) => m.id === mostPlayedId)?.name ?? mostPlayedId)
        : "None";

      const eligible = { mode: query.mode, matches: { gte: 3 } };
      const rank =
        stats && stats.matches >= 3
          ? (await db.playerModeStats.count({
              where: {
                AND: [
                  eligible,
                  {
                    OR: [
                      { points: { gt: stats.points } },
                      { points: stats.points, playerId: { lt: player.id } },
                    ],
                  },
                ],
              },
            })) + 1
          : undefined;

      const total = rank ? await db.playerModeStats.count({ where: eligible }) : undefined;

      return res.json({
        id: player.id,
        username: player.username,
        mode: query.mode,
        points: stats?.points ?? 0,
        allTimePoints: player.allTimePoints || (stats?.points ?? 0),
        matches: stats?.matches ?? 0,
        wins: stats?.wins ?? 0,
        streak: stats?.streak ?? 0,
        longestStreak: Math.max(player.longestStreak, stats?.longestStreak ?? 0),
        podiums: { first, second, third },
        mostPlayedMinigame,
        rank,
        total,
      });
    } catch (e) {
      next(e);
    }
  });

  app.patch("/players/:id/stats", async (req, res, next) => {
    try {
      const playerId = z.coerce.number().int().positive().parse(req.params.id);
      const body = z.object({
        mode: z.enum(["osu", "taiko", "fruits", "mania"]),
        points: z.number().int().min(0).optional(),
        elo: z.number().int().min(0).optional(),
        matches: z.number().int().min(0),
        wins: z.number().int().min(0),
        streak: z.number().int().min(0),
        longestStreak: z.number().int().min(0),
      }).parse(req.body);

      if (body.wins > body.matches) return res.status(400).json({ error: "Wins cannot exceed matches." });
      if (body.streak > body.longestStreak) return res.status(400).json({ error: "Current streak cannot exceed longest streak." });

      const player = await db.player.findUnique({ where: { id: playerId } });
      if (!player) return res.status(404).json({ error: "No local player record found." });

      const pointVal = body.points ?? body.elo ?? 0;
      const values = {
        points: pointVal,
        matches: body.matches,
        wins: body.wins,
        streak: body.streak,
        longestStreak: body.longestStreak,
      };

      const stats = await db.playerModeStats.upsert({
        where: { playerId_mode: { playerId, mode: body.mode } },
        create: { playerId, mode: body.mode, ...values },
        update: values,
      });

      await db.player.update({
        where: { id: playerId },
        data: {
          allTimePoints: pointVal,
          longestStreak: Math.max(player.longestStreak, body.longestStreak),
          streak: body.streak,
        },
      });

      return res.json({ ok: true, stats });
    } catch (e) {
      next(e);
    }
  });

  app.get("/leaderboard", async (req, res, next) => {
    try {
      const { mode, page } = z.object({
        mode: z.enum(["osu", "taiko", "fruits", "mania"]).default("osu"),
        page: z.coerce.number().int().min(1).default(1),
      }).parse(req.query);

      const where = { mode, matches: { gte: 3 } };
      const perPage = 10;
      const total = await db.playerModeStats.count({ where });
      const pageCount = Math.max(1, Math.ceil(total / perPage));
      const currentPage = Math.min(page, pageCount);

      const players = await db.playerModeStats.findMany({
        where,
        include: { player: { select: { id: true, username: true, allTimePoints: true, streak: true, longestStreak: true } } },
        orderBy: [{ points: "desc" }, { playerId: "asc" }],
        skip: (currentPage - 1) * perPage,
        take: perPage,
      });

      return res.json({
        mode,
        page: currentPage,
        total,
        pageCount,
        players: players.map((entry, index) => {
          const winRate = entry.matches > 0 ? ((entry.wins / entry.matches) * 100).toFixed(1) : "0.0";
          return {
            rank: (currentPage - 1) * perPage + index + 1,
            id: entry.playerId,
            username: entry.player.username,
            points: entry.points,
            allTimePoints: entry.player.allTimePoints || entry.points,
            matches: entry.matches,
            wins: entry.wins,
            streak: entry.streak,
            longestStreak: entry.longestStreak,
            winRate,
          };
        }),
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/lobbies", async (_req, res) => {
    const lobbies = await db.lobby.findMany({
      select: { id: true, banchoId: true, name: true, config: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const result = await Promise.all(
      lobbies.map(async (lobby) => {
        const controller = controllers.get(lobby.id);
        if (controller) {
          const standings = await controller.getStandings();
          return { ...lobby, active: true, standings };
        }
        return { ...lobby, active: false };
      })
    );
    res.json(result);
  });

  app.get("/lobbies/:id/standings", async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const controller = controllers.get(id);
      if (!controller) return res.status(404).json({ error: "This lobby is not active in the current bot session." });
      return res.json(await controller.getStandings());
    } catch (e) {
      next(e);
    }
  });

  app.get("/lobbies/:id/activity", (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const controller = controllers.get(id);
      if (!controller) return res.status(404).json({ error: "This lobby is not active in the current bot session." });
      return res.json({ entries: controller.activity() });
    } catch (e) {
      next(e);
    }
  });

  app.post("/lobbies", async (req, res, next) => {
    try {
      const body = z.object({
        title: z.string().max(80).optional(),
        password: z.string().max(64).optional(),
        config: configSchema.optional(),
      }).parse(req.body);

      res.status(201).json(await createLobby(body as { title?: string; password?: string; config?: Partial<LobbyConfig> }));
    } catch (e) {
      next(e);
    }
  });

  app.patch("/lobbies/:id/regulations", async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const controller = controllers.get(id);
      if (!controller) return res.status(404).json({ error: "This lobby is not active in the current bot session." });
      const body = z.object({
        regulations: configSchema.shape.regulations.unwrap(),
        eventChance: z.number().min(0).max(1).optional(),
        ranked: z.boolean().optional(),
        autoRecreateOnInactivity: z.boolean().optional(),
        title: z.string().max(80).optional(),
        password: z.string().min(1).max(64).optional(),
        removePassword: z.boolean().optional(),
      }).parse(req.body);
      await controller.updateRegulations(body.regulations ?? {}, body.eventChance, body);
      return res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/lobbies/:id", async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const controller = controllers.get(id);
      if (controller) {
        await controller.close();
        controllers.delete(id);
        return res.status(204).send();
      }
      await db.lobby.delete({ where: { id } });
      return res.status(204).send();
    } catch (e) {
      next(e);
    }
  });

  app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(400).json({ error: e instanceof Error ? e.message : "unknown error" })
  );

  app.listen(env.PORT, () => console.log(`Dashboard API listening on :${env.PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
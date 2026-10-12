import { PrismaClient } from "@prisma/client";
import type { RoomActions, RoomActivity } from "./adapters/bancho.js";
import { OsuApiRequestError, type OsuApi } from "./adapters/osu.js";
import { DEFAULT_CONFIG, gameModeLabel, type GameMode, type LobbyConfig, type MapInfo, type Participant } from "./types.js";
import { checkMap, calculateModAdjustedStars } from "./services/party-regulation.js";
import { evaluateRoundScores, persistMatchPoints, formatVictoryAnnouncement, type RawPlayerScore } from "./services/party-scoring.js";
import {
  rollNextMinigame,
  selectTagMapId,
  getBanchoSetupCommands,
  rollTargetAccuracy,
  type MinigameDefinition
} from "./services/party-minigames.js";
import { balancedTeams } from "./services/teams.js";
import { VoteBook } from "./services/votes.js";
import { resolveMinigameMap } from "./services/party-map-pickers.js";
import { LobbyKeeper } from "./plugins/LobbyKeeper.js";
import { MatchStarter } from "./plugins/MatchStarter.js";
import { resetRoundLifecycleState, shouldBypassRegulations } from "./services/lobby-cycle.js";

const admins = new Set((process.env.ADMIN_OSU_IDS ?? "").split(",").filter(Boolean).map(Number));
const fmt = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;
const fmtSession = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
const winRate = (s: { wins: number; matches: number }) => (s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0);
export type LobbyActivity = RoomActivity;
type RandomEvent = { teamMode: 0 | 2; scoreMode: 0 | 1 | 2; label: string };
const RANDOM_EVENTS: RandomEvent[] = [
  { teamMode: 2, scoreMode: 0, label: "Team VS — Score" },
  { teamMode: 2, scoreMode: 2, label: "Team VS — Combo" },
  { teamMode: 2, scoreMode: 1, label: "Team VS — Accuracy" },
  { teamMode: 0, scoreMode: 2, label: "Head-to-Head — Combo" },
  { teamMode: 0, scoreMode: 1, label: "Head-to-Head — Accuracy" }
];

const MOD_NAME_MAP: Record<string, string> = {
  NOFAIL: "NF",
  NF: "NF",
  EASY: "EZ",
  EZ: "EZ",
  HIDDEN: "HD",
  HD: "HD",
  HARDROCK: "HR",
  HR: "HR",
  SUDDENDEATH: "SD",
  SD: "SD",
  DOUBLETIME: "DT",
  DT: "DT",
  RELAX: "RX",
  RX: "RX",
  HALFTIME: "HT",
  HT: "HT",
  NIGHTCORE: "NC",
  NC: "NC",
  FLASHLIGHT: "FL",
  FL: "FL",
  AUTOPLAY: "AT",
  AT: "AT",
  SPUNOUT: "SO",
  SO: "SO",
  AUTOPILOT: "AP",
  AP: "AP",
  PERFECT: "PF",
  PF: "PF",
};

export function canonicalMod(token: string): string {
  const clean = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return MOD_NAME_MAP[clean] || clean;
}

export function normalizeMods(mods: string | string[]): string {
  let text = Array.isArray(mods) ? mods.join(" ") : mods;
  text = text
    .replace(/hard\s*rock/gi, "HR")
    .replace(/double\s*time/gi, "DT")
    .replace(/night\s*core/gi, "NC")
    .replace(/no\s*fail/gi, "NF")
    .replace(/half\s*time/gi, "HT")
    .replace(/sudden\s*death/gi, "SD")
    .replace(/flash\s*light/gi, "FL")
    .replace(/spun\s*out/gi, "SO")
    .replace(/auto\s*pilot/gi, "AP")
    .replace(/auto\s*play/gi, "AT")
    .replace(/easy/gi, "EZ")
    .replace(/hidden/gi, "HD")
    .replace(/relax/gi, "RX")
    .replace(/perfect/gi, "PF");

  const tokens = text.trim().split(/[\s,]+/);
  return tokens
    .map(t => canonicalMod(t))
    .filter(t => t && t !== "NONE")
    .sort()
    .join(" ");
}

export interface LobbyTitleSettings {
  minStars?: number | string | null;
  maxStars?: number | string | null;
  minStar?: number | string | null;
  maxStar?: number | string | null;
  regulations?: {
    enabled?: boolean;
    minStars?: number | string | null;
    maxStars?: number | string | null;
    minStar?: number | string | null;
    maxStar?: number | string | null;
  };
  config?: {
    regulations?: {
      enabled?: boolean;
      minStars?: number | string | null;
      maxStars?: number | string | null;
      minStar?: number | string | null;
      maxStar?: number | string | null;
    };
  };
  enabled?: boolean;
}

export function generateDefaultLobbyTitle(lobbySettings?: LobbyTitleSettings): string {
  const regs = lobbySettings?.regulations ?? lobbySettings?.config?.regulations;
  const disabled =
    (lobbySettings as any)?.enabled === false ||
    regs?.enabled === false;

  const parseStarRating = (val: unknown): number | undefined => {
    if (val === undefined || val === null || val === "") return undefined;
    const n = typeof val === "number" ? val : Number(val);
    return typeof n === "number" && !isNaN(n) ? n : undefined;
  };

  let min: number | undefined;
  let max: number | undefined;

  if (!disabled) {
    min = parseStarRating(
      lobbySettings?.minStars ??
      lobbySettings?.minStar ??
      regs?.minStars ??
      regs?.minStar
    );
    max = parseStarRating(
      lobbySettings?.maxStars ??
      lobbySettings?.maxStar ??
      regs?.maxStars ??
      regs?.maxStar
    );
  }

  const hasMin = typeof min === "number" && (min > 0 || max === undefined);
  const hasMax = typeof max === "number" && max > 0;

  let starPart: string;
  if (hasMin && hasMax && min !== undefined && max !== undefined) {
    starPart = `${min.toFixed(2)}★ - ${max.toFixed(2)}★`;
  } else if (hasMin && min !== undefined) {
    starPart = `${min.toFixed(2)}★+`;
  } else if (hasMax && max !== undefined) {
    starPart = `Up to ${max.toFixed(2)}★`;
  } else {
    starPart = "No Star Limit";
  }

  return `osu!Party | Custom Minigames | AHR | ${starPart}`;
}

export function formatActiveMinigameRuleset(minigame: { name: string; description?: string }): string {
  return `[Minigame] Active Ruleset: ${minigame.name} - ${minigame.description || "Follow current lobby regulations!"}`;
}

export class LobbyController {
  private config: LobbyConfig;
  private queue: number[] = [];
  private autoSkip = new Set<number>();
  private votes = new VoteBook();
  private timer?: NodeJS.Timeout;
  private startedAt?: Date;
  private matchId?: number;
  private activeBeatmapId?: number;
  private matchGameMode?: GameMode;
  private selectedGameMode?: GameMode;
  private matchParticipants: Participant[] = [];
  private teamEvent = false;
  private currentMinigame?: MinigameDefinition;
  private wasHostMapPick: boolean = true;
  private currentRound: number = 1;
  private totalRounds: number = 10;
  private lastValidMapId?: number;
  private lastAnnouncedMapId?: number;
  private passwordSetUntil = 0;
  private currentRoomTitle?: string;
  private currentRoomPassword?: string;
  private turnTimer?: NodeJS.Timeout;
  private turnWarnings: NodeJS.Timeout[] = [];
  private turnHostId?: number;
  private turnMapId?: number;
  private targetAccuracy?: number;
  private leaderPlayerId?: number;
  private readonly wagers = new Map<number, number>();
  private turnStage?: "select" | "start";
  private intendedHostId?: number;
  private readonly activityLog: LobbyActivity[] = [];
  private readonly closeListeners = new Set<() => void>();
  private closeRequested = false;
  private readonly botUsername?: string;
  private automatedBeatmapId?: number;
  private isPreparingRound = false;
  private currentForcedMods?: string;
  private get activeRoomMods(): string {
    return this.lobbyKeeper.getActiveRoomMods();
  }
  private set activeRoomMods(mods: string) {
    this.lobbyKeeper.syncActiveMods(mods, this.lobbyKeeper.isFreemodActive());
  }
  private get activeFreemod(): boolean {
    return this.lobbyKeeper.isFreemodActive();
  }
  private set activeFreemod(freemod: boolean) {
    this.lobbyKeeper.syncActiveMods(this.lobbyKeeper.getActiveRoomMods(), freemod);
  }
  private rerollVotes = new Set<number>();
  private isLaunching = false;
  private readonly lobbyKeeper: LobbyKeeper;
  private readonly matchStarter: MatchStarter;

  constructor(
    private db: PrismaClient,
    private lobbyId: number,
    private room: RoomActions,
    private osu: OsuApi,
    config: LobbyConfig = DEFAULT_CONFIG,
    botUsername?: string
  ) {
    this.botUsername = botUsername ?? room.botUsername?.() ?? process.env.BANCHO_USERNAME;
    this.totalRounds = config.totalRounds ?? 10;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      totalRounds: this.totalRounds,
      minigameWeights: config.minigameWeights ?? {},
      ranked: config.ranked !== false,
      regulations: { ...DEFAULT_CONFIG.regulations, ...config.regulations },
      locks: { ...DEFAULT_CONFIG.locks, ...config.locks }
    };
    if (!this.config.title || !this.config.title.trim()) {
      this.config.title = generateDefaultLobbyTitle(this.config);
    }
    this.lobbyKeeper = new LobbyKeeper({
      room: this.room,
      getConfig: () => this.config,
      getCurrentMinigame: () => this.currentMinigame,
      getCurrentForcedMods: () => this.currentForcedMods,
      logActivity: (level, msg) => this.logActivity(level, msg),
    });
    this.matchStarter = new MatchStarter({
      room: this.room,
      isMatchActive: () => Boolean(this.matchId),
      onClearTimers: () => {
        this.clearTurnTimer();
        this.stopTimer();
      },
      getTargetTitle: () => this.config.title,
      getCurrentMinigame: () => this.currentMinigame,
      preStartEnforcement: async () => {
        await this.preStartEnforcement();
      },
      onAutoStart: async (mapId) => {
        await this.launch(mapId, true);
      },
      logActivity: (level, msg) => this.logActivity(level, msg),
    });
  }

  activity() { return this.activityLog.slice(-200); }
  onClosed(listener: () => void) { this.closeListeners.add(listener); }
  shouldAutoRecreate() { return this.config.autoRecreateOnInactivity && !this.closeRequested; }
  recreationInput() { return { title: this.config.title, password: this.config.password, config: this.config }; }
  updateConfig(newConfig: Partial<LobbyConfig>) {
    if (newConfig.totalRounds !== undefined) {
      this.totalRounds = newConfig.totalRounds;
      this.config.totalRounds = newConfig.totalRounds;
    }
    if (newConfig.minigameWeights !== undefined) {
      this.config.minigameWeights = newConfig.minigameWeights;
    }
    if (newConfig.ranked !== undefined) {
      this.config.ranked = newConfig.ranked;
    }
    void this.persist();
  }
  getConfig(): LobbyConfig {
    return {
      ...this.config,
      totalRounds: this.totalRounds,
    };
  }
  private logActivity(level: LobbyActivity["level"], message: string) {
    this.activityLog.push({ at: new Date().toISOString(), level, message });
    if (this.activityLog.length > 200) this.activityLog.shift();
  }
  private runActivity(label: string, task: () => Promise<unknown>) {
    this.logActivity("info", label);
    void task().catch(error => this.logActivity("error", `${label} failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  async start() {
    this.lobbyKeeper.bindListeners();
    this.matchStarter.bindListeners();
    this.room.onActivity(activity => this.logActivity(activity.level, activity.message));
    this.room.onMessage((p, t) => this.runActivity(`Chat from ${p.username}`, () => this.handle(p, t)));
    this.room.onPlayerJoined(player => this.runActivity(`Player joined: ${player.username}`, () => this.playerJoined(player)));
    this.room.onPlayerLeft(player => this.runActivity(`Player left: ${player.username}`, () => this.departed(player)));
    this.room.onBeatmapChanged(id => this.runActivity(`Beatmap changed: ${id}`, () => this.validateSelection(id)));
    this.currentRoomTitle = this.room.name?.() ?? this.config.title;
    this.currentRoomPassword = this.room.password?.() ?? this.config.password;
    this.room.onHostChanged(host => this.runActivity(`Host changed: ${host?.username ?? "none"}`, () => this.hostChanged(host)));
    this.room.onMatchStarted(() => this.runActivity("Match started", () => this.beginMatch()));
    this.room.onMatchFinished(s => this.runActivity(`Match finished: ${s.length} result(s)`, () => this.finish(s)));
    this.room.onClosed(() => {
      this.logActivity("info", "Bancho closed this lobby channel.");
      void this.removeEmptyHistory();
      for (const listener of this.closeListeners) listener();
    });
    await this.joined();
    this.runActivity("Initial host check", () => this.hostChanged(this.room.host()));
    if (this.room.beatmapId()) await this.validateSelection(this.room.beatmapId()!);
  }

  private async joined() { await this.syncPlayers(); await this.electHost(); }

  private async playerJoined(player: Participant) {
    await this.syncPlayers();
    await this.validateRoomMetadata();
    const existingSession = await this.db.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId: this.lobbyId, playerId: player.id } }
    });
    const isNewParticipant = !existingSession;
    const sessionPoints = existingSession?.sessionPoints ?? 0;

    await this.db.lobbyPlayer.upsert({
      where: { lobbyId_playerId: { lobbyId: this.lobbyId, playerId: player.id } },
      create: { lobbyId: this.lobbyId, playerId: player.id, sessionPoints: 0 },
      update: { sessionStart: new Date() }
    });

    const isInitializingHost = (this.currentRound === 1 && this.queue.length <= 1) || this.room.players().length <= 1 || this.room.host()?.id === player.id;
    if (!isInitializingHost) {
      if (!isNewParticipant && sessionPoints > 0) {
        await this.room.say(`[Lobby] Welcome back, ${player.username}! Current game: Round ${this.currentRound}/${this.totalRounds}. Restored ${sessionPoints} session points. You will enter the host queue on the next map.`);
      } else {
        await this.room.say(`[Lobby] Welcome, ${player.username}! Current game: Round ${this.currentRound}/${this.totalRounds}. You start with 0 session points and will enter the host queue on the next map.`);
      }
    }

    const currentMinigame = this.currentMinigame;
    const isMatchInProgressOrQueued = Boolean(this.matchId || currentMinigame);
    if (currentMinigame && isMatchInProgressOrQueued) {
      const announcement = formatActiveMinigameRuleset(currentMinigame);
      if (typeof (this.room as any).message === "function") {
        await (this.room as any).message(announcement);
      } else {
        await this.room.say(announcement);
      }
    }

    const targetMods = this.currentForcedMods ?? this.currentMinigame?.forcedMods ?? "";
    const targetNormalized = this.normalizeMods(targetMods);

    if (targetMods) {
      if (this.activeRoomMods !== targetNormalized || this.activeFreemod) {
        this.activeRoomMods = targetNormalized;
        this.activeFreemod = false;
        await this.room.command(`!mp mods ${targetMods}`);
      }
    } else if (this.currentMinigame) {
      if (!this.activeFreemod) {
        this.activeRoomMods = "";
        this.activeFreemod = true;
        await this.room.command("!mp mods freemod");
      }
    }

    if (this.currentMinigame && this.currentMinigame.teamMode === 2) {
      const redCount = this.room.players().filter(p => p.team === "Red").length;
      const blueCount = this.room.players().filter(p => p.team === "Blue").length;
      const targetTeam = redCount <= blueCount ? "Red" : "Blue";
      await this.room.command(`!mp team ${player.username} ${targetTeam}`);
    }

    await this.electHost();
  }

  private async departed(player: Participant) {
    await this.validateRoomMetadata();
    const wasQueued = this.queue.includes(player.id);
    this.queue = this.queue.filter(id => id !== player.id);
    this.autoSkip.delete(player.id);
    this.wagers.delete(player.id);
    this.rerollVotes.delete(player.id);
    const session = await this.db.lobbyPlayer.findUnique({ where: { lobbyId_playerId: { lobbyId: this.lobbyId, playerId: player.id } } });
    if (session) {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.sessionStart.getTime()) / 1000));
      await this.db.player.update({ where: { id: player.id }, data: { playSeconds: { increment: elapsedSeconds } } });
      // Retain LobbyPlayer to preserve sessionPoints across disconnect/reconnect within active cycle
    }
    if (wasQueued) await this.room.say(`${player.username} left and was removed from the queue.`);
    setTimeout(() => this.runActivity("Post-leave host reconciliation", async () => { await this.disableSoloAutoSkip(); await this.electHost(); }), 250);
  }

  private async syncPlayers() {
    const players = this.room.players();
    for (const p of players) {
      const existing = await this.db.player.findUnique({ where: { id: p.id } });
      let username = existing?.username ?? p.username;
      if (!existing || existing.username === p.username && p.username.includes("_")) {
        try {
          const user = await this.osu.userById(p.id);
          if (typeof user.username === "string" && user.username) username = user.username;
        } catch { /* Retain current name if API is temporarily unavailable */ }
      }
      const saved = await this.db.player.upsert({ where: { id: p.id }, create: { id: p.id, username }, update: username === existing?.username ? {} : { username } });
      if (!saved.denied && !this.queue.includes(p.id)) this.queue.push(p.id);
      await this.db.lobbyPlayer.upsert({ where: { lobbyId_playerId: { lobbyId: this.lobbyId, playerId: p.id } }, create: { lobbyId: this.lobbyId, playerId: p.id, sessionPoints: 0 }, update: {} });
    }
  }

  private isHost(p: Participant) { return this.room.host()?.id === p.id; }

  private async electHost(attempt = 0) {
    if (this.currentMinigame && this.currentMinigame.mapPicker !== "host") {
      if (this.botUsername && this.room.host()?.username !== this.botUsername) {
        await this.room.command(`!mp host ${this.botUsername}`);
      }
      return;
    }
    const activePlayerIds = new Set(this.room.players().map(player => player.id));
    this.queue = this.queue.filter(id => activePlayerIds.has(id));
    if (this.room.host() || !this.queue[0]) return;
    const next = this.queue[0];
    this.intendedHostId = next;
    try {
      await this.room.command(`!mp host #${next}`);
    } catch (error) {
      this.intendedHostId = undefined;
      if (attempt >= 3) throw error;
      setTimeout(() => this.runActivity(`Host assignment retry ${attempt + 1}`, () => this.electHost(attempt + 1)), 750 * (attempt + 1));
    }
  }

  private async hostChanged(host?: Participant) {
    if (this.matchId) return;
    await this.validateRoomMetadata();
    if (this.currentMinigame && this.currentMinigame.mapPicker !== "host") {
      if (this.botUsername && host?.username !== this.botUsername) {
        await this.room.command(`!mp host ${this.botUsername}`);
      }
      return;
    }
    if (!host) {
      this.turnHostId = undefined;
      this.intendedHostId = undefined;
      this.clearTurnTimer();
      setTimeout(() => this.runActivity("Host-cleared reconciliation", () => this.electHost()), 250);
      return;
    }
    const expectedHostId = this.queue[0];
    if (expectedHostId && host.id !== expectedHostId) {
      if (this.intendedHostId === expectedHostId) return;
      const expectedHost = this.room.players().find(player => player.id === expectedHostId);
      if (!expectedHost) {
        this.queue = this.queue.filter(id => id !== expectedHostId);
        this.intendedHostId = undefined;
        return void this.electHost();
      }
      this.turnHostId = undefined;
      this.clearTurnTimer();
      this.intendedHostId = expectedHostId;
      await this.room.say(`Host rotation is queue-controlled. Passing host to ${expectedHost.username}; use !skip to rotate turns.`);
      await this.room.command(`!mp host #${expectedHostId}`);
      setTimeout(() => this.runActivity("Manual-host correction check", () => this.hostChanged(this.room.host())), 500);
      return;
    }
    this.intendedHostId = undefined;
    if (host.id === this.turnHostId) return;
    this.turnHostId = host.id;
    if (this.autoSkip.has(host.id)) {
      if (this.room.players().length <= 1) {
        this.autoSkip.delete(host.id);
        void this.room.say(`${host.username}: auto-skip disabled because this is now a one-player lobby.`);
        this.startTurnTimer("select", host);
        return;
      }
      this.runActivity("Auto-skip host turn", async () => {
        await this.room.say(`${host.username}'s host turn was automatically skipped.`);
        await this.passTurnToNextHost();
      });
      return;
    }
    if (!this.currentMinigame && !this.isPreparingRound) {
      await this.showQueue();
      await this.prepareNextMinigame();
    } else if (this.currentMinigame?.mapPicker === "host") {
      this.startTurnTimer("select", host);
    }
  }

  private clearTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    for (const warning of this.turnWarnings) clearTimeout(warning);
    this.turnTimer = undefined;
    this.turnWarnings = [];
    this.turnMapId = undefined;
    this.turnStage = undefined;
  }

  private startTurnTimer(stage: "select" | "start", host: Participant, mapId?: number) {
    this.clearTurnTimer();
    this.turnHostId = host.id;
    this.turnMapId = mapId;
    this.turnStage = stage;
    const action = stage === "select" ? "select a map" : "start the match";
    for (const [delay, remaining] of [[60_000, "2 minutes"], [120_000, "1 minute"], [150_000, "30 seconds"], [170_000, "10 seconds"]] as const) {
      this.turnWarnings.push(
        setTimeout(() => this.runActivity(`Turn warning: ${remaining}`, () => this.room.say(`${host.username}: ${remaining} left to ${action}.`)), delay)
      );
    }
    this.turnTimer = setTimeout(() => this.runActivity("Turn timer expired", () => this.turnExpired(stage, host, mapId)), 180_000);
  }

  private async passTurnToNextHost() {
    this.clearTurnTimer();
    this.turnHostId = undefined;
    this.turnMapId = undefined;
    this.turnStage = undefined;

    if (this.queue.length) {
      this.queue.push(this.queue.shift()!);
    }

    await this.showQueue();

    const nextHostId = this.queue[0];
    const players = this.room.players();
    const nextHost = (nextHostId ? players.find(p => p.id === nextHostId) : undefined) ?? this.room.host();
    const nextHostUsername = nextHost?.username ?? "Host";

    if (nextHostId) {
      this.intendedHostId = nextHostId;
      await this.room.command(`!mp host #${nextHostId}`);
      await this.validateRoomMetadata();
    }

    await this.room.say(`[Host] ${nextHostUsername}, select a map! (3 min limit)`);
    if (nextHost) {
      this.startTurnTimer("select", nextHost);
    }
  }

  private async turnExpired(stage: "select" | "start", host: Participant, mapId?: number) {
    if (this.room.host()?.id !== host.id || this.matchId) return;
    this.clearTurnTimer();
    if (this.room.players().length <= 1) {
      await this.room.say(`${host.username}: 3 minutes elapsed. Select a map and start when ready.`);
      this.startTurnTimer(stage, host, mapId);
      return;
    }
    if (stage === "select") {
      await this.room.say(`${host.username} ran out of time to select a map. Host passed.`);
      await this.passTurnToNextHost();
    } else {
      await this.room.say(`${host.username} ran out of time to start. Host passed.`);
      await this.passTurnToNextHost();
    }
  }

  private async allPlayersReady() {
    await this.matchStarter.triggerAutoStart();
  }

  private mapSelected(mapId: number) {
    const host = this.room.host();
    if (!host || this.matchId || (this.turnStage === "start" && this.turnHostId === host.id && this.turnMapId === mapId)) return;
    this.startTurnTimer("start", host, mapId);
  }

  private async handle(p: Participant, raw: string) {
    if (!raw.startsWith("!") && !raw.startsWith("*")) return;
    this.logActivity("info", `Command from ${p.username}: ${raw}`);
    await this.syncPlayers();
    const [rawCommand, ...args] = raw.trim().split(/\s+/);
    const cmd = rawCommand.toLowerCase();
    const value = args.join(" ");
    if (cmd.startsWith("*") && !admins.has(p.id)) return void this.room.say(`${p.username}: administrator permission required.`);
    if (cmd === "!queue") return void this.showQueue();
    if (["!cmds", "!commands", "!help"].includes(cmd)) return void this.room.say("[Commands] !cmds | !minigame | !round | !points | !pstats | !leaderboard | !bet <amount> | !reroll");
    if (["!minigame", "!game", "!rules"].includes(cmd)) return void this.showMinigameInfo();
    if (["!round", "!cycle"].includes(cmd)) return void this.showRoundInfo();
    if (["!points", "!pts"].includes(cmd)) return void this.showPoints(p);
    if (["!leaderboard", "!standings"].includes(cmd)) return void this.showStandings();
    if (["!reroll", "!vr", "!votereroll"].includes(cmd)) return void this.voteReroll(p);
    if (cmd === "!bug") return void this.room.say("Report a bug: https://github.com/kikidoyouheartme-tech/osu-party-bot/issues");
    if (cmd === "!donate") return void this.room.say("Support the bot: https://ko-fi.com/ronaldonater");
    if (["!regulations"].includes(cmd)) return void this.showRegulations();
    if (["!version", "!v"].includes(cmd)) return void this.room.say("osu-ahr-bot v0.1.22");
    if (["!playtime", "!pt"].includes(cmd)) return void this.playtime(p, value || undefined);
    if (["!timeleft", "!tl"].includes(cmd)) return void this.timeleft();
    if (["!pstats", "!stats"].includes(cmd)) { const { username, mode } = this.usernameAndMode(args); return void this.stats(p, username, mode); }
    if (["!top", "!t"].includes(cmd)) return void this.top(args);
    if (["!how", "!h"].includes(cmd)) return void this.room.say("Ranked Party matches award PartyPoints using the (N - rank) formula. Highest score earns the most points. Unranked matches award no PartyPoints.");
    if (cmd === "!rank") { const { username, mode } = this.usernameAndMode(args); return void this.rank(p, username, mode); }
    if (["!lastscore", "!ls"].includes(cmd)) return void this.lastScore();
    if (["!bestscore", "!bs"].includes(cmd)) return void this.bestScore(p, value || undefined);
    if (["!bet", "!wager"].includes(cmd)) return void this.bet(p, args[0]);
    if (cmd === "!autoskip") return void this.setAutoSkip(p, args[0]);
    if (cmd === "!update") return void (this.isHost(p) ? this.updateMap() : this.room.say(`${p.username}: only the current host can use !update.`));
    if (cmd === "!votekick") return void this.voteKick(p, value);
    if (cmd === "!mp" && args[0]) {
      const sub = args[0].toLowerCase();
      if (sub === "name") {
        this.currentRoomTitle = args.slice(1).join(" ");
        return void this.enforceTitle(this.currentRoomTitle);
      }
      if (sub === "password") {
        this.currentRoomPassword = args.slice(1).join(" ") || undefined;
        return void this.enforcePassword();
      }
      if (sub === "set" && this.currentMinigame) {
        const team = Number(args[1]);
        const score = Number(args[2]);
        if (team !== this.currentMinigame.teamMode || score !== this.currentMinigame.scoreMode) {
          return void this.enforceMatchSettings(team, score);
        }
      }
      if (["mods", "freemod"].includes(sub)) {
        const hasFreemod = sub === "freemod" || args.slice(1).some(a => a.toLowerCase() === "freemod");
        const specifiedMods = sub === "freemod" ? [] : args.slice(1).filter(a => a.toLowerCase() !== "freemod");
        return void this.enforceForcedMods(specifiedMods, hasFreemod);
      }
    }
    if (cmd === "*reroll") return void (admins.has(p.id) ? this.triggerReroll() : this.room.say(`${p.username}: administrator permission required.`));
    const force = (args[0] === "force" && admins.has(p.id)) || cmd === "*skip";
    if (cmd === "!skip") return void (this.isHost(p) || admins.has(p.id) ? this.skip(force, true) : this.vote("skip", p));
    if (cmd === "!start") return void (this.isHost(p) ? this.startMatch(Number(args[0] ?? 5)) : this.vote("start", p));
    if (cmd === "!abort") return void (this.isHost(p) ? this.abortMatch() : this.vote("abort", p));
    if (cmd === "!stop" && this.isHost(p)) return void this.stopTimer();
    if (cmd === "*start") return void this.startMatch(0);
    if (cmd === "*skip") return void this.skip(true, true);
    if (cmd === "*abort") return void this.abortMatch();
    if (cmd === "*order") return void this.order(value);
    if (cmd === "*resetelo" || cmd === "*resetpoints") return void this.resetPoints(args[0]);
    if (cmd === "*close") return void this.close();
    if (cmd === "*ranked") return void this.setRanked(args[0]);
    if (cmd === "*kick") return void this.kick(value);
    if (cmd === "*keep") return void this.keep(args);
    if (cmd === "*no" && args[0] === "keep") return void this.noKeep(args[1]);
    if (cmd === "*regulation" || cmd === "*no" && args[0] === "regulation") return void this.regulation(cmd === "*no" ? ["disable"] : args);
    if (cmd === "*denylist") return void this.denylist(args);
  }

  private async vote(kind: string, p: Participant) {
    const r = this.votes.cast(kind, p.id, this.room.players());
    await this.room.say(`${kind}: ${r.count}/${r.required}`);
    if (r.passed) {
      this.votes.clear();
      if (kind === "skip") await this.skip(false, true);
      if (kind === "start") await this.startMatch(5);
      if (kind === "abort") await this.abortMatch();
    }
  }

  private async voteKick(voter: Participant, username: string) {
    if (!username) return void this.room.say("Usage: !votekick [username].");
    const target = this.room.players().find(player => player.username.toLowerCase() === username.toLowerCase());
    if (!target) return void this.room.say(`${username}: not currently in this lobby.`);
    if (target.id === voter.id) return void this.room.say("You cannot vote to kick yourself.");
    const eligibleVoters = this.room.players().filter(player => player.id !== target.id);
    const vote = this.votes.cast(`kick:${target.id}`, voter.id, eligibleVoters);
    await this.room.say(`Votekick for ${target.username}: ${vote.count}/${vote.required}.`);
    if (!vote.passed) return;
    this.votes.clear();
    await this.room.command(`!mp kick ${target.username}`);
    await this.room.say(`${target.username} was removed by a player vote.`);
  }

  private async abortMatch() {
    this.stopTimer();
    this.clearTurnTimer();
    this.wagers.clear();
    this.matchId = undefined;
    this.activeBeatmapId = undefined;
    this.matchGameMode = undefined;
    this.startedAt = undefined;
    this.matchParticipants = [];
    this.votes.clear();
    this.rerollVotes.clear();
    const state = resetRoundLifecycleState();
    this.automatedBeatmapId = state.automatedBeatmapId;
    this.lastValidMapId = state.lastValidMapId;
    this.currentForcedMods = state.currentForcedMods;
    this.targetAccuracy = state.targetAccuracy;
    this.wasHostMapPick = state.wasHostMapPick;
    await this.room.command("!mp abort");
    await this.room.say(
      `[Match] Match aborted. Scores discarded. Round ${this.currentRound}/${this.totalRounds} can be restarted, or use !skip to roll a new minigame.`
    );
    const host = this.room.host();
    if (host) {
      this.startTurnTimer(this.room.beatmapId() ? "start" : "select", host, this.room.beatmapId());
    }
  }

  private async showQueue() {
    const rows = await this.db.player.findMany({ where: { id: { in: this.queue } } });
    await this.room.say(`Queue: ${this.queue.map((id, i) => `${i + 1}.${rows.find(x => x.id === id)?.username ?? id}`).join(" | ") || "empty"}`);
  }

  private async setAutoSkip(p: Participant, value?: string) {
    const enabled = value?.toLowerCase();
    if (enabled !== "on" && enabled !== "off") return void this.room.say("Usage: !autoskip [on/off].");
    if (enabled === "on") {
      if (this.room.players().length <= 1) return void this.room.say(`${p.username}: auto-skip cannot be enabled in a one-player lobby.`);
      this.autoSkip.add(p.id);
      await this.room.say(`${p.username}: auto-skip enabled. Your host turns will be passed automatically.`);
      if (this.isHost(p) && !this.matchId) await this.passTurnToNextHost();
    } else {
      this.autoSkip.delete(p.id);
      await this.room.say(`${p.username}: auto-skip disabled.`);
    }
  }

  private async disableSoloAutoSkip() {
    const players = this.room.players();
    if (players.length !== 1) return;
    const player = players[0];
    if (this.autoSkip.delete(player.id)) await this.room.say(`${player.username}: auto-skip disabled because this is now a one-player lobby.`);
  }

  private async showRegulations() { await this.room.say(this.regulationSummary()); }

  private regulationSummary() {
    const r = this.config.regulations;
    if (!r.enabled) return "Map regulations are currently disabled.";
    const formatStars = (value?: number) => (value === undefined ? "any" : value.toFixed(4).replace(/\.?(0+)$/, ""));
    const stars = r.minStar !== undefined || r.maxStar !== undefined ? `${formatStars(r.minStar)}–${formatStars(r.maxStar)}★` : "any star rating";
    const length = r.minLength !== undefined || r.maxLength !== undefined ? `${r.minLength !== undefined ? fmt(r.minLength) : "any"}–${r.maxLength !== undefined ? fmt(r.maxLength) : "any"}` : "any length";
    const mode = r.gameMode ? r.gameMode[0].toUpperCase() + r.gameMode.slice(1) : "any mode";
    const statuses = r.allowedStatuses?.length ? r.allowedStatuses.join(", ") : "all statuses";
    const range = (min: number | undefined, max: number | undefined, suffix = "") => (min !== undefined || max !== undefined ? `${min ?? "any"}–${max ?? "any"}${suffix}` : "any");
    return `Map regulations — Stars: ${stars} | Length: ${length} | BPM: ${range(r.minBpm, r.maxBpm)} | AR: ${range(r.minAr, r.maxAr)} | HP: ${range(r.minHp, r.maxHp)} | OD: ${range(r.minOd, r.maxOd)} | CS: ${range(r.minCs, r.maxCs)} | Year: ${range(r.minLastUpdatedYear, r.maxLastUpdatedYear)} | Mode: ${mode} | Status: ${statuses} | Converts: ${r.allowConvert ? "allowed" : "not allowed"} | Free mod: ${r.freeMod ? "enabled" : "disabled"}.`;
  }

  private async advanceToNextRound(force = false) {
    const wasHostPick = this.wasHostMapPick;
    this.clearTurnTimer();
    this.stopTimer();
    const state = resetRoundLifecycleState();
    this.automatedBeatmapId = state.automatedBeatmapId;
    this.lastValidMapId = state.lastValidMapId;
    this.currentForcedMods = state.currentForcedMods;
    this.targetAccuracy = state.targetAccuracy;
    this.wasHostMapPick = state.wasHostMapPick;

    if (!force && !wasHostPick) {
      const currentHost = this.queue[0] ? this.room.players().find(p => p.id === this.queue[0]) : undefined;
      const hostName = currentHost?.username ?? "Host";
      await this.room.say(`[Host] Map was bot-selected; ${hostName} retains host for next round.`);
      this.turnHostId = undefined;
    } else {
      if (this.queue.length) this.queue.push(this.queue.shift()!);
      this.turnHostId = undefined;
    }

    // Step 2: Queue Status
    await this.showQueue();

    // Step 3 & 4: Prepare next minigame and dispatch announcements
    await this.prepareNextMinigame();
  }

  private async skip(force = false, isUserSkip = true) {
    if (isUserSkip) {
      await this.room.say("[Skip] Round skipped. Rolling next minigame...");
    }
    this.wagers.clear();
    this.rerollVotes.clear();
    const state = resetRoundLifecycleState();
    this.automatedBeatmapId = state.automatedBeatmapId;
    this.lastValidMapId = state.lastValidMapId;
    this.currentForcedMods = state.currentForcedMods;
    this.targetAccuracy = state.targetAccuracy;
    await this.advanceToNextRound(force);
  }

  private async startMatch(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) return void this.room.say("Start delay must be between 0 and 120 seconds.");
    const mapId = this.room.beatmapId();
    if (!mapId) return void this.room.say("Select a beatmap first.");
    if (this.currentMinigame?.mapPicker === "host") {
      const map = await this.osu.beatmap(mapId);
      const adjustedStars = await this.resolveModAdjustedStars(mapId, map.stars, this.currentForcedMods);
      const reason = checkMap(map, this.config.regulations, this.currentForcedMods, adjustedStars);
      if (reason) {
        if (this.currentForcedMods && reason.includes("★ with ")) {
          return void this.room.say(`[Regulations] Map rejected: ${reason}. Please select another map!`);
        }
        return void this.room.say(`Map rejected: ${reason}.`);
      }
    }
    if (this.currentForcedMods && (this.activeRoomMods !== this.normalizeMods(this.currentForcedMods) || this.activeFreemod)) {
      await this.enforceForcedMods();
    }
    this.clearTurnTimer();
    this.stopTimer();
    if (seconds === 0) {
      await this.launch(mapId);
      return;
    }
    this.timer = setTimeout(() => this.runActivity("Match launch", () => this.launch(mapId)), seconds * 1000);
    await this.room.say(`Match starts in ${seconds}s.`);
  }

  private async validateSelection(mapId: number) {
    if (!Number.isInteger(mapId) || mapId <= 0) return;
    if (this.currentMinigame && shouldBypassRegulations(this.currentMinigame)) {
      if (this.automatedBeatmapId && mapId !== this.automatedBeatmapId) {
        await this.room.command(`!mp map ${this.automatedBeatmapId}`);
      }
      return;
    }
    try {
      const map = await this.osu.beatmap(mapId);
      const adjustedStars = await this.resolveModAdjustedStars(mapId, map.stars, this.currentForcedMods);
      const reason = checkMap(map, this.config.regulations, this.currentForcedMods, adjustedStars);
      if (!reason) {
        this.lastValidMapId = mapId;
        this.selectedGameMode = map.mode;
        await this.announceSelectedMap(map);
        this.mapSelected(mapId);
        if (this.currentForcedMods && (this.activeRoomMods !== this.normalizeMods(this.currentForcedMods) || this.activeFreemod)) {
          await this.enforceForcedMods();
        }
        return;
      }
      if (this.currentForcedMods && reason.includes("★ with ")) {
        if (this.lastValidMapId) {
          await this.room.command(`!mp map ${this.lastValidMapId}`);
        }
        await this.room.say(`[Regulations] Map rejected: ${reason}. Please select another map!`);
      } else if (this.lastValidMapId) {
        await this.room.command(`!mp map ${this.lastValidMapId}`);
        await this.room.say(`Map rejected: ${reason}. Reverted to the previous valid map.`);
      } else {
        await this.room.say(`Map rejected: ${reason}. Select a regulation-compliant map.`);
      }
    } catch (error) {
      if (error instanceof OsuApiRequestError && error.status === 404 && this.lastValidMapId) {
        await this.room.command(`!mp map ${this.lastValidMapId}`);
        await this.room.say("Map rejected: this map is unsubmitted or deleted. Reverted to the previous valid map.");
      }
    }
  }

  private async enforceTitle(title?: string) {
    await this.lobbyKeeper.enforceTitle(title);
  }

  private async enforcePassword(password?: string) {
    await this.lobbyKeeper.enforcePassword(password);
  }

  private async validateRoomMetadata() {
    await this.lobbyKeeper.validateRoomMetadata();
  }

  private async onRoundComplete() {
    await this.validateRoomMetadata();
  }

  private async enforceMatchSettings(teamMode?: number, winCondition?: number) {
    await this.lobbyKeeper.enforceMatchSettings(teamMode, winCondition);
  }

  private normalizeMods(mods: string | string[]): string {
    return normalizeMods(mods);
  }

  private async enforceForcedMods(currentMods?: string[], isFreemod?: boolean) {
    await this.lobbyKeeper.enforceForcedMods(currentMods, isFreemod);
  }

  private async resolveModAdjustedStars(beatmapId: number, nominalStars: number, forcedMods?: string): Promise<number | undefined> {
    if (!forcedMods) return nominalStars;
    const modTokens = forcedMods.toUpperCase().split(/\s+/).filter(Boolean);
    try {
      if (typeof this.osu.beatmapAttributes === "function") {
        const attrs = await this.osu.beatmapAttributes(beatmapId, modTokens, this.selectedGameMode);
        if (typeof attrs?.star_rating === "number" && !isNaN(attrs.star_rating)) {
          return Math.round(attrs.star_rating * 100) / 100;
        }
      }
    } catch {
      // API fallback
    }
    return calculateModAdjustedStars(nominalStars, forcedMods);
  }

  private async voteReroll(p: Participant) {
    if (this.matchId) {
      return void this.room.say(`${p.username}: cannot reroll during an active match.`);
    }
    const humanPlayers = this.room.players().filter(player => player.username.toLowerCase() !== this.botUsername?.toLowerCase());
    const activeCount = Math.max(1, humanPlayers.length);
    const requiredVotes = activeCount <= 2 ? activeCount : Math.floor(activeCount / 2) + 1;

    if (this.rerollVotes.has(p.id)) {
      return void this.room.say(`${p.username}: you have already voted to reroll (${this.rerollVotes.size}/${requiredVotes} needed).`);
    }

    this.rerollVotes.add(p.id);
    const currentVotes = this.rerollVotes.size;
    await this.room.say(`[Vote] ${p.username} voted to reroll the minigame! (${currentVotes}/${requiredVotes} needed)`);

    if (currentVotes >= requiredVotes) {
      await this.triggerReroll();
    }
  }

  private async triggerReroll() {
    this.rerollVotes.clear();
    await this.room.say("[Reroll] Vote passed! Rolling a new minigame...");
    this.stopTimer();
    this.clearTurnTimer();
    this.wagers.clear();
    const state = resetRoundLifecycleState();
    this.automatedBeatmapId = state.automatedBeatmapId;
    this.lastValidMapId = state.lastValidMapId;
    this.currentForcedMods = state.currentForcedMods;
    this.targetAccuracy = state.targetAccuracy;
    this.wasHostMapPick = state.wasHostMapPick;
    await this.prepareNextMinigame();
  }

  private async setLobbyMode(teamMode: number, scoreMode: number) { await this.room.command(`!mp set ${teamMode} ${scoreMode}`); }

  private async prepareNextMinigame() {
    if (this.isPreparingRound) return;
    this.isPreparingRound = true;
    try {
      const state = resetRoundLifecycleState();
      this.lastValidMapId = state.lastValidMapId;
      this.automatedBeatmapId = state.automatedBeatmapId;
      this.currentForcedMods = state.currentForcedMods;
      this.targetAccuracy = state.targetAccuracy;
      // 1. Roll the next minigame
      this.currentMinigame = rollNextMinigame(this.currentMinigame, this.config.minigameWeights, this.currentRound);
      this.wasHostMapPick = this.currentMinigame.mapPicker === "host";
      this.teamEvent = this.currentMinigame.teamMode === 2 || this.currentMinigame.teamMode === 3;
      this.wagers.clear();
      this.rerollVotes.clear();

      // 2. Set targets
      if (this.currentMinigame.id === "target-practice") {
        this.targetAccuracy = rollTargetAccuracy();
      } else {
        this.targetAccuracy = undefined;
      }

      // 3. Apply Bancho Rules (Mode & Mods)
      this.currentForcedMods = this.currentMinigame.forcedMods || undefined;
      const commands = getBanchoSetupCommands(this.currentMinigame);
      for (const cmd of commands) {
        await this.room.command(cmd);
      }
      this.activeRoomMods = this.normalizeMods(this.currentForcedMods || "");
      this.activeFreemod = !this.currentForcedMods;

      const players = this.room.players();

      if (this.currentMinigame.scoringMetric === "bounty" || this.currentMinigame.scoringMetric === "juggernaut") {
        const activeIds = players.map(p => p.id);
        const modeStats = await this.db.playerModeStats.findMany({
          where: { playerId: { in: activeIds }, mode: this.currentStatsMode() },
          orderBy: { points: "desc" }
        });
        this.leaderPlayerId = modeStats[0]?.playerId;
      } else {
        this.leaderPlayerId = undefined;
      }

      // 4. Handle Team Balancing (Clash & Juggernaut)
      if (this.currentMinigame.teamMode === 2) {
        const activeIds = players.map(p => p.id);
        const dbPlayers = await this.db.player.findMany({ where: { id: { in: activeIds } } });
        const modeStats = await this.db.playerModeStats.findMany({ where: { playerId: { in: activeIds }, mode: this.currentStatsMode() } });
        const pointsByPlayer = new Map(modeStats.map(stat => [stat.playerId, stat.points]));
        const hydratedPlayers = dbPlayers.map(p => ({ ...p, points: pointsByPlayer.get(p.id) ?? 0, elo: pointsByPlayer.get(p.id) ?? 0 }));

        if (this.currentMinigame.scoringMetric === "juggernaut") {
          hydratedPlayers.sort((a, b) => (b.points ?? b.elo) - (a.points ?? a.elo));
          const juggernaut = hydratedPlayers[0];
          if (juggernaut) {
            await this.room.command(`!mp team ${juggernaut.username} Red`);
            for (let i = 1; i < hydratedPlayers.length; i++) {
              await this.room.command(`!mp team ${hydratedPlayers[i].username} Blue`);
            }
          }
        } else {
          const teams = balancedTeams(hydratedPlayers);
          for (const player of teams.red) await this.room.command(`!mp team ${player.username} Red`);
          for (const player of teams.blue) await this.room.command(`!mp team ${player.username} Blue`);
        }
      }

      // 5. Host & Map Configuration commands (dispatched before announcements)
      let actionLine = "";
      let hostToTimer: Participant | undefined;

      if (this.currentMinigame.mapPicker === "host") {
        this.automatedBeatmapId = undefined;
        const hostId = this.queue[0];
        if (hostId) {
          this.intendedHostId = hostId;
          await this.room.command(`!mp host #${hostId}`);
        }
        const hostPlayer = (hostId ? players.find(p => p.id === hostId) : undefined) ?? this.room.host();
        const hostUsername = hostPlayer?.username ?? "Host";
        actionLine = `[Host] ${hostUsername}, select a map! (3 min limit)`;
        hostToTimer = hostPlayer;
      } else {
        if (this.botUsername) {
          await this.room.command(`!mp host ${this.botUsername}`);
        }
        this.clearTurnTimer();
        const host = (this.queue[0] ? players.find(p => p.id === this.queue[0]) : undefined) ?? this.room.host();
        const picked = await resolveMinigameMap(this.currentMinigame.mapPicker, {
          hostId: host?.id,
          hostUsername: host?.username,
          playerCount: players.length,
          osu: this.osu,
        });

        if (picked) {
          this.automatedBeatmapId = picked.beatmapId;
          const assignedMods = picked.overrideMods ?? (this.currentMinigame.id === "boss-battle" ? "None" : undefined);
          if (assignedMods) {
            this.currentForcedMods = assignedMods;
            await this.room.command(`!mp mods ${assignedMods}`);
            this.activeRoomMods = this.normalizeMods(assignedMods);
            this.activeFreemod = false;
          }
          await this.room.command(`!mp map ${picked.beatmapId}`);
          actionLine = `[Pick] ${picked.announcement}`;
        } else {
          const hostUsername = host?.username ?? "Host";
          actionLine = `[Host] Automated pick could not be loaded. ${hostUsername}, select a map! (3 min limit)`;
          hostToTimer = host;
        }
      }

      // Step 3: Minigame Round Announcement
      let line1 = `[Round ${this.currentRound}/${this.totalRounds}] ${this.currentMinigame.name} | ${this.currentMinigame.description}`;
      if (this.currentMinigame.id === "target-practice" && this.targetAccuracy !== undefined) {
        line1 += ` | Target: ${this.targetAccuracy}%`;
      }
      await this.room.say(line1);

      // Step 4: Host Prompt / Map Action (MUST BE THE LATEST MESSAGE)
      await this.room.say(actionLine);
      if (hostToTimer) {
        this.startTurnTimer("select", hostToTimer);
      }
    } finally {
      this.isPreparingRound = false;
    }
  }

  private async preStartEnforcement(): Promise<void> {
    // 0. Pre-Flight Room Title Check: query and compare against target title with .trim()
    const targetTitle = this.config.title;
    if (targetTitle) {
      const currentTitle = this.room.name?.() ?? this.currentRoomTitle;
      const cleanTarget = targetTitle.trim();
      const cleanCurrent = (currentTitle ?? "").trim();
      if (cleanCurrent !== cleanTarget) {
        await this.room.command(`!mp name ${targetTitle}`);
        this.currentRoomTitle = targetTitle;
      }
    }

    if (!this.currentMinigame) return;

    // 1. Forced Mods: If configured, conditionally dispatch !mp mods (including "None" for Boss Battle)
    const forcedMods = this.currentForcedMods ?? (this.currentMinigame.id === "boss-battle" ? "None" : this.currentMinigame.forcedMods);
    if (forcedMods) {
      await this.room.command(`!mp mods ${forcedMods}`);
      this.activeRoomMods = this.normalizeMods(forcedMods);
      this.activeFreemod = false;
    }

    // 2. Team Mode & Win Condition: Re-issue compound rule command
    const teamMode = this.currentMinigame.teamMode ?? 0;
    const scoreMode = this.currentMinigame.scoreMode ?? 3;
    await this.room.command(`!mp set ${teamMode} ${scoreMode}`);
  }

  private async launch(mapId: number, skipPreStart = false) {
    if (this.matchId || this.isLaunching) return;
    this.isLaunching = true;
    try {
      if (!skipPreStart) {
        await this.preStartEnforcement();
      }
      let gameMode: GameMode | undefined;
      try {
        gameMode = (await this.osu.beatmap(mapId)).mode;
      } catch {
        gameMode = this.selectedGameMode ?? this.config.regulations.gameMode ?? "osu";
      }
      await this.beginMatch(mapId, gameMode);
      await this.room.command("!mp start");
    } finally {
      this.isLaunching = false;
    }
  }

  private async beginMatch(mapId = this.room.beatmapId(), gameMode?: GameMode) {
    if (this.matchId) return;
    this.clearTurnTimer();
    this.rerollVotes.clear();
    this.matchParticipants = this.room.players();
    this.matchGameMode = gameMode ?? this.selectedGameMode ?? this.config.regulations.gameMode ?? "osu";
    this.matchId = 1;
    this.activeBeatmapId = mapId;
    this.startedAt = new Date();
    this.votes.clear();
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async announceSelectedMap(map: MapInfo) {
    if (this.matchId || this.lastAnnouncedMapId === map.id || !this.room.host()) return;
    this.lastAnnouncedMapId = map.id;
    const name = `${map.artist} - ${map.title} [${map.version}]`.slice(0, 140);
    const mirrorLink = `https://beatconnect.io/b/${map.beatmapsetId}/`;
    await this.room.say(`Selected map: ${name} | ${map.stars.toFixed(2)}★ | ${fmt(map.length)} | [${mirrorLink} Beatconnect Mirror]`);
  }

  private async finish(scores: Array<{ player: Participant; score: number; team?: "red" | "blue"; pass?: boolean; misses?: number; accuracy?: number; combo?: number }>) {
    if (!this.matchId) return;
    const ordered = [...scores].sort((a, b) => b.score - a.score);
    const gameMode = this.matchGameMode ?? this.selectedGameMode ?? this.config.regulations.gameMode ?? "osu";
    const resultByPlayer = new Map(ordered.map(result => [result.player.id, result]));
    const participantById = new Map(this.matchParticipants.map(player => [player.id, player]));
    for (const result of ordered) participantById.set(result.player.id, result.player);
    const participants = [...participantById.values()];

    const rawScores: RawPlayerScore[] = participants.map(player => {
      const result = resultByPlayer.get(player.id);
      const score = result?.score;
      const misses = typeof result?.misses === "number" && !isNaN(result.misses)
        ? Math.max(0, Math.floor(result.misses))
        : 0;
      const accuracy = typeof result?.accuracy === "number" && !isNaN(result.accuracy)
        ? result.accuracy
        : 100.0;
      const combo = typeof result?.combo === "number" && !isNaN(result.combo)
        ? Math.max(0, Math.floor(result.combo))
        : 0;
      return {
        playerId: player.id,
        username: player.username,
        score: score === undefined || score === null || score === -1 ? 0 : score,
        accuracy,
        combo,
        misses,
        passed: result?.pass ?? true,
        team: result?.team === "red" ? "Red" : result?.team === "blue" ? "Blue" : "None",
        wagerAmount: this.wagers.get(player.id) ?? 0,
      };
    });

    const ranked = this.config.ranked && rawScores.length > 1;
    if (ranked) {
      const evaluated = evaluateRoundScores(rawScores, {
        minigame: this.currentMinigame,
        targetAccuracy: this.targetAccuracy,
        leaderPlayerId: this.leaderPlayerId,
      });
      await persistMatchPoints(this.db, {
        lobbyId: this.lobbyId,
        beatmapId: this.activeBeatmapId,
        minigameId: this.currentMinigame?.id ?? "unknown",
        gameMode,
        results: evaluated,
        rawScores,
      });

      const winnerRaw = rawScores.find(s => s.playerId === evaluated[0].playerId);
      const victoryLine = formatVictoryAnnouncement({
        metric: this.currentMinigame?.scoringMetric ?? "score",
        winner: evaluated[0],
        winnerRaw,
        targetAccuracy: this.targetAccuracy,
        leaderPlayerId: this.leaderPlayerId,
        leaderUsername: rawScores.find(s => s.playerId === this.leaderPlayerId)?.username,
        winningTeam: winnerRaw?.team,
      });
      await this.room.say(victoryLine);

      const summary = evaluated.map(r => `#${r.placement} ${r.username} (+${r.pointsEarned} PartyPoints)`).join(" | ");
      await this.room.say(`[Results] ${summary}`);
    } else if (!this.config.ranked) {
      await this.room.say("[Results] This lobby is unranked; no points or competitive stats were applied.");
    } else if (rawScores.length <= 1) {
      await this.room.say("[Results] No points were applied: at least two players are required for a ranked match.");
    }

    if (this.currentRound >= this.totalRounds) {
      await this.announcePodium();
      await this.resetPartySession();
      this.currentRound = 1;
    } else {
      this.currentRound++;
    }

    this.wagers.clear();
    this.leaderPlayerId = undefined;

    const mapId = this.activeBeatmapId;
    const startedAt = this.startedAt;
    const leaderboardParticipants = ordered.map(x => ({ ...x.player, matchScore: x.score }));
    this.matchId = undefined;
    this.activeBeatmapId = undefined;
    const state = resetRoundLifecycleState();
    this.automatedBeatmapId = state.automatedBeatmapId;
    this.lastValidMapId = state.lastValidMapId;
    this.currentForcedMods = state.currentForcedMods;
    this.targetAccuracy = state.targetAccuracy;
    this.matchGameMode = undefined;
    this.startedAt = undefined;
    this.matchParticipants = [];
    if (mapId && startedAt) setTimeout(() => this.runActivity("Leaderboard-score check", () => this.announceLeaderboardScores(mapId, startedAt, leaderboardParticipants)), 10_000);
    
    await this.onRoundComplete();
    await this.advanceToNextRound(false);
  }

  private getOrdinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  private async announcePodium() {
    const lobbyPlayers = await this.db.lobbyPlayer.findMany({
      where: { lobbyId: this.lobbyId },
      include: { player: true },
      orderBy: { sessionPoints: "desc" },
    });

    await this.room.say("=========================================");
    await this.room.say("[PARTY OVER] Grand Prix Final Standings:");
    const podium = lobbyPlayers.slice(0, 3);
    for (let i = 0; i < podium.length; i++) {
      const entry = podium[i];
      await this.room.say(`${this.getOrdinal(i + 1)} Place: ${entry.player.username} - ${entry.sessionPoints} pts`);
    }
    await this.room.say("=========================================");
  }

  private async resetPartySession() {
    await this.db.lobbyPlayer.updateMany({
      where: { lobbyId: this.lobbyId },
      data: { sessionPoints: 0 },
    });
  }

  private async bet(p: Participant, amountStr?: string) {
    if (this.currentMinigame?.scoringMetric !== "wager") {
      return void this.room.say(`[Wager] ${p.username}: bets are only allowed during the PartyPoint Wager minigame.`);
    }
    if (this.matchId) {
      return void this.room.say(`[Wager] ${p.username}: bets cannot be placed once the match has started.`);
    }
    const amount = Number(amountStr);
    if (!Number.isInteger(amount) || amount <= 0) {
      return void this.room.say("[Wager] Usage: !bet <positive integer amount> (e.g. !bet 5).");
    }
    const session = await this.db.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId: this.lobbyId, playerId: p.id } },
    });
    const currentPoints = Math.max(0, session?.sessionPoints ?? 0);
    if (currentPoints <= 0 || amount > currentPoints) {
      return void this.room.say(`[Wager] ${p.username}: you only have ${currentPoints} PartyPoints to wager.`);
    }
    this.wagers.set(p.id, amount);
    await this.room.say(`[Wager] ${p.username} wagered ${amount} PartyPoints! Finish in the top placements to double it!`);
  }

  private async showMinigameInfo() {
    if (!this.currentMinigame) {
      return void this.room.say("[Minigame] No active minigame.");
    }
    let text = `[Minigame] Round ${this.currentRound}/${this.totalRounds}: ${this.currentMinigame.name} | Rules: ${this.currentMinigame.description}`;
    if (this.currentMinigame.id === "target-practice" && this.targetAccuracy !== undefined) {
      text += ` | Target: ${this.targetAccuracy}%`;
    }
    await this.room.say(text);
  }

  private async showRoundInfo() {
    const hostName = this.room.host()?.username ?? "None";
    await this.room.say(`[Round] Current: ${this.currentRound}/${this.totalRounds} | Host: ${hostName}`);
  }

  private async showPoints(p: Participant) {
    const player = await this.db.player.findUnique({ where: { id: p.id } });
    const session = await this.db.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId: this.lobbyId, playerId: p.id } },
    });
    const sessionPts = session?.sessionPoints ?? 0;
    const allTimePts = player?.allTimePoints ?? 0;
    await this.room.say(`[PartyPoints] ${p.username}: ${sessionPts} PartyPoints (Session) | ${allTimePts} PartyPoints (All-Time)`);
  }

  private async showStandings() {
    const currentPlayers = this.room.players();
    const playerIds = currentPlayers.map((p) => p.id);
    const lobbyPlayers = await this.db.lobbyPlayer.findMany({
      where: { lobbyId: this.lobbyId, playerId: { in: playerIds } },
      include: { player: true },
      orderBy: { sessionPoints: "desc" },
      take: 5,
    });
    if (!lobbyPlayers.length) {
      return void this.room.say("[Standings] No players in standings yet.");
    }
    const formatted = lobbyPlayers
      .map((entry, index) => `${index + 1}. ${entry.player.username} (${entry.sessionPoints} pts)`)
      .join(" | ");
    await this.room.say(`[Standings] ${formatted}`);
  }

  public async getStandings(): Promise<{
    currentRound: number;
    totalRounds: number;
    minigameName?: string;
    players: Array<{
      position: number;
      id: number;
      username: string;
      sessionPoints: number;
      allTimePoints: number;
      streak: number;
      status: string;
    }>;
  }> {
    const currentPlayers = this.room.players();
    const host = this.room.host();
    const playerIds = currentPlayers.map((p) => p.id);

    const lobbyPlayers = playerIds.length > 0 ? await this.db.lobbyPlayer.findMany({
      where: { lobbyId: this.lobbyId, playerId: { in: playerIds } },
      include: { player: true },
      orderBy: { sessionPoints: "desc" },
    }) : [];

    const existingMap = new Map(lobbyPlayers.map((lp) => [lp.playerId, lp]));

    const entries = currentPlayers.map((p) => {
      const lp = existingMap.get(p.id);
      const isHost = host?.id === p.id;
      return {
        id: p.id,
        username: p.username,
        sessionPoints: lp?.sessionPoints ?? 0,
        allTimePoints: lp?.player?.allTimePoints ?? 0,
        streak: lp?.player?.streak ?? 0,
        status: isHost ? "Host" : "Ready",
      };
    });

    entries.sort((a, b) => b.sessionPoints - a.sessionPoints || b.allTimePoints - a.allTimePoints);

    return {
      currentRound: this.currentRound,
      totalRounds: this.totalRounds,
      minigameName: this.currentMinigame?.name,
      players: entries.map((e, idx) => ({
        position: idx + 1,
        ...e,
      })),
    };
  }

  private async announceLeaderboardScores(mapId: number, startedAt: Date, players: Array<Participant & { matchScore: number }>) {
    await Promise.all(players.map(player => this.announceLeaderboardScore(mapId, startedAt, player)));
  }

  private async announceLeaderboardScore(mapId: number, startedAt: Date, player: Participant & { matchScore: number }) {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const result = await this.osu.userBeatmapBestScore(mapId, player.id);
        const recordedAt = result?.score.created_at ? Date.parse(result.score.created_at) : NaN;
        const globalPosition = result ? await this.osu.leaderboardPosition(mapId, result.score.id) : undefined;
        if (!result || !globalPosition || globalPosition > 50 || !Number.isFinite(recordedAt) || recordedAt < startedAt.getTime() - 120_000) {
          if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 10_000));
          continue;
        }
        const score = result.score;
        const points = score.legacy_total_score || score.total_score || score.score || 0;
        if (points !== player.matchScore) {
          if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 10_000));
          continue;
        }
        const mods = (score.mods ?? []).map(m => (typeof m === "string" ? m : m.acronym ?? "")).filter(Boolean).join("") || "NM";
        const pp = score.pp == null ? "" : ` (${score.pp.toFixed(2)}pp)`;
        await this.room.say(`Congratulations ${player.username}! Your ${points.toLocaleString()} +${mods}${pp} score is now global #${globalPosition} on this map!`);
        return;
      } catch { /* Suppress temporary API latency */ }
      if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 10_000));
    }
  }

  private async playtime(p: Participant, username?: string) {
    const player = username
      ? (await this.db.player.findMany({ where: { username: { contains: username } }, take: 10 })).find(candidate => candidate.username.toLowerCase() === username.toLowerCase())
      : await this.db.player.findUnique({ where: { id: p.id } });
    if (!player) return void this.room.say(`${username ?? p.username}: no local player record found.`);
    const session = await this.db.lobbyPlayer.findUnique({ where: { lobbyId_playerId: { lobbyId: this.lobbyId, playerId: player.id } } });
    if (!session) return void this.room.say(`${player.username}: no active session in this lobby.`);
    await this.room.say(`${player.username}: session ${fmtSession(Math.floor((Date.now() - session.sessionStart.getTime()) / 1000))}.`);
  }

  private async timeleft() {
    if (!this.startedAt || !this.room.beatmapId()) return void this.room.say("No active match.");
    const map = await this.osu.beatmap(this.room.beatmapId()!);
    await this.room.say(`About ${fmt(Math.max(0, map.length - Math.floor((Date.now() - this.startedAt.getTime()) / 1000)))} left.`);
  }

  private currentStatsMode() { return this.selectedGameMode ?? this.config.regulations.gameMode ?? "osu"; }

  private parseGameMode(value?: string): GameMode | undefined {
    const aliases: Record<string, GameMode> = { osu: "osu", std: "osu", standard: "osu", taiko: "taiko", fruits: "fruits", catch: "fruits", ctb: "fruits", mania: "mania" };
    return value ? aliases[value.toLowerCase()] : undefined;
  }

  private usernameAndMode(args: string[]) {
    const mode = this.parseGameMode(args.at(-1));
    const username = (mode ? args.slice(0, -1) : args).join(" ").trim() || undefined;
    return { username, mode };
  }

  private async stats(p: Participant, username?: string, requestedMode?: GameMode) {
    const player = username
      ? (await this.db.player.findMany({ where: { username: { contains: username } }, take: 10 })).find(candidate => candidate.username.toLowerCase() === username.toLowerCase())
      : await this.db.player.findUnique({ where: { id: p.id } });
    if (!player) return void this.room.say(`${username ?? p.username}: no local stats found.`);
    const mode = requestedMode ?? this.currentStatsMode();
    const stats = await this.db.playerModeStats.findUnique({ where: { playerId_mode: { playerId: player.id, mode } } });
    if (!stats) return void this.room.say(`${player.username}: no ${gameModeLabel(mode)} local stats found yet.`);
    await this.room.say(`${player.username} (${gameModeLabel(mode)}): ${stats.points} PartyPoints, LWS ${stats.longestStreak}, matches ${stats.matches}, win rate ${winRate(stats)}%.`);
  }

  private async top(args: string[]) {
    const local = args.some(arg => arg.toLowerCase() === "local");
    const modeArgs = args.filter(arg => arg.toLowerCase() !== "local");
    if (modeArgs.length > 1 || (modeArgs.length === 1 && !this.parseGameMode(modeArgs[0]))) return void this.room.say("Usage: !top [local] [osu|taiko|catch|mania].");
    const playerIds = this.room.players().map(player => player.id);
    const mode = this.parseGameMode(modeArgs[0]) ?? this.currentStatsMode();
    const players = await this.db.playerModeStats.findMany({
      where: { mode, matches: { gte: 3 }, ...(local ? { playerId: { in: playerIds } } : {}) },
      include: { player: true },
      orderBy: [{ points: "desc" }, { playerId: "asc" }],
      take: 10
    });
    if (!players.length) return void this.room.say(local ? `No current lobby players have completed the 3 ${gameModeLabel(mode)} matches required for local rankings yet.` : `No players have completed the 3 ${gameModeLabel(mode)} matches required for local rankings yet.`);
    await this.room.say(`${local ? "Local top" : "Top"} (${gameModeLabel(mode)}): ${players.map((entry, index) => `#${index + 1} ${entry.player.username} (${entry.points} pts)`).join(" | ")}`);
  }

  private async rank(p: Participant, username?: string, requestedMode?: GameMode) {
    const player = username
      ? (await this.db.player.findMany({ where: { username: { contains: username } }, take: 10 })).find(candidate => candidate.username.toLowerCase() === username.toLowerCase())
      : await this.db.player.findUnique({ where: { id: p.id } });
    if (!player) return void this.room.say(`${username ?? p.username}: no local ranking found.`);
    const mode = requestedMode ?? this.currentStatsMode();
    const stats = await this.db.playerModeStats.findUnique({ where: { playerId_mode: { playerId: player.id, mode } } });
    if (!stats || stats.matches < 3) return void this.room.say(`${player.username}: complete at least 3 ${gameModeLabel(mode)} matches to receive a local ranking.`);
    const eligible = { mode, matches: { gte: 3 } };
    const ahead = await this.db.playerModeStats.count({
      where: { AND: [eligible, { OR: [{ points: { gt: stats.points } }, { points: stats.points, playerId: { lt: player.id } }] }] }
    });
    const total = await this.db.playerModeStats.count({ where: eligible });
    await this.room.say(`${player.username}: ${gameModeLabel(mode)} rank #${ahead + 1} of ${total} (${stats.points} pts).`);
  }

  private async lastScore() {
    const m = await this.db.match.findFirst({
      where: { lobbyId: this.lobbyId, endedAt: { not: null } },
      orderBy: { endedAt: "desc" },
      include: { scores: { include: { player: true }, orderBy: { placement: "asc" } } }
    });
    await this.room.say(m ? `Last: ${m.scores.map(s => `${s.placement}. ${s.player.username}${s.score}`).join(" | ")}` : "No completed match.");
  }

  private async bestScore(p: Participant, username?: string) {
    const id = this.room.beatmapId();
    if (!id) return void this.room.say("Select a beatmap first.");
    const map = await this.osu.beatmap(id);
    if (["wip", "pending", "graveyard"].includes(map.status)) return void this.room.say(`!bestscore is unavailable: ${map.status} maps do not have global leaderboards.`);
    let target = p;
    if (username) {
      try {
        const user = await this.osu.user(username);
        if (!Number.isInteger(user.id) || !user.username) return void this.room.say(`${username}: osu! user not found.`);
        target = { id: user.id, username: user.username };
      } catch { return void this.room.say(`${username}: osu! user not found.`); }
    }
    const result = await this.osu.userBeatmapBestScore(id, target.id);
    if (!result) return void this.room.say(`${target.username}: no submitted global score on this beatmap.`);
    const score = result.score;
    const points = score.legacy_total_score || score.total_score || score.score || 0;
    const accuracy = score.accuracy === undefined ? "" : `, ${(score.accuracy * 100).toFixed(2)}%`;
    const pp = score.pp == null ? "" : `, ${score.pp.toFixed(2)}pp`;
    const modAcronyms = (score.mods ?? []).map(m => (typeof m === "string" ? m : m.acronym ?? "")).filter(Boolean);
    const mods = modAcronyms.length ? ` +${modAcronyms.join("")}` : " +NM";
    const globalPosition = await this.osu.leaderboardPosition(id, score.id);
    await this.room.say(`${target.username}: global best ${points.toLocaleString()}${accuracy}${pp}${mods}${globalPosition ? ` (global #${globalPosition})` : ""}.`);
  }

  private async order(value: string) {
    const names = value.split(",").map(x => x.trim().toLowerCase());
    const players = await this.db.player.findMany({ where: { id: { in: this.queue } } });
    this.queue = names.map(n => players.find(p => p.username.toLowerCase() === n)?.id).filter((x): x is number => x !== undefined);
    await this.showQueue();
  }

  private async resetPoints(confirmation?: string) {
    if (confirmation?.toLowerCase() !== "confirm") return void this.room.say("This resets every player's competitive stats. Use *resetelo confirm to proceed.");
    const result = await this.db.playerModeStats.updateMany({ data: { points: 0, matches: 0, wins: 0, streak: 0, longestStreak: 0 } });
    await this.room.say(`Rankings reset for ${result.count} player${result.count === 1 ? "" : "s"}.`);
  }

  private async kick(username: string) {
    if (!username) return void this.room.say("Usage: *kick [username].");
    const player = this.room.players().find(candidate => candidate.username.toLowerCase() === username.toLowerCase());
    if (!player) return void this.room.say(`${username}: not currently in this lobby.`);
    await this.room.command(`!mp kick ${player.username}`);
    await this.room.say(`${player.username} was removed from the lobby by an administrator.`);
  }

  private async closeLobby() {
    this.closeRequested = true;
    this.stopTimer();
    this.clearTurnTimer();
    await this.room.say("This lobby is being closed by an administrator.");
    await this.room.command("!mp close");
  }

  private async setRanked(value?: string) {
    const enabled = value?.toLowerCase();
    if (enabled !== "on" && enabled !== "off") return void this.room.say("Usage: *ranked [on/off].");
    this.config.ranked = enabled === "on";
    await this.persist();
    await this.room.say(`Lobby ranking is now ${this.config.ranked ? "enabled — matches count toward PartyPoints and stats." : "disabled — matches are unranked and do not count toward PartyPoints or stats."}`);
  }

  async close() { await this.closeLobby(); await this.removeEmptyHistory(); }

  private async removeEmptyHistory() {
    const matches = await this.db.match.count({ where: { lobbyId: this.lobbyId } });
    if (matches === 0) await this.db.lobby.delete({ where: { id: this.lobbyId } }).catch(() => undefined);
  }

  async updateRegulations(regulations: Partial<LobbyConfig["regulations"]>, _eventChance?: number, details?: { title?: string; password?: string; removePassword?: boolean; ranked?: boolean; autoRecreateOnInactivity?: boolean }) {
    this.config.regulations = { ...DEFAULT_CONFIG.regulations, ...regulations };
    if (details?.ranked !== undefined) this.config.ranked = details.ranked;
    if (details?.autoRecreateOnInactivity !== undefined) this.config.autoRecreateOnInactivity = details.autoRecreateOnInactivity;
    if (details?.title !== undefined) {
      const cleanTitle = details.title.trim();
      const resolvedTitle = cleanTitle || generateDefaultLobbyTitle({ regulations: this.config.regulations });
      if (resolvedTitle !== this.config.title) {
        this.config.title = resolvedTitle;
        await this.room.setTitle(resolvedTitle);
      }
    }
    if (details?.removePassword || details?.password) {
      this.config.password = details.removePassword ? undefined : details.password;
      this.passwordSetUntil = Date.now() + 3_000;
      await this.room.command(this.config.password ? `!mp password ${this.config.password}` : "!mp password");
    }
    await this.db.lobby.update({ where: { id: this.lobbyId }, data: { name: this.config.title, password: this.config.password, config: this.config as any } });
    await this.room.say(`Lobby settings updated from the dashboard. ${this.regulationSummary()} Ranking: ${this.config.ranked ? "enabled" : "disabled"}.`);
  }

  private async updateMap() {
    const id = this.room.beatmapId();
    if (!id) return void this.room.say("Select a beatmap first.");
    const map = await this.osu.beatmap(id);
    await this.room.command(`!mp map ${map.id}`);
    await this.room.say(`Map refreshed: ${map.version}.`);
  }

  private async keep(a: string[]) {
    const [kind, ...rest] = a;
    let confirmation = "";
    if (kind === "size") {
      const size = Number(rest[0]);
      if (!Number.isInteger(size) || size < 1 || size > 16) return void this.room.say("Lobby size must be 1-16.");
      this.config.size = size;
      this.config.locks.size = true;
      await this.room.command(`!mp size ${size}`);
      confirmation = `Lobby size locked to ${size}.`;
    }
    if (kind === "password") {
      if (!this.config.password) return void this.room.say("This lobby was created passwordless, so password locking is not allowed.");
      const password = rest.join(" ");
      if (!password) return void this.room.say("Usage: *keep password [password].");
      this.config.password = password;
      this.config.locks.password = true;
      this.passwordSetUntil = Date.now() + 3_000;
      await this.room.command(`!mp password ${password}`);
      confirmation = "Lobby password lock enabled.";
    }
    if (kind === "mods") {
      this.config.mods = rest;
      this.config.locks.mods = true;
      await this.room.command(`!mp mods ${rest.join(" ")}`);
      confirmation = `Mod lock enabled: ${rest.join(" ") || "None"}.`;
    }
    if (kind === "title") {
      const title = rest.join(" ");
      if (!title) return void this.room.say("Usage: *keep title [title].");
      this.config.title = title;
      this.config.locks.title = true;
      await this.room.setTitle(title);
      confirmation = `Lobby title locked to: ${title}.`;
    }
    if (!confirmation) return void this.room.say("Unknown lobby lock. Use size, password, mods, or title.");
    await this.persist();
    await this.room.say(confirmation);
  }

  private async noKeep(kind?: string) {
    if (kind === "mod") kind = "mods";
    if (!kind || !["size", "password", "mods", "title"].includes(kind)) return void this.room.say("Unknown lobby lock. Use size, password, mods, or title.");
    const wasLocked = Boolean(this.config.locks[kind as keyof LobbyConfig["locks"]]);
    delete this.config.locks[kind as keyof LobbyConfig["locks"]];
    await this.persist();
    await this.room.say(wasLocked ? `${kind === "mods" ? "Mod" : kind[0].toUpperCase() + kind.slice(1)} lock removed.` : `${kind === "mods" ? "Mod" : kind[0].toUpperCase() + kind.slice(1)} lock was not enabled.`);
  }

  private async regulation(a: string[]) {
    if (a[0] === "enable") this.config.regulations.enabled = true;
    else if (a[0] === "disable") this.config.regulations.enabled = false;
    else if (a[0] === "status") {
      const aliases: Record<string, string> = { graveyarded: "graveyard", pending: "pending", qualified: "qualified", ranked: "ranked", approved: "approved", loved: "loved", wip: "wip" };
      const statuses = a.slice(1).map(x => aliases[x.toLowerCase()] ?? x.toLowerCase()).filter(Boolean);
      if (!statuses.length) return void this.room.say("Usage: *regulation status all | ranked loved qualified pending graveyard wip.");
      this.config.regulations.allowedStatuses = statuses.includes("all") ? undefined : [...new Set(statuses)];
    } else {
      const pairs = a.length === 2 && !a[0].includes("=") ? [`${a[0]}=${a[1]}`] : a;
      for (const raw of pairs) {
        if (raw === "allow_convert") this.config.regulations.allowConvert = true;
        else if (raw === "disallow_convert") this.config.regulations.allowConvert = false;
        else if (raw === "freemod") this.config.regulations.freeMod = true;
        else if (raw === "no_freemod") this.config.regulations.freeMod = false;
        else {
          const [k, v] = raw.split("=");
          if (k === "gamemode" && ["osu", "taiko", "fruits", "mania"].includes(v)) this.config.regulations.gameMode = v as any;
          else if (["min_star", "max_star", "min_length", "max_length", "min_bpm", "max_bpm", "min_ar", "max_ar", "min_hp", "max_hp", "min_od", "max_od", "min_cs", "max_cs", "min_last_updated_year", "max_last_updated_year"].includes(k) && v && Number.isFinite(Number(v))) (this.config.regulations as any)[k.replace(/_([a-z])/g, (_, x) => x.toUpperCase())] = Number(v);
        }
      }
    }
    await this.persist();
    await this.room.say(`Regulations updated. ${this.regulationSummary()}`);
  }

  private async denylist(a: string[]) {
    const username = a.slice(1).join(" ");
    if (!["add", "remove"].includes(a[0]) || !username) return void this.room.say("Usage: *denylist add [username] or *denylist remove [username].");
    const p = await this.db.player.findFirst({ where: { username: { equals: username } } });
    if (!p) return void this.room.say(`${username} is not in this bot's player database yet.`);
    const denied = a[0] === "add";
    await this.db.player.update({ where: { id: p.id }, data: { denied } });
    await this.room.say(`${p.username} ${denied ? "added to" : "removed from"} the denylist.`);
  }

  private persist() { return this.db.lobby.update({ where: { id: this.lobbyId }, data: { config: this.config as any } }); }
}
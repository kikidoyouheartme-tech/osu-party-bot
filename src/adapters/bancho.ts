import Banchojs from "bancho.js";
import type { Participant } from "../types.js";

export interface RoomActivity { at: string; level: "info" | "error"; message: string; }

export interface RoomMatchScore {
  player: Participant;
  score: number;
  team?: "red" | "blue";
  pass?: boolean;
  misses?: number;
  accuracy?: number;
  combo?: number;
}

/** Narrow, testable boundary around bancho.js. The bot account is referee-only; it never joins a slot. */
export interface RoomActions {
  say(message: string): Promise<void>; command(command: string): Promise<void>;
  message?(message: string): Promise<void>;
  setTitle(title: string): Promise<void>;
  players(): Participant[]; host(): Participant | undefined; beatmapId(): number | undefined;
  id(): number;
  botUsername?(): string | undefined;
  mods?(): string[];
  freemod?(): boolean;
  teamMode?(): number | undefined;
  winCondition?(): number | undefined;
  name?(): string | undefined;
  password?(): string | undefined;
  onModsChanged?(listener: (mods: string[], freemod: boolean) => void): void;
  onSettingsChanged?(listener: (teamMode?: number, winCondition?: number) => void): void;
  onMessage(listener: (sender: Participant, text: string) => void): void;
  onPlayerJoined(listener: (player: Participant) => void): void;
  onPlayerLeft(listener: (player: Participant) => void): void;
  onBeatmapChanged(listener: (beatmapId: number) => void): void;
  onTitleChanged(listener: (title: string) => void): void;
  onPasswordChanged(listener: () => void): void;
  onHostChanged(listener: (host?: Participant) => void): void;
  onAllPlayersReady(listener: () => void): void;
  onMatchStarted(listener: () => void): void;
  onMatchFinished(listener: (scores: RoomMatchScore[]) => void): void;
  onClosed(listener: () => void): void;
  onActivity(listener: (activity: RoomActivity) => void): void;
}
/** Shared across every lobby because Bancho's message cap applies to the bot account, not an individual room. */
class BanchoRateLimiter {
  private timestamps: number[] = [];
  private queue = Promise.resolve();
  send(action: () => Promise<void>) {
    const task = this.queue.then(async () => {
      for (;;) {
        const now = Date.now();
        this.timestamps = this.timestamps.filter(timestamp => now - timestamp < 5_000);
        if (this.timestamps.length < 10) break;
        const wait = 5_000 - (now - this.timestamps[0]) + 10;
        await new Promise(resolve => setTimeout(resolve, wait));
      }
      this.timestamps.push(Date.now());
      await action();
    });
    // A rejected send must not block subsequent queued messages forever.
    this.queue = task.catch(() => undefined);
    return task;
  }
}
export class BanchoGateway {
  private client: any;
  private readonly limiter = new BanchoRateLimiter();
  constructor(username: string, password: string, apiKey: string) {
    // bancho.js is CommonJS: its default export is a namespace object whose
    // BanchoClient property is the constructor.
    this.client = new (Banchojs as any).BanchoClient({ username, password, apiKey, botAccount: true });
  }
  async connect() { await this.client.connect(); }
  async makeLobby(name: string, password?: string): Promise<RoomActions> {
    const channel = await this.client.createLobby(name);
    // Tournament lobbies created by `!mp make` are password-protected by
    // default. Sending the command without an argument removes that password.
    await this.limiter.send(() => channel.sendMessage(password ? `!mp password ${password}` : "!mp password"));
    return new BanchoRoom(channel, this.limiter, password);
  }
}
class BanchoRoom implements RoomActions {
  private readonly activityListeners = new Set<(activity: RoomActivity) => void>();
  private readonly recentMisses = new Map<string, number>();
  private currentPassword?: string;

  constructor(private channel: any, private limiter: BanchoRateLimiter, initialPassword?: string) {
    this.currentPassword = initialPassword;
    this.channel.on("message", (message: any) => {
      const text = message?.message ?? "";
      // Regex extraction of misses from IRC post-match reports
      const match = /(?:^|\s)([\w\s\-\[\]]+?)(?::|\s+finished|\s+-)\s*.*?(?:misses?|miss)[:\s]+(\d+)/i.exec(text);
      if (match) {
        const username = match[1].trim().toLowerCase();
        const misses = parseInt(match[2], 10);
        if (!isNaN(misses)) {
          this.recentMisses.set(username, Math.max(0, misses));
        }
      }
    });
  }

  private activity(level: RoomActivity["level"], message: string) { const entry = { at: new Date().toISOString(), level, message }; for (const listener of this.activityListeners) listener(entry); }
  private participant(user: any, source: string): Participant | undefined {
    if (!user || !Number.isInteger(user.id) || !user.ircUsername) { this.activity("error", `${source}: Bancho sent an incomplete player payload.`); return; }
    return { id: user.id, username: user.ircUsername };
  }
  private send(message: string, label: string) { return this.limiter.send(() => this.channel.sendMessage(message)).then(() => this.activity("info", `${label}: ${message}`), error => { this.activity("error", `${label} failed: ${error instanceof Error ? error.message : String(error)}`); throw error; }); }
  say(message: string) { return this.send(message, "Chat"); }
  message(message: string) { return this.say(message); }
  command(command: string) {
    const passMatch = /^!mp\s+password(?:\s+(.*))?$/i.exec(command);
    if (passMatch) {
      this.currentPassword = passMatch[1]?.trim() || undefined;
    }
    const nameMatch = /^!mp\s+name\s+(.*)$/i.exec(command);
    if (nameMatch && this.channel.lobby) {
      this.channel.lobby.name = nameMatch[1].trim();
    }
    return this.send(command, "Command");
  }
  // Bancho's acknowledgement is not consistently emitted for client-created
  // tournament rooms, so send the command without waiting for that event.
  setTitle(title: string) {
    if (this.channel.lobby) {
      this.channel.lobby.name = title.trim();
    }
    return this.send(`!mp name ${title}`, "Command");
  }
  players(): Participant[] { return (this.channel.lobby?.slots ?? []).filter((s: any) => s?.user).map((s: any) => ({ id: s.user.id, username: s.user.ircUsername, team: s.team === "Blue" || s.team === "blue" ? "Blue" : s.team === "Red" || s.team === "red" ? "Red" : undefined })); }
  host() { const h = this.channel.lobby?.getHost?.(); return h?.user ? { id: h.user.id, username: h.user.ircUsername } : undefined; }
  beatmapId() { return this.channel.lobby?.beatmapId; }
  id() { return this.channel.lobby.id; }
  botUsername(): string | undefined { return this.channel.banchojs?.username ?? this.channel.client?.username; }
  mods(): string[] {
    return (this.channel.lobby?.mods ?? [])
      .map((m: any) => m?.shortMod || m?.acronym || String(m))
      .filter((s: string) => Boolean(s) && s.toLowerCase() !== "none");
  }
  freemod(): boolean {
    return Boolean(this.channel.lobby?.freemod);
  }
  teamMode(): number | undefined {
    return this.channel.lobby?.teamMode;
  }
  winCondition(): number | undefined {
    return this.channel.lobby?.winCondition;
  }
  name(): string | undefined {
    return this.channel.lobby?.name;
  }
  password(): string | undefined {
    return this.currentPassword;
  }
  onModsChanged(listener: (mods: string[], freemod: boolean) => void) {
    const handle = () => listener(this.mods(), this.freemod());
    this.channel.lobby?.on("mods", handle);
    this.channel.lobby?.on("freemod", handle);
    this.channel.lobby?.on("refereeChangedMods", handle);
    this.channel.lobby?.on("playerMods", handle);
    this.channel.on("message", (message: any) => {
      if (message.user?.ircUsername?.toLowerCase() !== "banchobot") return;
      if (/^(Enabled|Disabled|Active mods:|Freemod|Free mod|Room mods)/i.test(message.message)) {
        setTimeout(handle, 100);
      }
    });
  }
  onSettingsChanged(listener: (teamMode?: number, winCondition?: number) => void) {
    const handle = () => listener(this.teamMode(), this.winCondition());
    this.channel.lobby?.on("teamMode", handle);
    this.channel.lobby?.on("winCondition", handle);
    this.channel.lobby?.on("matchSettings", handle);
    this.channel.on("message", (message: any) => {
      if (message.user?.ircUsername?.toLowerCase() !== "banchobot") return;
      if (/^(Changed match settings to|Team mode:)/i.test(message.message)) {
        setTimeout(handle, 100);
      }
    });
  }
  onMessage(listener: (sender: Participant, text: string) => void) { this.channel.on("message", (m: any) => { const player = this.participant(m?.user, "Chat message"); if (player) listener(player, m.message); }); }
  onPlayerJoined(listener: (player: Participant) => void) { this.channel.lobby.on("playerJoined", (e: any) => { const player = this.participant(e?.player?.user, "Player join"); if (player) { if (e?.player?.team) player.team = e.player.team.toLowerCase() === "blue" ? "Blue" : "Red"; listener(player); } }); }
  onPlayerLeft(listener: (player: Participant) => void) { this.channel.lobby.on("playerLeft", (player: any) => { const participant = this.participant(player?.user, "Player leave"); if (participant) listener(participant); }); }
  onBeatmapChanged(listener: (beatmapId: number) => void) { this.channel.lobby.on("beatmapId", listener); }
  onTitleChanged(listener: (title: string) => void) {
    this.channel.lobby?.on("name", (name: string) => {
      if (this.channel.lobby) this.channel.lobby.name = name;
      listener(name);
    });
    // Some client-originated renames only arrive as a BanchoBot channel message.
    this.channel.on("message", (message: any) => {
      if (message.user?.ircUsername?.toLowerCase() !== "banchobot") return;
      const match = /^Room name updated to "(.+)"$/i.exec(message.message);
      if (match) {
        if (this.channel.lobby) this.channel.lobby.name = match[1];
        listener(match[1]);
      }
    });
  }
  onPasswordChanged(listener: () => void) {
    this.channel.lobby.on("passwordChanged", () => {
      if (!this.currentPassword) this.currentPassword = "[custom]";
      listener();
    });
    this.channel.lobby.on("passwordRemoved", () => {
      this.currentPassword = undefined;
      listener();
    });
  }
  onHostChanged(listener: (host?: Participant) => void) { this.channel.lobby.on("host", (player: any) => listener(player?.user ? this.participant(player.user, "Host change") : undefined)); }
  onAllPlayersReady(listener: () => void) {
    this.channel.lobby?.on("allPlayersReady", listener);
    this.channel.on("message", (message: any) => {
      if (message.user?.ircUsername?.toLowerCase() !== "banchobot") return;
      if (/^All players are ready/i.test(message.message)) {
        listener();
      }
    });
  }
  onMatchStarted(listener: () => void) {
    this.recentMisses.clear();
    this.channel.lobby.on("matchStarted", listener);
  }
  onMatchFinished(listener: (scores: RoomMatchScore[]) => void) {
    this.channel.lobby.on("matchFinished", (scores: any[]) => listener(scores.flatMap((score: any) => {
      const player = this.participant(score?.player?.user, "Match result");
      if (!player) return [];
      const userKey = player.username.toLowerCase();
      const rawMisses = score?.misses ?? score?.countMiss ?? score?.count_miss ?? score?.statistics?.count_miss;
      const parsedMisses = Number.isInteger(rawMisses)
        ? rawMisses
        : typeof rawMisses === "string" && !isNaN(Number(rawMisses))
        ? parseInt(rawMisses, 10)
        : this.recentMisses.get(userKey) ?? 0;
      const rawAcc = score?.accuracy;
      const parsedAcc = typeof rawAcc === "number" && !isNaN(rawAcc) ? rawAcc : 100.0;
      const rawCombo = score?.maxCombo ?? score?.combo;
      const parsedCombo = Number.isInteger(rawCombo) ? rawCombo : 0;

      return [{
        player,
        score: typeof score?.score === "number" && !isNaN(score.score) ? score.score : 0,
        team: score.player?.team ? (score.player.team.toLowerCase() as "red" | "blue") : undefined,
        pass: score.pass ?? true,
        misses: Math.max(0, parsedMisses),
        accuracy: parsedAcc,
        combo: Math.max(0, parsedCombo),
      }];
    })));
  }
  onClosed(listener: () => void) { this.channel.on("PART", (member: any) => { if (member?.user?.isClient?.()) listener(); }); }
  onActivity(listener: (activity: RoomActivity) => void) { this.activityListeners.add(listener); }
}

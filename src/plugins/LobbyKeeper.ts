import type { RoomActions } from "../adapters/bancho.js";
import type { LobbyConfig } from "../types.js";
import { normalizeMods } from "../lobby-controller.js";

export interface LobbyKeeperOptions {
  room: RoomActions;
  getConfig: () => LobbyConfig;
  getCurrentMinigame: () => { id?: string; teamMode: number; scoreMode: number; forcedMods?: string } | undefined;
  getCurrentForcedMods: () => string | undefined;
  logActivity?: (level: "info" | "error", message: string) => void;
}

export class LobbyKeeper {
  private isEnforcingTitle = false;
  private isEnforcingPassword = false;
  private isEnforcingSettings = false;
  private isEnforcingMods = false;

  private currentTitle?: string;
  private currentPassword?: string;
  private activeRoomMods = "";
  private activeFreemod = false;

  constructor(private options: LobbyKeeperOptions) {
    this.currentTitle = this.options.room.name?.() ?? this.options.getConfig().title;
    this.currentPassword = this.options.room.password?.() ?? this.options.getConfig().password;
  }

  /**
   * Binds real-time room listeners for title, password, settings, and mods.
   */
  bindListeners(): void {
    const { room } = this.options;

    room.onTitleChanged?.(title => {
      this.currentTitle = title;
      void this.enforceTitle(title);
    });

    room.onPasswordChanged?.(() => {
      this.currentPassword = room.password?.() ?? (this.currentPassword ? undefined : "[changed]");
      void this.enforcePassword();
    });

    room.onSettingsChanged?.((teamMode, winCondition) => {
      void this.enforceMatchSettings(teamMode, winCondition);
    });

    room.onModsChanged?.((mods, freemod) => {
      void this.enforceForcedMods(mods, freemod);
    });

    room.onPlayerJoined?.(() => {
      void this.validateRoomMetadata();
    });

    room.onPlayerLeft?.(() => {
      void this.validateRoomMetadata();
    });

    room.onHostChanged?.(() => {
      void this.validateRoomMetadata();
    });
  }

  async enforceTitle(title?: string): Promise<void> {
    if (this.isEnforcingTitle) return;
    const target = this.options.getConfig().title;
    if (!target) return;
    const current = title ?? this.options.room.name?.() ?? this.currentTitle;
    if (current === undefined || current === null) return;

    const cleanCurrentName = current.trim();
    const cleanTargetName = target.trim();

    if (cleanCurrentName !== cleanTargetName) {
      this.isEnforcingTitle = true;
      try {
        await this.options.room.command(`!mp name ${target}`);
        this.currentTitle = target;
        this.options.logActivity?.("info", `[LobbyKeeper] Restored room title: ${target}`);
      } finally {
        this.isEnforcingTitle = false;
      }
    }
  }

  async enforcePassword(password?: string): Promise<void> {
    if (this.isEnforcingPassword) return;
    const target = this.options.getConfig().password;
    const current = password ?? this.options.room.password?.() ?? this.currentPassword;

    const normalizedTarget = target || undefined;
    const normalizedCurrent = current || undefined;

    if (normalizedCurrent !== normalizedTarget) {
      this.isEnforcingPassword = true;
      try {
        await this.options.room.command(`!mp password ${target || ""}`);
        this.currentPassword = target;
        this.options.logActivity?.("info", target ? "[LobbyKeeper] Restored room password" : "[LobbyKeeper] Removed room password");
      } finally {
        this.isEnforcingPassword = false;
      }
    }
  }

  async enforceMatchSettings(teamMode?: number, winCondition?: number): Promise<void> {
    if (this.isEnforcingSettings) return;
    const minigame = this.options.getCurrentMinigame();
    if (!minigame) return;

    const currentTeam = teamMode ?? this.options.room.teamMode?.();
    const currentScore = winCondition ?? this.options.room.winCondition?.();
    if (currentTeam === undefined && currentScore === undefined) return;

    const targetTeam = minigame.teamMode;
    const targetScore = minigame.scoreMode;

    if ((currentTeam !== undefined && currentTeam !== targetTeam) ||
        (currentScore !== undefined && currentScore !== targetScore)) {
      this.isEnforcingSettings = true;
      try {
        await this.options.room.command(`!mp set ${targetTeam} ${targetScore}`);
        this.options.logActivity?.("info", `[LobbyKeeper] Restored match settings: team=${targetTeam}, score=${targetScore}`);
      } finally {
        this.isEnforcingSettings = false;
      }
    }
  }

  async enforceForcedMods(currentMods?: string[], isFreemod?: boolean): Promise<void> {
    if (this.isEnforcingMods) return;
    const minigame = this.options.getCurrentMinigame();
    const requiredMods = this.options.getCurrentForcedMods() ?? (minigame?.forcedMods || (minigame?.id === "boss-battle" ? "None" : undefined)) ?? (this.options.getConfig().locks.mods ? this.options.getConfig().mods.join(" ") : undefined);
    const targetNormalized = normalizeMods(requiredMods ?? "");

    const normalizedIncoming = normalizeMods(currentMods ?? this.options.room.mods?.() ?? []);
    const freemodActive = isFreemod !== undefined ? isFreemod : (this.options.room.freemod?.() ?? false);

    if (requiredMods) {
      if (normalizedIncoming === targetNormalized && !freemodActive) {
        this.activeRoomMods = targetNormalized;
        this.activeFreemod = false;
        return;
      }
      this.isEnforcingMods = true;
      this.activeRoomMods = targetNormalized;
      this.activeFreemod = false;
      try {
        await this.options.room.command(`!mp mods ${requiredMods}`);
        this.options.logActivity?.("info", `[LobbyKeeper] Re-applied forced mods: ${requiredMods}`);
      } finally {
        this.isEnforcingMods = false;
      }
    } else if (minigame) {
      if (freemodActive) {
        this.activeRoomMods = normalizedIncoming;
        this.activeFreemod = true;
        return;
      }
      this.isEnforcingMods = true;
      this.activeRoomMods = "";
      this.activeFreemod = true;
      try {
        await this.options.room.command("!mp mods freemod");
        this.options.logActivity?.("info", "[LobbyKeeper] Re-applied freemod");
      } finally {
        this.isEnforcingMods = false;
      }
    }
  }

  async validateRoomMetadata(): Promise<void> {
    await this.enforceTitle();
    await this.enforcePassword();
  }

  getActiveRoomMods(): string {
    return this.activeRoomMods;
  }

  isFreemodActive(): boolean {
    return this.activeFreemod;
  }

  syncActiveMods(mods: string, freemod: boolean): void {
    this.activeRoomMods = normalizeMods(mods);
    this.activeFreemod = freemod;
  }
}


import type { RoomActions } from "../adapters/bancho.js";

export interface MatchStarterOptions {
  room: RoomActions;
  isMatchActive: () => boolean;
  onAutoStart: (mapId: number) => Promise<void>;
  onClearTimers?: () => void;
  preStartEnforcement?: () => Promise<void>;
  getTargetTitle?: () => string | undefined;
  getCurrentMinigame?: () => { id?: string; teamMode?: number; scoreMode?: number; forcedMods?: string } | undefined;
  logActivity?: (level: "info" | "error", message: string) => void;
}

export class MatchStarter {
  private isStarting = false;

  constructor(private options: MatchStarterOptions) {}

  bindListeners(): void {
    this.options.room.onAllPlayersReady?.(() => {
      void this.triggerAutoStart();
    });
  }

  async triggerAutoStart(): Promise<void> {
    const mapId = this.options.room.beatmapId();
    if (!mapId || this.options.isMatchActive() || this.isStarting) return;

    this.isStarting = true;
    try {
      this.options.onClearTimers?.();
      if (this.options.preStartEnforcement) {
        await this.options.preStartEnforcement();
      } else if (this.options.getCurrentMinigame || this.options.getTargetTitle) {
        await this.enforcePreFlightRules();
      }
      this.options.logActivity?.("info", `[MatchStarter] All players ready, launching match on map ${mapId}`);
      await this.options.onAutoStart(mapId);
    } finally {
      this.isStarting = false;
    }
  }

  async enforcePreFlightRules(): Promise<void> {
    const targetTitle = this.options.getTargetTitle?.();
    if (targetTitle) {
      const currentTitle = this.options.room.name?.();
      const cleanTarget = targetTitle.trim();
      const cleanCurrent = (currentTitle ?? "").trim();
      if (cleanCurrent !== cleanTarget) {
        await this.options.room.command(`!mp name ${targetTitle}`);
      }
    }

    const minigame = this.options.getCurrentMinigame?.();
    if (!minigame) return;

    const forcedMods = minigame.forcedMods || (minigame.id === "boss-battle" ? "None" : undefined);
    if (forcedMods) {
      await this.options.room.command(`!mp mods ${forcedMods}`);
    }
    const teamMode = minigame.teamMode ?? 0;
    const scoreMode = minigame.scoreMode ?? 3;
    await this.options.room.command(`!mp set ${teamMode} ${scoreMode}`);
  }
}


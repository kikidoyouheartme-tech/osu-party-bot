import type { MinigameDefinition } from "./party-minigames.js";

export interface RoundLifecycleState {
  automatedBeatmapId?: number;
  lastValidMapId?: number;
  currentForcedMods?: string;
  targetAccuracy?: number;
  wasHostMapPick: boolean;
}

/**
 * Resets all round-specific map, override, and minigame states
 * so that automated forced maps or rules never leak into subsequent rounds.
 */
export function resetRoundLifecycleState(): RoundLifecycleState {
  return {
    automatedBeatmapId: undefined,
    lastValidMapId: undefined,
    currentForcedMods: undefined,
    targetAccuracy: undefined,
    wasHostMapPick: true,
  };
}

/**
 * Determines whether a minigame pick should completely bypass
 * standard lobby regulations (SR, length, BPM, etc.).
 * Automated/locked picks bypass, while host picks enforce regulations.
 */
export function shouldBypassRegulations(minigame?: MinigameDefinition | { mapPicker: string }): boolean {
  if (!minigame) return false;
  return minigame.mapPicker !== "host";
}


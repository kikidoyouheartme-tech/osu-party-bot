import type { OsuApi } from "../adapters/osu.js";
import { getRandomTag2MapId } from "../data/tag2-maps.js";
import { getRandomTag4MapId } from "../data/tag4-maps.js";
import { getRandomCommunityChoiceMap } from "../data/community-choice-maps.js";
import { getRandomRankedRewindMap } from "../data/ranked-rewind-maps.js";
import { getRandomLovedClassicsMap } from "../data/loved-classics-maps.js";
import type { MapPickerStrategy } from "./party-minigames.js";

export interface PickedMapResult {
  beatmapId: number;
  overrideMods?: string;
  announcement: string;
}

export async function resolveMinigameMap(
  strategy: MapPickerStrategy,
  options: {
    hostId?: number;
    hostUsername?: string;
    playerCount: number;
    osu: OsuApi;
  }
): Promise<PickedMapResult | null> {
  const { hostId, hostUsername, playerCount, osu } = options;
  const api = osu as any;

  switch (strategy) {
    case "bot_tag": {
      const beatmapId = playerCount <= 2 ? getRandomTag2MapId() : getRandomTag4MapId();
      return {
        beatmapId,
        announcement: `Relay Race Tag map selected for ${playerCount} players.`,
      };
    }

    case "bot_pool_community_choice": {
      const selection = getRandomCommunityChoiceMap();
      return {
        beatmapId: selection.beatmapId,
        announcement: `Community Choice Rewind: ${selection.year} Map of the Year.`,
      };
    }

    case "bot_pool_ranked_rewind": {
      const selection = getRandomRankedRewindMap();
      return {
        beatmapId: selection.map.beatmapId,
        announcement: `Ranked Rewind: Classic from ${selection.year}.`,
      };
    }

    case "bot_pool_loved_classics": {
      const selection = getRandomLovedClassicsMap();
      return {
        beatmapId: selection.map.beatmapId,
        announcement: `Loved Classics: Community favorite from ${selection.year}.`,
      };
    }

    case "bot_api_host_top": {
      let resolvedHostId = hostId;
      if (!resolvedHostId && hostUsername) {
        try {
          const user = await api.user(hostUsername);
          if (user?.id) resolvedHostId = user.id;
        } catch {
          return null;
        }
      }
      if (!resolvedHostId) return null;
      try {
        const topScores = await api.userBestScores(resolvedHostId, 1);
        if (!topScores || topScores.length === 0) return null;
        const topPlay = topScores[0];
        const rawMods = (topPlay.mods ?? [])
          .map((m: any) => (typeof m === "string" ? m : m.acronym ?? ""))
          .filter((m: string) => Boolean(m) && m.toUpperCase() !== "NF");
        const forced = [...new Set(rawMods)].join(" ");
        const beatmapId = topPlay.beatmap_id ?? topPlay.beatmap?.id;
        if (!beatmapId) return null;
        return {
          beatmapId,
          ...(forced ? { overrideMods: forced } : {}),
          announcement: `Boss Battle: ${hostUsername}'s #1 top score loaded (${forced || "NM"}).`,
        };
      } catch {
        return null;
      }
    }

    case "bot_api_host_most_played": {
      let resolvedHostId = hostId;
      if (!resolvedHostId && hostUsername) {
        try {
          const user = await api.user(hostUsername);
          if (user?.id) resolvedHostId = user.id;
        } catch {
          return null;
        }
      }
      if (!resolvedHostId) return null;
      try {
        const mostPlayed = await api.userMostPlayed(resolvedHostId, 1);
        if (!mostPlayed || mostPlayed.length === 0) return null;
        const item = mostPlayed[0];
        const beatmapId = item.beatmap_id ?? item.beatmap?.id;
        if (!beatmapId) return null;
        return {
          beatmapId,
          announcement: `Host's Addiction: ${hostUsername}'s most played beatmap loaded.`,
        };
      } catch {
        return null;
      }
    }

    case "host":
    default:
      return null;
  }
}
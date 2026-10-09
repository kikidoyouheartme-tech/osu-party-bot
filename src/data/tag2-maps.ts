export const TAG2_MAP_IDS: number[] = [
    3213389,
    3100560,
    48874,
    772248,
    3682210,
  ];
  
  /**
   * Returns a random TAG2 beatmap ID for 2-player lobbies.
   */
  export function getRandomTag2MapId(): number {
    const index = Math.floor(Math.random() * TAG2_MAP_IDS.length);
    return TAG2_MAP_IDS[index];
  }
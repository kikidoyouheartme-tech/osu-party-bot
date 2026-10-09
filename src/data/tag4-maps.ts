export const TAG4_MAP_IDS: number[] = [
  87570,
  24722,
  3563097,
  58064,
  27638,
  35015,
  29844,
  1502221,
  196977,
  4886186,
];

export function getRandomTag4MapId(): number {
  return TAG4_MAP_IDS[Math.floor(Math.random() * TAG4_MAP_IDS.length)];
}
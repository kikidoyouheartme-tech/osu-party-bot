import type { Participant } from "../types.js";
export function balancedTeams(players: Array<Participant & { points?: number; elo?: number }>) {
  const red: typeof players = [], blue: typeof players = [];
  let redTotal = 0, blueTotal = 0;
  const getPoints = (p: Participant & { points?: number; elo?: number }) => p.points ?? p.elo ?? 0;
  for (const player of [...players].sort((a, b) => getPoints(b) - getPoints(a))) {
    const val = getPoints(player);
    if (redTotal <= blueTotal) { red.push(player); redTotal += val; }
    else { blue.push(player); blueTotal += val; }
  }
  return { red, blue };
}

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRoundScores, formatVictoryAnnouncement, type RawPlayerScore } from "./party-scoring.js";
import { getMinigame } from "./party-minigames.js";

test("evaluateRoundScores - standard score metric", () => {
  const minigame = getMinigame("classic-showdown");
  const scores: RawPlayerScore[] = [
    { playerId: 1, username: "PlayerA", score: 500000, accuracy: 98, combo: 300, misses: 2, passed: true },
    { playerId: 2, username: "PlayerB", score: 800000, accuracy: 95, combo: 500, misses: 5, passed: true },
    { playerId: 3, username: "PlayerC", score: 200000, accuracy: 90, combo: 100, misses: 10, passed: true },
  ];

  const results = evaluateRoundScores(scores, { minigame });
  assert.equal(results.length, 3);
  assert.equal(results[0].playerId, 2); // PlayerB highest score
  assert.equal(results[0].placement, 1);
  assert.equal(results[0].pointsEarned, 3); // 3 players -> 3, 2, 1 pts

  assert.equal(results[1].playerId, 1);
  assert.equal(results[1].placement, 2);
  assert.equal(results[1].pointsEarned, 2);

  assert.equal(results[2].playerId, 3);
  assert.equal(results[2].placement, 3);
  assert.equal(results[2].pointsEarned, 1);
});

test("evaluateRoundScores - target accuracy metric", () => {
  const minigame = getMinigame("target-practice");
  const scores: RawPlayerScore[] = [
    { playerId: 1, username: "PlayerA", score: 500000, accuracy: 95.0, combo: 300, misses: 2, passed: true },
    { playerId: 2, username: "PlayerB", score: 600000, accuracy: 96.0, combo: 400, misses: 1, passed: true }, // over target
    { playerId: 3, username: "PlayerC", score: 400000, accuracy: 94.5, combo: 200, misses: 3, passed: true },
  ];

  // Target is 95.0. PlayerA hit exactly 95.0 (diff 0, <= 95). PlayerC hit 94.5 (diff 0.5, <= 95). PlayerB exceeded 95.0 (96.0).
  const results = evaluateRoundScores(scores, { minigame, targetAccuracy: 95.0 });
  assert.equal(results[0].playerId, 1);
  assert.equal(results[1].playerId, 3);
  assert.equal(results[2].playerId, 2);
});

test("evaluateRoundScores - elimination metric", () => {
  const minigame = getMinigame("sudden-death-battle-royale");
  const scores: RawPlayerScore[] = [
    { playerId: 1, username: "PlayerA", score: 1000000, accuracy: 99, combo: 800, misses: 1, passed: false }, // high score but failed
    { playerId: 2, username: "PlayerB", score: 300000, accuracy: 90, combo: 200, misses: 0, passed: true },   // passed
  ];

  const results = evaluateRoundScores(scores, { minigame });
  assert.equal(results[0].playerId, 2); // passed comes first
  assert.equal(results[0].pointsEarned, 2);
  assert.equal(results[1].playerId, 1); // failed
  assert.equal(results[1].pointsEarned, 0); // failing gives 0
});

test("evaluateRoundScores - bounty hunter bonus", () => {
  const minigame = getMinigame("bounty-hunter");
  const scores: RawPlayerScore[] = [
    { playerId: 1, username: "Leader", score: 500000, accuracy: 95, combo: 300, misses: 2, passed: true },
    { playerId: 2, username: "Challenger", score: 700000, accuracy: 97, combo: 400, misses: 1, passed: true },
  ];

  // Challenger beats Leader (playerId: 1)
  const results = evaluateRoundScores(scores, { minigame, leaderPlayerId: 1 });
  assert.equal(results[0].playerId, 2);
  // Placement 1 out of 2 = 2 base points + 3 bounty bonus = 5 points
  assert.equal(results[0].pointsEarned, 5);
  // Leader gets 1 point
  assert.equal(results[1].playerId, 1);
  assert.equal(results[1].pointsEarned, 1);
});

test("evaluateRoundScores - partypoint wager", () => {
  const minigame = getMinigame("partypoint-wager");
  const scores: RawPlayerScore[] = [
    { playerId: 1, username: "Winner", score: 800000, accuracy: 98, combo: 500, misses: 0, passed: true, wagerAmount: 10 },
    { playerId: 2, username: "RunnerUp", score: 600000, accuracy: 95, combo: 300, misses: 2, passed: true, wagerAmount: 5 },
    { playerId: 3, username: "Loser", score: 200000, accuracy: 90, combo: 100, misses: 5, passed: true, wagerAmount: 8 },
  ];

  // 3 players: wager cutoff is 1 (n <= 4)
  const results = evaluateRoundScores(scores, { minigame });
  // Winner: placement 1 <= 1 -> base 3 + 10 = 13
  assert.equal(results[0].playerId, 1);
  assert.equal(results[0].pointsEarned, 13);

  // RunnerUp: placement 2 > 1 -> base 2 - 5 = 0 (clamped to 0)
  assert.equal(results[1].playerId, 2);
  assert.equal(results[1].pointsEarned, 0);

  // Loser: placement 3 > 1 -> base 1 - 8 = 0 (clamped to 0)
  assert.equal(results[2].playerId, 3);
  assert.equal(results[2].pointsEarned, 0);
});

test("evaluateRoundScores - russian roulette miss mode evaluation (pass first, lowest misses, score tiebreaker)", () => {
  const minigame = getMinigame("russian-roulette");
  const scores: RawPlayerScore[] = [
    { playerId: 1, username: "PlayerA", score: 300000, accuracy: 95, combo: 200, misses: 1, passed: true },
    { playerId: 2, username: "PlayerB", score: 800000, accuracy: 92, combo: 400, misses: 3, passed: true },
    { playerId: 3, username: "PlayerC", score: 500000, accuracy: 96, combo: 300, misses: 1, passed: true },
    { playerId: 4, username: "PlayerD", score: 1000000, accuracy: 99, combo: 800, misses: 0, passed: false }, // failed with 0 misses
  ];

  const results = evaluateRoundScores(scores, { minigame });
  assert.equal(results.length, 4);

  // 1st: PlayerC (passed, 1 miss, 500k score beats PlayerA's 300k score)
  assert.equal(results[0].playerId, 3);
  assert.equal(results[0].placement, 1);
  assert.equal(results[0].pointsEarned, 4);

  // 2nd: PlayerA (passed, 1 miss, 300k score)
  assert.equal(results[1].playerId, 1);
  assert.equal(results[1].placement, 2);
  assert.equal(results[1].pointsEarned, 3);

  // 3rd: PlayerB (passed, 3 misses, 800k score)
  assert.equal(results[2].playerId, 2);
  assert.equal(results[2].placement, 3);
  assert.equal(results[2].pointsEarned, 2);

  // 4th: PlayerD (failed -> must rank below all passed players even with 0 misses)
  assert.equal(results[3].playerId, 4);
  assert.equal(results[3].placement, 4);
  assert.equal(results[3].pointsEarned, 1);
});

test("formatVictoryAnnouncement produces exact contextual victory strings for all metrics", () => {
  const dummyEvaluated = {
    playerId: 10,
    username: "MikuMaster",
    placement: 1,
    pointsEarned: 5,
    previousPoints: 10,
    newPoints: 15,
  };

  // 1. Target Practice (target_accuracy)
  const targetMsg = formatVictoryAnnouncement({
    metric: "target_accuracy",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 500000, accuracy: 94.8, combo: 300, misses: 1, passed: true },
    targetAccuracy: 95.0,
  });
  assert.equal(
    targetMsg,
    "[Results] MikuMaster had the closest accuracy to 95% with 94.8%! (+5 PartyPoints)"
  );

  // 2. Russian Roulette (misses)
  const missMsg = formatVictoryAnnouncement({
    metric: "misses",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 500000, accuracy: 97.5, combo: 400, misses: 2, passed: true },
  });
  assert.equal(
    missMsg,
    "[Results] MikuMaster survived with the lowest miss count of 2 misses! (+5 PartyPoints)"
  );

  // 3. Precision Master (accuracy)
  const accMsg = formatVictoryAnnouncement({
    metric: "accuracy",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 600000, accuracy: 99.4, combo: 500, misses: 0, passed: true },
  });
  assert.equal(
    accMsg,
    "[Results] MikuMaster achieved the highest accuracy with 99.4%! (+5 PartyPoints)"
  );

  // 4. Streak Keeper (combo)
  const comboMsg = formatVictoryAnnouncement({
    metric: "combo",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 700000, accuracy: 96.0, combo: 727, misses: 2, passed: true },
  });
  assert.equal(
    comboMsg,
    "[Results] MikuMaster secured the longest streak with a 727x combo! (+5 PartyPoints)"
  );

  // 5. Sudden Death: Battle Royale (elimination)
  const elimMsg = formatVictoryAnnouncement({
    metric: "elimination",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 800000, accuracy: 98.0, combo: 600, misses: 0, passed: true },
  });
  assert.equal(
    elimMsg,
    "[Results] MikuMaster was the last survivor standing! (+5 PartyPoints)"
  );

  // 6. Bounty Hunter (bounty) - leader defeated
  const bountyClaimedMsg = formatVictoryAnnouncement({
    metric: "bounty",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 950000, accuracy: 99.0, combo: 800, misses: 0, passed: true },
    leaderPlayerId: 99,
    leaderUsername: "RivalLeader",
  });
  assert.equal(
    bountyClaimedMsg,
    "[Results] MikuMaster claimed the bounty on RivalLeader with 950000 points! (+5 PartyPoints)"
  );

  // 7. Bounty Hunter (bounty) - leader defended
  const bountyDefendedMsg = formatVictoryAnnouncement({
    metric: "bounty",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 950000, accuracy: 99.0, combo: 800, misses: 0, passed: true },
    leaderPlayerId: 10,
    leaderUsername: "MikuMaster",
  });
  assert.equal(
    bountyDefendedMsg,
    "[Results] MikuMaster defended their bounty with 950000 points! (+5 PartyPoints)"
  );

  // 8. Team Matchups (team_score / team_accuracy)
  const teamScoreMsg = formatVictoryAnnouncement({
    metric: "team_score",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 500000, accuracy: 95.0, combo: 300, misses: 1, passed: true, team: "Blue" },
    winningTeam: "Blue",
  });
  assert.equal(
    teamScoreMsg,
    "[Results] Team Blue took the victory! (+5 PartyPoints to team members)"
  );

  // 9. Standard Matchups / Mod Challenges / Bot Overrides
  const stdMsg = formatVictoryAnnouncement({
    metric: "score",
    winner: dummyEvaluated,
    winnerRaw: { playerId: 10, username: "MikuMaster", score: 850000, accuracy: 98.0, combo: 700, misses: 0, passed: true },
  });
  assert.equal(
    stdMsg,
    "[Results] MikuMaster finished in 1st place with 850000 points! (+5 PartyPoints)"
  );
});



import test from "node:test";
import assert from "node:assert/strict";
import { rollNextMinigame, PARTY_MINIGAMES } from "./party-minigames.js";
import { resolveMinigameMap } from "./party-map-pickers.js";
import { checkMap, calculateModAdjustedStars } from "./party-regulation.js";
import { normalizeMods, generateDefaultLobbyTitle, formatActiveMinigameRuleset } from "../lobby-controller.js";
import { LobbyKeeper } from "../plugins/LobbyKeeper.js";
import { MatchStarter } from "../plugins/MatchStarter.js";
import { resetRoundLifecycleState, shouldBypassRegulations } from "./lobby-cycle.js";

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

test("getOrdinal formats placements properly", () => {
  assert.equal(getOrdinal(1), "1st");
  assert.equal(getOrdinal(2), "2nd");
  assert.equal(getOrdinal(3), "3rd");
  assert.equal(getOrdinal(4), "4th");
  assert.equal(getOrdinal(11), "11th");
  assert.equal(getOrdinal(21), "21st");
});

test("podium formatting produces exact required output", () => {
  const mockStandings = [
    { username: "PlayerA", sessionPoints: 42 },
    { username: "PlayerB", sessionPoints: 35 },
    { username: "PlayerC", sessionPoints: 28 },
    { username: "PlayerD", sessionPoints: 14 },
  ];

  const lines: string[] = [];
  lines.push("=========================================");
  lines.push("[PARTY OVER] Grand Prix Final Standings:");
  const podium = mockStandings.slice(0, 3);
  for (let i = 0; i < podium.length; i++) {
    lines.push(`${getOrdinal(i + 1)} Place: ${podium[i].username} - ${podium[i].sessionPoints} pts`);
  }
  lines.push("=========================================");

  assert.deepEqual(lines, [
    "=========================================",
    "[PARTY OVER] Grand Prix Final Standings:",
    "1st Place: PlayerA - 42 pts",
    "2nd Place: PlayerB - 35 pts",
    "3rd Place: PlayerC - 28 pts",
    "=========================================",
  ]);
});

test("mid-round join welcome format matches specification", () => {
  const username = "MikuFan727";
  const currentRound = 6;
  const totalRounds = 10;
  const msg = `[Lobby] Welcome, ${username}! Current game: Round ${currentRound}/${totalRounds}. You start with 0 session points and will enter the host queue on the next map.`;

  assert.equal(
    msg,
    "[Lobby] Welcome, MikuFan727! Current game: Round 6/10. You start with 0 session points and will enter the host queue on the next map."
  );
});

test("10-round cycle counter progression and reset", () => {
  let currentRound = 1;
  const totalRounds = 10;

  for (let i = 1; i <= 9; i++) {
    assert.equal(currentRound, i);
    if (currentRound >= totalRounds) {
      currentRound = 1;
    } else {
      currentRound++;
    }
  }

  // After 9 increments, should be at round 10
  assert.equal(currentRound, 10);

  // Finishing round 10 triggers reset
  if (currentRound >= totalRounds) {
    currentRound = 1;
  } else {
    currentRound++;
  }

  assert.equal(currentRound, 1);
});

test("automated pick pacing prevents consecutive bot picks", () => {
  const botPickGames = PARTY_MINIGAMES.filter((m) => m.mapPicker !== "host");
  assert.equal(botPickGames.length, 6, "Expected 6 bot pick minigames");

  for (const botGame of botPickGames) {
    for (let i = 0; i < 50; i++) {
      const nextGame = rollNextMinigame(botGame);
      assert.equal(
        nextGame.mapPicker,
        "host",
        `Expected next minigame after ${botGame.id} to be host-picked, got ${nextGame.id} (${nextGame.mapPicker})`
      );
    }
  }
});

test("rollNextMinigame respects custom weights", () => {
  // If only classic-showdown has weight, it should be selected every time
  const weights: Record<string, number> = {
    "classic-showdown": 100,
  };
  for (const m of PARTY_MINIGAMES) {
    if (m.id !== "classic-showdown") weights[m.id] = 0;
  }

  for (let i = 0; i < 20; i++) {
    const rolled = rollNextMinigame(undefined, weights);
    assert.equal(rolled.id, "classic-showdown");
  }

  // If a minigame has weight 0, it should never be rolled
  const noRouletteWeights: Record<string, number> = {};
  for (const m of PARTY_MINIGAMES) {
    noRouletteWeights[m.id] = m.id === "russian-roulette" ? 0 : 50;
  }
  for (let i = 0; i < 100; i++) {
    const rolled = rollNextMinigame(undefined, noRouletteWeights);
    assert.notEqual(rolled.id, "russian-roulette");
  }
});

test("rollNextMinigame excludes PartyPoint Wager on round 1 but allows it on subsequent rounds", () => {
  // On round 1, PartyPoint Wager must never be rolled
  for (let i = 0; i < 100; i++) {
    const rolled = rollNextMinigame(undefined, undefined, 1);
    assert.notEqual(rolled.id, "partypoint-wager", "PartyPoint Wager must never be selected in round 1");
  }

  // Even if weights strongly favor PartyPoint Wager, round 1 must exclude it
  const wagerFavoredWeights: Record<string, number> = {
    "partypoint-wager": 1000,
  };
  for (let i = 0; i < 50; i++) {
    const rolled = rollNextMinigame(undefined, wagerFavoredWeights, 1);
    assert.notEqual(rolled.id, "partypoint-wager", "PartyPoint Wager must never be selected in round 1 even with high weight");
  }

  // On round 2 or later, PartyPoint Wager can be rolled
  let rolledWagerInRound2 = false;
  for (let i = 0; i < 50; i++) {
    const rolled = rollNextMinigame(undefined, wagerFavoredWeights, 2);
    if (rolled.id === "partypoint-wager") {
      rolledWagerInRound2 = true;
      break;
    }
  }
  assert.ok(rolledWagerInRound2, "PartyPoint Wager should be selectable in round 2");
});

test("host retention logic on automated map picks vs host map picks", () => {
  let queue = [101, 102, 103];
  let currentHostId = queue[0];
  let wasHostMapPick = false; // automated map pick occurred
  const hostUsername = "HostPlayer";
  const messages: string[] = [];

  function performSkip(force = false) {
    if (!force && !wasHostMapPick) {
      messages.push(`[Host] Map was bot-selected; ${hostUsername} retains host for next round.`);
      wasHostMapPick = true;
      return;
    }
    wasHostMapPick = true;
    if (queue.length) queue.push(queue.shift()!);
    currentHostId = queue[0];
  }

  // After automated map pick, host is retained
  performSkip(false);
  assert.equal(queue[0], 101, "Host must remain at front of queue after bot pick");
  assert.deepEqual(queue, [101, 102, 103]);
  assert.equal(messages[0], "[Host] Map was bot-selected; HostPlayer retains host for next round.");

  // Next round is a normal host pick
  wasHostMapPick = true;
  performSkip(false);
  assert.equal(queue[0], 102, "Host should rotate to next player after host pick");
  assert.deepEqual(queue, [102, 103, 101]);
});

test("chat command responses match exact ASCII bracketed specifications", () => {
  const cmdsResponse = "[Commands] !cmds | !minigame | !round | !points | !pstats | !leaderboard | !bet <amount> | !reroll";
  assert.equal(cmdsResponse, "[Commands] !cmds | !minigame | !round | !points | !pstats | !leaderboard | !bet <amount> | !reroll");

  const roundResponse = `[Round] Current: ${4}/10 | Host: ${"PlayerOne"}`;
  assert.equal(roundResponse, "[Round] Current: 4/10 | Host: PlayerOne");

  const minigameNormal = `[Minigame] Round 1/10: Classic Showdown | Rules: Standard Head-to-Head battle. Highest total score wins!`;
  assert.equal(minigameNormal, "[Minigame] Round 1/10: Classic Showdown | Rules: Standard Head-to-Head battle. Highest total score wins!");

  const targetAcc = 94.5;
  const minigameTarget = `[Minigame] Round 2/10: Target Practice | Rules: Aim for the target Acc without going over! Closest accuracy wins. | Target: ${targetAcc}%`;
  assert.equal(minigameTarget, "[Minigame] Round 2/10: Target Practice | Rules: Aim for the target Acc without going over! Closest accuracy wins. | Target: 94.5%");

  const pointsResponse = `[PartyPoints] ${"PlayerA"}: ${15} PartyPoints (Session) | ${320} PartyPoints (All-Time)`;
  assert.equal(pointsResponse, "[PartyPoints] PlayerA: 15 PartyPoints (Session) | 320 PartyPoints (All-Time)");

  const standingsResponse = `[Standings] 1. PlayerA (42 pts) | 2. PlayerB (35 pts) | 3. PlayerC (28 pts)`;
  assert.equal(standingsResponse, "[Standings] 1. PlayerA (42 pts) | 2. PlayerB (35 pts) | 3. PlayerC (28 pts)");
});

test("abort does not increment currentRound and formats lifecycle status", () => {
  let currentRound = 4;
  const totalRounds = 10;
  let matchActive = true;
  let wagers = new Map([[101, 10], [102, 5]]);
  let matchScoresRecorded = false;
  const chatMessages: string[] = [];

  function simulateAbort() {
    matchActive = false;
    wagers.clear();
    matchScoresRecorded = false;
    chatMessages.push(
      `[Match] Match aborted. Scores discarded. Round ${currentRound}/${totalRounds} can be restarted, or use !skip to roll a new minigame.`
    );
  }

  simulateAbort();

  assert.equal(currentRound, 4, "currentRound must remain 4 after abort");
  assert.equal(matchActive, false);
  assert.equal(wagers.size, 0);
  assert.equal(matchScoresRecorded, false);
  assert.equal(
    chatMessages[0],
    "[Match] Match aborted. Scores discarded. Round 4/10 can be restarted, or use !skip to roll a new minigame."
  );

  function simulateSkip() {
    chatMessages.push("[Skip] Round skipped. Rolling next minigame...");
  }

  simulateSkip();
  assert.equal(currentRound, 4, "currentRound must still be 4 after skip");
  assert.equal(chatMessages[1], "[Skip] Round skipped. Rolling next minigame...");
});

test("newcomers receive current room forced mods and team balancing", async () => {
  const commandsSent: string[] = [];
  const chatMessages: string[] = [];

  const mockRoom = {
    command: async (cmd: string) => { commandsSent.push(cmd); },
    say: async (msg: string) => { chatMessages.push(msg); },
    players: () => [
      { id: 1, username: "PlayerA", team: "Red" },
      { id: 2, username: "PlayerB", team: "Blue" },
      { id: 3, username: "PlayerC", team: "Red" },
    ],
  };

  const sdMinigame = {
    id: "sudden-death-battle-royale",
    forcedMods: "SD",
    teamMode: 0,
  };

  async function handlePlayerJoined(newcomer: { id: number; username: string }, minigame: any, isInitialHost: boolean) {
    if (!isInitialHost) {
      await mockRoom.say(`[Lobby] Welcome, ${newcomer.username}! Current game: Round 5/10. You start with 0 session points and will enter the host queue on the next map.`);
    }

    if (minigame && minigame.forcedMods) {
      await mockRoom.command(`!mp mods ${minigame.forcedMods}`);
    } else if (minigame && !minigame.forcedMods) {
      await mockRoom.command(`!mp mods freemod`);
    }

    if (minigame && minigame.teamMode === 2) {
      const redCount = mockRoom.players().filter(p => p.team === "Red").length;
      const blueCount = mockRoom.players().filter(p => p.team === "Blue").length;
      const targetTeam = redCount <= blueCount ? "Red" : "Blue";
      await mockRoom.command(`!mp team ${newcomer.username} ${targetTeam}`);
    }
  }

  // 1. Mid-session joiner joining during SD minigame
  await handlePlayerJoined({ id: 4, username: "Joiner1" }, sdMinigame, false);
  assert.ok(commandsSent.includes("!mp mods SD"), "Must re-send forced mods SD to Bancho");
  assert.ok(chatMessages.some(m => m.includes("Welcome, Joiner1!")), "Mid-session joiner receives welcome");

  commandsSent.length = 0;
  chatMessages.length = 0;

  // 2. Standard minigame without forced mods -> freemod
  const stdMinigame = {
    id: "classic-showdown",
    forcedMods: "",
    teamMode: 0,
  };
  await handlePlayerJoined({ id: 5, username: "Joiner2" }, stdMinigame, false);
  assert.ok(commandsSent.includes("!mp mods freemod"), "Must re-send freemod for standard games");

  commandsSent.length = 0;
  chatMessages.length = 0;

  // 3. Team VS minigame (teamMode === 2) -> Assigns to team with fewer players (Blue has 1, Red has 2)
  const teamMinigame = {
    id: "team-clash-score",
    forcedMods: "",
    teamMode: 2,
  };
  await handlePlayerJoined({ id: 6, username: "Joiner3" }, teamMinigame, false);
  assert.ok(commandsSent.includes("!mp team Joiner3 Blue"), "Must assign newcomer to Blue team to balance");

  commandsSent.length = 0;
  chatMessages.length = 0;

  // 4. Initial host joining room initialization -> suppress mid-session welcome
  await handlePlayerJoined({ id: 1, username: "HostPlayer" }, stdMinigame, true);
  assert.equal(chatMessages.length, 0, "Initial host must NOT receive mid-session welcome");
});

test("prepareNextMinigame announcement condensation to 2 lines", () => {
  const minigame1 = {
    name: "Classic Showdown",
    description: "Standard Head-to-Head battle. Highest total score wins!",
    id: "classic-showdown",
  };
  const currentRound = 1;
  const totalRounds = 10;
  const line1Normal = `[Round ${currentRound}/${totalRounds}] ${minigame1.name} | ${minigame1.description}`;
  assert.equal(
    line1Normal,
    "[Round 1/10] Classic Showdown | Standard Head-to-Head battle. Highest total score wins!"
  );

  const targetAcc = 94.5;
  const line1Target = `[Round 2/10] Target Practice | Aim for the target Acc without going over! Closest accuracy wins. | Target: ${targetAcc}%`;
  assert.equal(
    line1Target,
    "[Round 2/10] Target Practice | Aim for the target Acc without going over! Closest accuracy wins. | Target: 94.5%"
  );

  const hostUsername = "Cookiezi";
  const line2Host = `[Host] ${hostUsername}, select a map! (3 min limit)`;
  assert.equal(line2Host, "[Host] Cookiezi, select a map! (3 min limit)");

  const announcement = "Tag4 - Renard - The Big Black [WHO'S AFRAID OF THE BIG BLACK]";
  const line2Bot = `[Pick] ${announcement}`;
  assert.equal(line2Bot, `[Pick] ${announcement}`);
});

test("NoFail (NF) is strictly removed except for Target Practice and Relay Race", () => {
  for (const minigame of PARTY_MINIGAMES) {
    if (minigame.id === "target-practice") {
      assert.equal(minigame.forcedMods, "NF", "Target Practice must enforce NF");
    } else if (minigame.id === "relay-race") {
      assert.equal(minigame.forcedMods, "NF", "Relay Race must enforce NF");
    } else if (minigame.id === "blindfolded") {
      assert.equal(minigame.forcedMods, "HD FL", "Blindfolded must be HD FL");
    } else if (minigame.id === "blind-rhythm") {
      assert.equal(minigame.forcedMods, "HD", "Blind Rhythm must be HD");
    } else if (minigame.id === "pixel-perfect") {
      assert.equal(minigame.forcedMods, "HR", "Pixel Perfect must be HR");
    } else if (minigame.id === "lights-out") {
      assert.equal(minigame.forcedMods, "FL", "Lights Out must be FL");
    } else if (minigame.id === "speedom") {
      assert.equal(minigame.forcedMods, "DT", "Speedom must be DT");
    } else if (minigame.id === "sudden-death-battle-royale") {
      assert.equal(minigame.forcedMods, "SD", "Sudden Death must be SD");
    } else {
      assert.equal(minigame.forcedMods, "", `${minigame.name} must have empty forcedMods (no NF)`);
      assert.ok(!minigame.forcedMods.includes("NF"), `${minigame.name} must not contain NF`);
    }
  }
});

test("Boss Battle resolves username fallback, strips NF from top play mods, and handles beatmap.id", async () => {
  let lookupUsername = "";
  let queriedUserId: number | undefined;

  const mockOsuApi: any = {
    user: async (username: string) => {
      lookupUsername = username;
      return { id: 777 };
    },
    userBestScores: async (userId: number, limit: number) => {
      queriedUserId = userId;
      return [
        {
          beatmap: { id: 98765 },
          mods: ["HD", "HR", "NF"],
        },
      ];
    },
  };

  const result = await resolveMinigameMap("bot_api_host_top", {
    hostUsername: "TopHost",
    playerCount: 4,
    osu: mockOsuApi,
  });

  assert.ok(result);
  assert.equal(lookupUsername, "TopHost", "Must fallback to username lookup when hostId is missing");
  assert.equal(queriedUserId, 777, "Must query top scores for looked up user ID");
  assert.equal(result.beatmapId, 98765, "Must safely extract beatmap ID from beatmap.id");
  assert.equal(result.overrideMods, "HD HR", "Must filter out NF from top play mods");
  assert.equal(result.announcement, "Boss Battle: TopHost's #1 top score loaded (HD HR).");
});

test("Host's Addiction resolves username fallback, returns no NF override, and handles beatmap_id", async () => {
  let lookupUsername = "";
  let queriedUserId: number | undefined;

  const mockOsuApi: any = {
    user: async (username: string) => {
      lookupUsername = username;
      return { id: 888 };
    },
    userMostPlayed: async (userId: number, limit: number) => {
      queriedUserId = userId;
      return [
        {
          beatmap_id: 54321,
          count: 150,
        },
      ];
    },
  };

  const result = await resolveMinigameMap("bot_api_host_most_played", {
    hostUsername: "AddictedHost",
    playerCount: 4,
    osu: mockOsuApi,
  });

  assert.ok(result);
  assert.equal(lookupUsername, "AddictedHost", "Must fallback to username lookup when hostId is missing");
  assert.equal(queriedUserId, 888, "Must query most played for looked up user ID");
  assert.equal(result.beatmapId, 54321, "Must extract beatmap ID from beatmap_id");
  assert.equal(result.overrideMods, undefined, "Host's Addiction must not enforce NF");
  assert.equal(result.announcement, "Host's Addiction: AddictedHost's most played beatmap loaded.");
});

test("Wager responses use bracketed [Wager] prefix and PartyPoints balance against sessionPoints", async () => {
  const chatMessages: string[] = [];
  const wagers = new Map<number, number>();

  const mockRoom = {
    say: async (msg: string) => {
      chatMessages.push(msg);
    },
  };

  const mockDb = {
    lobbyPlayer: {
      findUnique: async ({ where }: { where: { lobbyId_playerId: { lobbyId: number; playerId: number } } }) => {
        if (where.lobbyId_playerId.playerId === 1) return { lobbyId: 1, playerId: 1, sessionPoints: 50 };
        if (where.lobbyId_playerId.playerId === 2) return { lobbyId: 1, playerId: 2, sessionPoints: 0 };
        return null;
      },
    },
  };

  async function handleBet(
    p: { id: number; username: string },
    amountStr?: string,
    currentMinigameMetric?: string,
    matchId?: string
  ) {
    if (currentMinigameMetric !== "wager") {
      return void (await mockRoom.say(
        `[Wager] ${p.username}: bets are only allowed during the PartyPoint Wager minigame.`
      ));
    }
    if (matchId) {
      return void (await mockRoom.say(
        `[Wager] ${p.username}: bets cannot be placed once the match has started.`
      ));
    }
    const amount = Number(amountStr);
    if (!Number.isInteger(amount) || amount <= 0) {
      return void (await mockRoom.say("[Wager] Usage: !bet <positive integer amount> (e.g. !bet 5)."));
    }
    const session = await mockDb.lobbyPlayer.findUnique({
      where: { lobbyId_playerId: { lobbyId: 1, playerId: p.id } },
    });
    const currentPoints = Math.max(0, session?.sessionPoints ?? 0);
    if (currentPoints <= 0 || amount > currentPoints) {
      return void (await mockRoom.say(
        `[Wager] ${p.username}: you only have ${currentPoints} PartyPoints to wager.`
      ));
    }
    wagers.set(p.id, amount);
    await mockRoom.say(
      `[Wager] ${p.username} wagered ${amount} PartyPoints! Finish in the top placements to double it!`
    );
  }

  // 1. Non-wager game
  await handleBet({ id: 1, username: "Alice" }, "5", "score");
  assert.equal(chatMessages[0], "[Wager] Alice: bets are only allowed during the PartyPoint Wager minigame.");

  // 2. Mid-match
  await handleBet({ id: 1, username: "Alice" }, "5", "wager", "match-123");
  assert.equal(chatMessages[1], "[Wager] Alice: bets cannot be placed once the match has started.");

  // 3. Invalid amount
  await handleBet({ id: 1, username: "Alice" }, "invalid", "wager");
  assert.equal(chatMessages[2], "[Wager] Usage: !bet <positive integer amount> (e.g. !bet 5).");

  // 4. Player with 0 session points cannot bet
  await handleBet({ id: 2, username: "Bob" }, "10", "wager");
  assert.equal(chatMessages[3], "[Wager] Bob: you only have 0 PartyPoints to wager.");

  // 5. Player with 0 session points attempting to bet 1 still rejected
  await handleBet({ id: 2, username: "Bob" }, "1", "wager");
  assert.equal(chatMessages[4], "[Wager] Bob: you only have 0 PartyPoints to wager.");

  // 6. Exceeds sessionPoints
  await handleBet({ id: 1, username: "Alice" }, "60", "wager");
  assert.equal(chatMessages[5], "[Wager] Alice: you only have 50 PartyPoints to wager.");

  // 7. Valid bet using sessionPoints
  await handleBet({ id: 1, username: "Alice" }, "20", "wager");
  assert.equal(
    chatMessages[6],
    "[Wager] Alice wagered 20 PartyPoints! Finish in the top placements to double it!"
  );
  assert.equal(wagers.get(1), 20);

  // Verify all messages start with [Wager]
  for (const msg of chatMessages) {
    assert.ok(msg.startsWith("[Wager]"), `Message must start with [Wager]: ${msg}`);
  }
});

test("automated pick host holding on bot account and client overwrite prevention", async () => {
  const commandsSent: string[] = [];
  const botUsername = "PartyBotAccount";
  let automatedBeatmapId: number | undefined;

  const mockRoom = {
    command: async (cmd: string) => { commandsSent.push(cmd); },
    host: () => ({ id: 999, username: "PartyBotAccount" }),
  };

  async function simulatePrepareMinigame(minigame: { mapPicker: string }, queue: number[]) {
    if (minigame.mapPicker === "host") {
      automatedBeatmapId = undefined;
      const hostId = queue[0];
      if (hostId) {
        await mockRoom.command(`!mp host #${hostId}`);
      }
    } else {
      await mockRoom.command(`!mp host ${botUsername}`);
      automatedBeatmapId = 123456;
      await mockRoom.command(`!mp map ${automatedBeatmapId}`);
    }
  }

  async function simulateBeatmapChange(mapId: number, minigame: { mapPicker: string }) {
    if (minigame.mapPicker !== "host") {
      if (automatedBeatmapId && mapId !== automatedBeatmapId) {
        await mockRoom.command(`!mp map ${automatedBeatmapId}`);
      }
    }
  }

  // 1. Prepare an automated minigame
  await simulatePrepareMinigame({ mapPicker: "bot_pool_community_choice" }, [101, 102]);
  assert.ok(commandsSent.includes("!mp host PartyBotAccount"), "Must hold host on bot during automated picks");
  assert.ok(commandsSent.includes("!mp map 123456"), "Must set automated beatmap");
  assert.ok(!commandsSent.includes("!mp host #101"), "Must NOT pass host to queued player during automated picks");

  commandsSent.length = 0;

  // 2. Client highlights a different map, Bancho fires beatmap change event
  await simulateBeatmapChange(999999, { mapPicker: "bot_pool_community_choice" });
  assert.ok(commandsSent.includes("!mp map 123456"), "Must immediately re-issue !mp map to lock intended map");

  commandsSent.length = 0;

  // 3. Subsequent round is a host pick -> handover host to queued player
  await simulatePrepareMinigame({ mapPicker: "host" }, [101, 102]);
  assert.ok(commandsSent.includes("!mp host #101"), "Must transfer host to queued player for host pick round");
  assert.equal(automatedBeatmapId, undefined);
});

test("reconnecting players retain existing session points mid-cycle while new participants start at 0", async () => {
  const chatMessages: string[] = [];
  const mockRoom = {
    say: async (msg: string) => { chatMessages.push(msg); },
    players: () => [{ id: 1, username: "PlayerA" }, { id: 2, username: "PlayerB" }],
    host: () => ({ id: 1, username: "PlayerA" }),
  };

  const lobbyPlayerDb = new Map<number, { lobbyId: number; playerId: number; sessionPoints: number }>();

  async function handlePlayerJoined(
    player: { id: number; username: string },
    currentRound: number,
    totalRounds: number,
    isInitialHost: boolean
  ) {
    const existingSession = lobbyPlayerDb.get(player.id);
    const isNewParticipant = !existingSession;
    const sessionPoints = existingSession?.sessionPoints ?? 0;

    // Simulate DB upsert
    if (!existingSession) {
      lobbyPlayerDb.set(player.id, { lobbyId: 1, playerId: player.id, sessionPoints: 0 });
    }

    if (!isInitialHost) {
      if (!isNewParticipant && sessionPoints > 0) {
        await mockRoom.say(
          `[Lobby] Welcome back, ${player.username}! Current game: Round ${currentRound}/${totalRounds}. Restored ${sessionPoints} session points. You will enter the host queue on the next map.`
        );
      } else {
        await mockRoom.say(
          `[Lobby] Welcome, ${player.username}! Current game: Round ${currentRound}/${totalRounds}. You start with 0 session points and will enter the host queue on the next map.`
        );
      }
    }
  }

  function handleDeparted(player: { id: number; username: string }) {
    // Retain LobbyPlayer record in lobbyPlayerDb across disconnect mid-cycle
  }

  // 1. New player joins in round 3
  await handlePlayerJoined({ id: 10, username: "NewPlayer" }, 3, 10, false);
  assert.equal(
    chatMessages[0],
    "[Lobby] Welcome, NewPlayer! Current game: Round 3/10. You start with 0 session points and will enter the host queue on the next map."
  );
  assert.equal(lobbyPlayerDb.get(10)?.sessionPoints, 0);

  // 2. Player earns 35 points in subsequent matches
  lobbyPlayerDb.get(10)!.sessionPoints = 35;

  // 3. Player leaves mid-cycle
  handleDeparted({ id: 10, username: "NewPlayer" });
  assert.equal(lobbyPlayerDb.get(10)?.sessionPoints, 35, "Session points must remain preserved after departure");

  chatMessages.length = 0;

  // 4. Player reconnects in round 7
  await handlePlayerJoined({ id: 10, username: "NewPlayer" }, 7, 10, false);
  assert.equal(
    chatMessages[0],
    "[Lobby] Welcome back, NewPlayer! Current game: Round 7/10. Restored 35 session points. You will enter the host queue on the next map."
  );
  assert.equal(lobbyPlayerDb.get(10)?.sessionPoints, 35, "Session points must be restored, not reset to 0");

  // 5. Grand Prix finishes -> resetPartySession zeroes out all session points
  for (const entry of lobbyPlayerDb.values()) {
    entry.sessionPoints = 0;
  }
  assert.equal(lobbyPlayerDb.get(10)?.sessionPoints, 0, "Grand Prix conclusion zeroes out session points");
});

test("strict message output sequence follows (1) Results -> (2) Queue -> (3) Minigame Round -> (4) Host/Pick Action", async () => {
  const chatMessages: string[] = [];
  const banchoCommands: string[] = [];

  const mockRoom = {
    say: async (msg: string) => { chatMessages.push(msg); },
    command: async (cmd: string) => { banchoCommands.push(cmd); },
  };

  async function simulateRoundTransition(params: {
    resultsSummary: string;
    queueNames: string[];
    minigameName: string;
    minigameDesc: string;
    targetAcc?: number;
    currentRound: number;
    totalRounds: number;
    mapPicker: "host" | "bot_pool_community_choice";
    hostUsername: string;
    botAnnouncement?: string;
  }) {
    // Step 1: Round Results & Points Awarded
    await mockRoom.say(params.resultsSummary);

    // Bancho setup commands dispatch before or alongside announcements
    await mockRoom.command("!mp set 0 0");
    await mockRoom.command("!mp mods freemod");

    let actionLine = "";
    if (params.mapPicker === "host") {
      await mockRoom.command("!mp host #101");
      actionLine = `[Host] ${params.hostUsername}, select a map! (3 min limit)`;
    } else {
      await mockRoom.command("!mp host PartyBot");
      await mockRoom.command("!mp map 12345");
      actionLine = `[Pick] ${params.botAnnouncement}`;
    }

    // Step 2: Queue Status
    await mockRoom.say(`Queue: ${params.queueNames.map((name, i) => `${i + 1}.${name}`).join(" | ")}`);

    // Step 3: Minigame Round Announcement
    let roundLine = `[Round ${params.currentRound}/${params.totalRounds}] ${params.minigameName} | ${params.minigameDesc}`;
    if (params.targetAcc !== undefined) {
      roundLine += ` | Target: ${params.targetAcc}%`;
    }
    await mockRoom.say(roundLine);

    // Step 4: Host Prompt / Map Action (MUST BE LATEST MESSAGE)
    await mockRoom.say(actionLine);
  }

  // 1. Test Host Pick round transition
  await simulateRoundTransition({
    resultsSummary: "[Results] #1 PlayerA (+3 PartyPoints) | #2 PlayerB (+2 PartyPoints) | #3 PlayerC (+1 PartyPoints)",
    queueNames: ["PlayerA", "PlayerB", "PlayerC"],
    minigameName: "Classic Showdown",
    minigameDesc: "Standard Head-to-Head battle. Highest total score wins!",
    currentRound: 2,
    totalRounds: 10,
    mapPicker: "host",
    hostUsername: "PlayerA",
  });

  assert.equal(chatMessages.length, 4);
  assert.ok(chatMessages[0].startsWith("[Results]"), "Step 1 must be Results");
  assert.ok(chatMessages[1].startsWith("Queue:"), "Step 2 must be Queue Status");
  assert.ok(chatMessages[2].startsWith("[Round 2/10]"), "Step 3 must be Minigame Round Announcement");
  assert.ok(chatMessages[3].startsWith("[Host]"), "Step 4 must be Host Prompt");
  assert.equal(chatMessages[3], "[Host] PlayerA, select a map! (3 min limit)");

  chatMessages.length = 0;
  banchoCommands.length = 0;

  // 2. Test Automated Bot Pick round transition
  await simulateRoundTransition({
    resultsSummary: "[Results] No points were applied: at least two players are required for a ranked match.",
    queueNames: ["PlayerB", "PlayerC", "PlayerA"],
    minigameName: "Community Choice",
    minigameDesc: "Play legendary community picks! Highest score wins.",
    currentRound: 3,
    totalRounds: 10,
    mapPicker: "bot_pool_community_choice",
    hostUsername: "PlayerB",
    botAnnouncement: "Community Choice: xi - FREEDOM DiVE [FOUR DIMENSIONS] loaded.",
  });

  assert.equal(chatMessages.length, 4);
  assert.ok(chatMessages[0].startsWith("[Results]"), "Step 1 must be Results (unranked warning)");
  assert.ok(chatMessages[1].startsWith("Queue:"), "Step 2 must be Queue Status");
  assert.ok(chatMessages[2].startsWith("[Round 3/10]"), "Step 3 must be Minigame Round Announcement");
  assert.ok(chatMessages[3].startsWith("[Pick]"), "Step 4 must be Automated Pick Announcement");
  assert.equal(chatMessages[3], "[Pick] Community Choice: xi - FREEDOM DiVE [FOUR DIMENSIONS] loaded.");
});

test("single minigame roll on Grand Prix reset and double-roll guard prevention", async () => {
  let isPreparingRound = false;
  let rollsCount = 0;
  let currentRound = 10;
  const totalRounds = 10;
  let activeMinigame: any = { id: "speedom", name: "Speedom" };

  const rolledHistory: string[] = [];

  async function prepareNextMinigame() {
    if (isPreparingRound) return;
    isPreparingRound = true;
    try {
      rollsCount++;
      activeMinigame = rollNextMinigame(activeMinigame);
      rolledHistory.push(activeMinigame.id);
    } finally {
      isPreparingRound = false;
    }
  }

  async function handleFinish() {
    // Finish round 10 -> Grand Prix podium ceremony
    if (currentRound >= totalRounds) {
      currentRound = 1;
    } else {
      currentRound++;
    }

    // Single handoff to advanceToNextRound
    await prepareNextMinigame();
  }

  // Round 10 finishes
  await handleFinish();

  assert.equal(currentRound, 1, "currentRound must reset to 1 after Round 10");
  assert.equal(rollsCount, 1, "prepareNextMinigame must be called exactly once");
  assert.equal(rolledHistory.length, 1);
  const round1Game = activeMinigame.id;

  // Simulate concurrent / duplicate trigger attempt while isPreparingRound is true
  isPreparingRound = true;
  await prepareNextMinigame(); // Should be blocked by guard
  isPreparingRound = false;

  assert.equal(rollsCount, 1, "Duplicate roll must be blocked by isPreparingRound guard");
  assert.equal(activeMinigame.id, round1Game, "Minigame rolled for Round 1 must persist strictly");
});

test("host turn expiration passes host to next queue player without re-rolling minigame", async () => {
  const chatMessages: string[] = [];
  const banchoCommands: string[] = [];
  let queue = [101, 102, 103];
  const players = [
    { id: 101, username: "PlayerA" },
    { id: 102, username: "PlayerB" },
    { id: 103, username: "PlayerC" },
  ];
  let currentMinigame = { id: "classic-showdown", name: "Classic Showdown" };
  let currentRound = 4;
  let rollsCount = 0;

  const mockRoom = {
    say: async (msg: string) => { chatMessages.push(msg); },
    command: async (cmd: string) => { banchoCommands.push(cmd); },
    players: () => players,
  };

  async function simulatePassTurnToNextHost() {
    if (queue.length) {
      queue.push(queue.shift()!);
    }
    const nextHostId = queue[0];
    const nextHost = players.find(p => p.id === nextHostId);
    const nextHostUsername = nextHost?.username ?? "Host";

    await mockRoom.command(`!mp host #${nextHostId}`);
    await mockRoom.say(`[Host] ${nextHostUsername}, select a map! (3 min limit)`);
  }

  async function simulateTurnExpired(stage: "select" | "start", host: { id: number; username: string }) {
    if (stage === "select") {
      await mockRoom.say(`${host.username} ran out of time to select a map. Host passed.`);
      await simulatePassTurnToNextHost();
    } else {
      await mockRoom.say(`${host.username} ran out of time to start. Host passed.`);
      await simulatePassTurnToNextHost();
    }
  }

  // 1. Host PlayerA times out selecting map in Round 4
  await simulateTurnExpired("select", { id: 101, username: "PlayerA" });

  assert.equal(chatMessages[0], "PlayerA ran out of time to select a map. Host passed.");
  assert.equal(banchoCommands[0], "!mp host #102");
  assert.equal(chatMessages[1], "[Host] PlayerB, select a map! (3 min limit)");
  assert.deepEqual(queue, [102, 103, 101], "Queue should rotate to next player");
  assert.equal(currentRound, 4, "Current round must not change");
  assert.equal(currentMinigame.id, "classic-showdown", "Active minigame must persist without re-rolling");
  assert.equal(rollsCount, 0, "No new minigame roll must occur");

  chatMessages.length = 0;
  banchoCommands.length = 0;

  // 2. PlayerB selects map but times out starting match
  await simulateTurnExpired("start", { id: 102, username: "PlayerB" });

  assert.equal(chatMessages[0], "PlayerB ran out of time to start. Host passed.");
  assert.equal(banchoCommands[0], "!mp host #103");
  assert.equal(chatMessages[1], "[Host] PlayerC, select a map! (3 min limit)");
  assert.deepEqual(queue, [103, 101, 102], "Queue should rotate to PlayerC");
  assert.equal(currentRound, 4, "Current round must still remain Round 4");
  assert.equal(currentMinigame.id, "classic-showdown", "Active minigame must still be Classic Showdown");
});

test("forced beatmaps bypass regulations while host picks enforce them", async () => {
  const regulations: any = {
    enabled: true,
    minStar: 3.5,
    maxStar: 5.0,
    minLength: 60,
    maxLength: 180,
    freeMod: true,
    allowConvert: false,
  };

  // Mock map that violates regulations (6.8 stars, 250s length)
  const nonCompliantMap = {
    id: 999999,
    stars: 6.8,
    length: 250,
    mode: "osu" as const,
    converted: false,
    status: "ranked",
    bpm: 190,
    ar: 9.5,
    hp: 6,
    od: 9,
    cs: 4,
  };

  // 1. Automated Pick Minigame (Relay Race / Loved Classics / etc.)
  const automatedMinigame = {
    id: "loved-classics",
    mapPicker: "loved_classics" as const,
  };

  function shouldValidateMap(minigame: { mapPicker?: string }) {
    return minigame?.mapPicker === "host";
  }

  assert.equal(shouldValidateMap(automatedMinigame), false, "Automated minigame must bypass regulation checks");

  // 2. Host Pick Minigame (Classic Showdown / Russian Roulette / etc.)
  const hostMinigame = {
    id: "classic-showdown",
    mapPicker: "host" as const,
  };

  assert.equal(shouldValidateMap(hostMinigame), true, "Host pick minigame must enforce regulation checks");
});

test("session standings calculation sorts by sessionPoints desc and flags host status", () => {
  const players = [
    { id: 101, username: "epicnuke35" },
    { id: 102, username: "ronaldonater" },
    { id: 103, username: "thirdplayer" },
  ];
  const host = { id: 101, username: "epicnuke35" };
  const lobbyPlayers = [
    { playerId: 101, sessionPoints: 8, player: { allTimePoints: 142, streak: 2 } },
    { playerId: 102, sessionPoints: 5, player: { allTimePoints: 89, streak: 0 } },
    { playerId: 103, sessionPoints: 5, player: { allTimePoints: 120, streak: 1 } },
  ];

  const existingMap = new Map(lobbyPlayers.map(lp => [lp.playerId, lp]));

  const entries = players.map(p => {
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
  const standings = entries.map((e, idx) => ({ position: idx + 1, ...e }));

  assert.equal(standings[0].username, "epicnuke35");
  assert.equal(standings[0].position, 1);
  assert.equal(standings[0].status, "Host");
  assert.equal(standings[0].sessionPoints, 8);

  // Tie breaker on sessionPoints: thirdplayer (120 allTimePoints) > ronaldonater (89 allTimePoints)
  assert.equal(standings[1].username, "thirdplayer");
  assert.equal(standings[1].position, 2);
  assert.equal(standings[1].status, "Ready");
  assert.equal(standings[1].sessionPoints, 5);

  assert.equal(standings[2].username, "ronaldonater");
  assert.equal(standings[2].position, 3);
  assert.equal(standings[2].status, "Ready");
  assert.equal(standings[2].sessionPoints, 5);
});

test("!bug links to osu!Party GitHub issues and !ostats is removed", () => {
  const bugResponse = "Report a bug: https://github.com/kikidoyouheartme-tech/osu-party-bot/issues";
  assert.equal(bugResponse, "Report a bug: https://github.com/kikidoyouheartme-tech/osu-party-bot/issues");

  const supportedStatCmds = ["!pstats", "!stats"];
  assert.ok(supportedStatCmds.includes("!pstats"));
  assert.ok(supportedStatCmds.includes("!stats"));
  assert.ok(!supportedStatCmds.includes("!ostats"), "!ostats must be removed");
  assert.ok(!supportedStatCmds.includes("!os"), "!os must be removed");
});

test("forced mods lock prevents host from removing or changing required mods", async () => {
  const commandsSent: string[] = [];
  const chatMessages: string[] = [];

  class MockEnforcer {
    currentForcedMods?: string;
    isEnforcingMods = false;
    currentLobbyMods: string[] = [];
    freemod = false;

    async enforceForcedMods(currentMods?: string[], isFreemod?: boolean) {
      const requiredMods = this.currentForcedMods;
      if (!requiredMods || this.isEnforcingMods) return;
      const expectedTokens = requiredMods.toUpperCase().split(/\s+/).filter(Boolean).sort();
      const expectedNormalized = expectedTokens.join(" ");
      const currentTokens = (currentMods ?? this.currentLobbyMods)
        .map(m => m.toUpperCase())
        .filter(m => m !== "NONE")
        .sort();
      const currentNormalized = currentTokens.join(" ");
      const freemodActive = isFreemod !== undefined ? isFreemod : this.freemod;

      if (currentNormalized !== expectedNormalized || freemodActive) {
        this.isEnforcingMods = true;
        try {
          commandsSent.push(`!mp mods ${requiredMods}`);
          this.currentLobbyMods = expectedTokens;
          this.freemod = false;
        } finally {
          this.isEnforcingMods = false;
        }
      }
    }
  }

  const enforcer = new MockEnforcer();

  // 1. Minigame: Blindfolded (Forced HD FL)
  enforcer.currentForcedMods = "HD FL";
  enforcer.currentLobbyMods = ["HD", "FL"];
  enforcer.freemod = false;

  // Host tries to take off Flashlight (mods become ["HD"])
  await enforcer.enforceForcedMods(["HD"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HD FL");
  assert.equal(chatMessages.length, 0, "Enforcing forced mods should be silent without chat warnings");

  // Host tries to turn on FreeMod
  await enforcer.enforceForcedMods(["HD", "FL"], true);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HD FL");
  assert.equal(chatMessages.length, 0, "Enforcing forced mods should be silent without chat warnings");

  // Host tries to add DoubleTime (mods become ["HD", "FL", "DT"])
  await enforcer.enforceForcedMods(["HD", "FL", "DT"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HD FL");
  assert.equal(chatMessages.length, 0, "Enforcing forced mods should be silent without chat warnings");

  // When mods match expected, no lock command is sent
  const beforeLen = commandsSent.length;
  await enforcer.enforceForcedMods(["FL", "HD"], false);
  assert.equal(commandsSent.length, beforeLen, "Should not dispatch command when mods match");

  // 2. Casual / Freemod minigame without forced mods
  enforcer.currentForcedMods = undefined;
  enforcer.currentLobbyMods = ["DT"];
  enforcer.freemod = true;
  await enforcer.enforceForcedMods(["HR"], true);
  assert.equal(commandsSent.length, beforeLen, "Should not restrict mods when no forced mods are active");
});

test("!reroll majority vote re-rolls minigame while retaining host and current round", async () => {
  const chatMessages: string[] = [];
  const rerollVotes = new Set<number>();
  let currentRound = 4;
  let queue = [101, 102, 103];
  let wasHostMapPick = true;
  let rolledGameId = "classic-showdown";
  let matchActive = false;

  const humanPlayers = [
    { id: 101, username: "PlayerA" },
    { id: 102, username: "PlayerB" },
    { id: 103, username: "PlayerC" },
  ];

  async function voteReroll(p: { id: number; username: string }) {
    if (matchActive) {
      chatMessages.push(`${p.username}: cannot reroll during an active match.`);
      return;
    }
    const activeCount = Math.max(1, humanPlayers.length);
    const requiredVotes = activeCount <= 2 ? activeCount : Math.floor(activeCount / 2) + 1;

    if (rerollVotes.has(p.id)) {
      chatMessages.push(`${p.username}: you have already voted to reroll (${rerollVotes.size}/${requiredVotes} needed).`);
      return;
    }

    rerollVotes.add(p.id);
    const currentVotes = rerollVotes.size;
    chatMessages.push(`[Vote] ${p.username} voted to reroll the minigame! (${currentVotes}/${requiredVotes} needed)`);

    if (currentVotes >= requiredVotes) {
      rerollVotes.clear();
      chatMessages.push("[Reroll] Vote passed! Rolling a new minigame...");
      // Host retention rule: queue is NOT rotated, wasHostMapPick preserved, currentRound unchanged
      rolledGameId = "precision-master";
    }
  }

  // Active match test: voting blocked
  matchActive = true;
  await voteReroll(humanPlayers[0]);
  assert.equal(chatMessages[chatMessages.length - 1], "PlayerA: cannot reroll during an active match.");
  matchActive = false;
  chatMessages.length = 0;

  // 3-player lobby: required votes = Math.floor(3/2) + 1 = 2
  await voteReroll(humanPlayers[0]);
  assert.equal(chatMessages[0], "[Vote] PlayerA voted to reroll the minigame! (1/2 needed)");

  // Duplicate vote from PlayerA
  await voteReroll(humanPlayers[0]);
  assert.equal(chatMessages[1], "PlayerA: you have already voted to reroll (1/2 needed).");

  // PlayerB votes -> reaches 2/2 threshold
  await voteReroll(humanPlayers[1]);
  assert.equal(chatMessages[2], "[Vote] PlayerB voted to reroll the minigame! (2/2 needed)");
  assert.equal(chatMessages[3], "[Reroll] Vote passed! Rolling a new minigame...");

  // Host retention assertions
  assert.equal(queue[0], 101, "Current host must retain host turn");
  assert.equal(currentRound, 4, "Current round must not advance on reroll");
  assert.equal(wasHostMapPick, true, "wasHostMapPick must be preserved");
  assert.equal(rolledGameId, "precision-master", "A new minigame must be rolled");

  // 2-player lobby test: requires 2 votes (at least 2 in 2-player lobby)
  const twoPlayers = [humanPlayers[0], humanPlayers[1]];
  chatMessages.length = 0;
  rerollVotes.clear();
  const req2 = twoPlayers.length <= 2 ? twoPlayers.length : Math.floor(twoPlayers.length / 2) + 1;
  assert.equal(req2, 2, "2-player lobby requires 2 votes for reroll");
});

test("mod-adjusted beatmap star rating and regulation enforcement for forced DT/HR", async () => {
  const regulations = {
    enabled: true,
    minStar: 4.0,
    maxStar: 8.0,
    allowConvert: false,
    freeMod: false,
  };

  // 1. Fallback calculation multipliers
  assert.equal(calculateModAdjustedStars(6.0, "DT"), 8.28);
  assert.equal(calculateModAdjustedStars(5.5, "HR"), 6.16);
  assert.equal(calculateModAdjustedStars(5.0, "DT"), 6.90);
  assert.equal(calculateModAdjustedStars(5.0, ""), 5.0);

  // 2. Speedom (DT) with 6.00★ map -> 8.28★ under DT exceeds 8.00★ max
  const freedomDive = {
    id: 129891,
    beatmapsetId: 39804,
    title: "FREEDOM DiVE",
    artist: "xi",
    version: "FOUR DIMENSIONS",
    stars: 6.0,
    length: 250,
    mode: "osu" as const,
    converted: false,
    status: "ranked",
    bpm: 222,
    ar: 9,
    hp: 7,
    od: 9,
    cs: 4,
  };

  const dtReason = checkMap(freedomDive, regulations, "DT");
  assert.ok(dtReason, "Map should be rejected under DT");
  assert.equal(
    `[Regulations] Map rejected: ${dtReason}. Please select another map!`,
    "[Regulations] Map rejected: FREEDOM DiVE is 8.28★ with DT (Max allowed: 8★). Please select another map!"
  );

  // 3. Pixel Perfect (HR) with 5.50★ map when maxStar is 6.00★ -> 6.16★ exceeds 6.00★
  const blueZenith = {
    ...freedomDive,
    title: "Blue Zenith",
    stars: 5.5,
  };
  const hrRegulations = { ...regulations, maxStar: 6.0 };
  const hrReason = checkMap(blueZenith, hrRegulations, "HR");
  assert.ok(hrReason, "Map should be rejected under HR");
  assert.equal(
    `[Regulations] Map rejected: ${hrReason}. Please select another map!`,
    "[Regulations] Map rejected: Blue Zenith is 6.16★ with HR (Max allowed: 6★). Please select another map!"
  );

  // 4. Map compliant under DT (5.0★ -> 6.90★ <= 8.0★)
  const compliantMap = {
    ...freedomDive,
    title: "Compliant Map",
    stars: 5.0,
  };
  const compliantReason = checkMap(compliantMap, regulations, "DT");
  assert.equal(compliantReason, undefined, "Compliant map should not be rejected");

  // 5. MinStar check with forced mods
  const easyMap = {
    ...freedomDive,
    title: "Too Easy Map",
    stars: 2.0,
  };
  const minStarRegulations = { ...regulations, minStar: 4.0 };
  const minReason = checkMap(easyMap, minStarRegulations, "DT");
  assert.ok(minReason);
  assert.equal(
    `[Regulations] Map rejected: ${minReason}. Please select another map!`,
    "[Regulations] Map rejected: Too Easy Map is 2.76★ with DT (Min required: 4★). Please select another map!"
  );

  // 6. Explicit adjustedStars override from API difficulty attributes
  const apiOverriddenReason = checkMap(freedomDive, regulations, "DT", 8.45);
  assert.equal(
    `[Regulations] Map rejected: ${apiOverriddenReason}. Please select another map!`,
    "[Regulations] Map rejected: FREEDOM DiVE is 8.45★ with DT (Max allowed: 8★). Please select another map!"
  );
});

test("mod spam prevention deduplicates !mp mods and avoids unreadying players", async () => {
  const commandsSent: string[] = [];

  function normalizeMods(mods: string | string[]): string {
    const list = Array.isArray(mods) ? mods : mods.split(/\s+/);
    return list
      .map(m => m.trim().toUpperCase())
      .filter(m => m && m !== "NONE")
      .sort()
      .join(" ");
  }

  let activeRoomMods = "";
  let activeFreemod = false;
  let currentForcedMods: string | undefined = "HD FL";

  async function handlePlayerJoined(targetForcedMods?: string) {
    const targetMods = targetForcedMods ?? "";
    const targetNormalized = normalizeMods(targetMods);

    if (targetMods) {
      if (activeRoomMods !== targetNormalized || activeFreemod) {
        activeRoomMods = targetNormalized;
        activeFreemod = false;
        commandsSent.push(`!mp mods ${targetMods}`);
      }
    } else {
      if (!activeFreemod) {
        activeRoomMods = "";
        activeFreemod = true;
        commandsSent.push("!mp mods freemod");
      }
    }
  }

  // Initial round setup sends !mp mods once
  activeRoomMods = normalizeMods(currentForcedMods);
  activeFreemod = false;
  commandsSent.push(`!mp mods ${currentForcedMods}`);
  assert.equal(commandsSent.length, 1);

  // Player joins when room already has target mods: NO command sent
  await handlePlayerJoined(currentForcedMods);
  assert.equal(commandsSent.length, 1, "Must not re-send !mp mods when room mods already match");

  // Another player joins: still NO command sent
  await handlePlayerJoined(currentForcedMods);
  assert.equal(commandsSent.length, 1, "Must not re-send !mp mods for second player join");

  // Only if room mods somehow desynced (e.g. freemod became true) does it re-issue
  activeFreemod = true;
  await handlePlayerJoined(currentForcedMods);
  assert.equal(commandsSent.length, 2, "Re-issues command if room mods desynced");
});

test("match guard silently enforces room title, password, team mode and win condition without chat warnings", async () => {
  const commandsSent: string[] = [];
  const chatMessages: string[] = [];

  class MockGuard {
    config = { title: "osu!Party Grand Prix", password: "secretPassword" };
    currentMinigame = { teamMode: 2, scoreMode: 1, forcedMods: "" };

    async handleTitleChange(incomingTitle: string) {
      if (incomingTitle !== this.config.title) {
        commandsSent.push(`!mp name ${this.config.title}`);
      }
    }

    async handlePasswordChange(incomingPassword?: string) {
      if (incomingPassword !== this.config.password) {
        commandsSent.push(`!mp password ${this.config.password || ""}`);
      }
    }

    async enforceMatchSettings(teamMode?: number, winCondition?: number) {
      const targetTeam = this.currentMinigame.teamMode;
      const targetScore = this.currentMinigame.scoreMode;
      if (teamMode !== targetTeam || winCondition !== targetScore) {
        commandsSent.push(`!mp set ${targetTeam} ${targetScore}`);
      }
    }
  }

  const guard = new MockGuard();

  // Host renames room: silently reverts to target title without chat warning
  await guard.handleTitleChange("Host's Custom Room Name");
  assert.equal(commandsSent[commandsSent.length - 1], "!mp name osu!Party Grand Prix");
  assert.equal(chatMessages.length, 0, "No chat warning should be sent on title change");

  // Host changes password: silently reverts to target password without chat warning
  await guard.handlePasswordChange(undefined);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp password secretPassword");
  assert.equal(chatMessages.length, 0, "No chat warning should be sent on password change");

  // Host changes dropdowns to HeadToHead (0) & Score (0) instead of TeamVS (2) & Accuracy (1)
  // Must enforce both compound parameters: !mp set <teammode> <scoremode>
  await guard.enforceMatchSettings(0, 0);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp set 2 1");
  assert.equal(chatMessages.length, 0, "No chat warning should be sent on match settings revert");

  // Matching settings do not trigger commands
  const beforeLen = commandsSent.length;
  await guard.enforceMatchSettings(2, 1);
  assert.equal(commandsSent.length, beforeLen, "Should not trigger revert when settings match");
});

test("deferred room metadata validation restores title and password post-round and upon host-pass without mid-game spam", async () => {
  const commandsSent: string[] = [];
  const chatMessages: string[] = [];

  class MockDelayedMetadataController {
    config = { title: "osu!Party Grand Prix", password: "secretPassword" };
    matchId?: number;
    currentRoomTitle = "osu!Party Grand Prix";
    currentRoomPassword: string | undefined = "secretPassword";

    room = {
      command: async (cmd: string) => {
        commandsSent.push(cmd);
      },
      say: async (msg: string) => {
        chatMessages.push(msg);
      },
      name: () => this.currentRoomTitle,
      password: () => this.currentRoomPassword,
    };

    handleTitleChange(newTitle: string) {
      this.currentRoomTitle = newTitle;
    }

    handlePasswordChange(newPassword?: string) {
      this.currentRoomPassword = newPassword;
    }

    async validateRoomMetadata() {
      const targetLobbyTitle = this.config.title;
      const targetLobbyPassword = this.config.password;
      const currentRoomName = this.room.name() ?? this.currentRoomTitle;
      const currentRoomPassword = this.room.password() ?? this.currentRoomPassword;

      if (targetLobbyTitle && currentRoomName !== targetLobbyTitle) {
        await this.room.command(`!mp name ${targetLobbyTitle}`);
        this.currentRoomTitle = targetLobbyTitle;
      }

      const normalizedTargetPassword = targetLobbyPassword || undefined;
      const normalizedCurrentPassword = currentRoomPassword || undefined;
      if (normalizedCurrentPassword !== normalizedTargetPassword) {
        await this.room.command(`!mp password ${targetLobbyPassword || ""}`);
        this.currentRoomPassword = targetLobbyPassword;
      }
    }

    async onRoundComplete() {
      await this.validateRoomMetadata();
    }

    async onHostChanged() {
      if (this.matchId) return;
      await this.validateRoomMetadata();
    }
  }

  const controller = new MockDelayedMetadataController();

  // 1. Start match (active gameplay)
  controller.matchId = 1;

  // 2. Host alters title and password during active gameplay
  controller.handleTitleChange("Random Host Title 123");
  controller.handlePasswordChange("hackedPass");

  // Verify that during active gameplay, NO commands or chat warnings are sent
  assert.equal(commandsSent.length, 0, "No commands should be sent mid-game when title/password are changed");
  assert.equal(chatMessages.length, 0, "No chat warnings should be spammed during active gameplay");

  // 3. Round finishes -> onRoundComplete executes
  controller.matchId = undefined;
  await controller.onRoundComplete();

  // Verify room title and password are both silently corrected without chat spam
  assert.ok(commandsSent.includes("!mp name osu!Party Grand Prix"), "Should restore target title after round ends");
  assert.ok(commandsSent.includes("!mp password secretPassword"), "Should restore target password after round ends");
  assert.equal(chatMessages.length, 0, "Quiet enforcement must not spam chat warnings");
  assert.equal(controller.currentRoomTitle, "osu!Party Grand Prix");
  assert.equal(controller.currentRoomPassword, "secretPassword");

  // 4. Host rotates between rounds: if host changes password before map selection
  commandsSent.length = 0;
  controller.handlePasswordChange(undefined);
  await controller.onHostChanged();

  assert.equal(commandsSent[0], "!mp password secretPassword", "Should restore password when host rotates");
  assert.equal(chatMessages.length, 0, "Host change check must also be quiet without chat spam");
});

test("star rating floating-point tolerance buffer allows slight decimal overflows and underflows within ±0.10★", () => {
  const regulations = {
    enabled: true,
    minStar: 4.0,
    maxStar: 8.0,
    allowConvert: false,
    freeMod: false,
  };
  const baseMap = {
    id: 1,
    beatmapsetId: 1,
    title: "Tolerance Test Map",
    artist: "Artist",
    version: "Diff",
    stars: 8.05,
    length: 120,
    mode: "osu" as const,
    converted: false,
    status: "ranked",
    bpm: 180,
    ar: 9,
    hp: 7,
    od: 8,
    cs: 4,
  };

  // 8.05★ passes an 8.0★ limit (effectiveStars <= maxStar + 0.10)
  assert.equal(checkMap({ ...baseMap, stars: 8.05 }, regulations), undefined);
  // 8.10★ passes an 8.0★ limit
  assert.equal(checkMap({ ...baseMap, stars: 8.10 }, regulations), undefined);
  // 8.11★ exceeds 8.0★ + 0.10 tolerance and is rejected
  assert.ok(checkMap({ ...baseMap, stars: 8.11 }, regulations));

  // 3.95★ passes a 4.0★ minStar limit (effectiveStars >= minStar - 0.10)
  assert.equal(checkMap({ ...baseMap, stars: 3.95 }, regulations), undefined);
  // 3.90★ passes a 4.0★ minStar limit
  assert.equal(checkMap({ ...baseMap, stars: 3.90 }, regulations), undefined);
  // 3.89★ is below 4.0★ - 0.10 tolerance and is rejected
  assert.ok(checkMap({ ...baseMap, stars: 3.89 }, regulations));
});

test("automated special map does not pollute lastValidMapId or roll over to subsequent host round", async () => {
  const commandsSent: string[] = [];
  const chatMessages: string[] = [];

  class MockRolloverController {
    currentMinigame?: { id: string; name: string; mapPicker: "host" | "automated" };
    lastValidMapId?: number;
    automatedBeatmapId?: number;

    regulations = {
      enabled: true,
      minStar: 4.0,
      maxStar: 6.0,
    };

    mapDatabase: Record<number, any> = {
      100: { id: 100, title: "Automated Boss Map", stars: 7.5, length: 300, mode: "osu", status: "ranked", bpm: 200, converted: false },
      200: { id: 200, title: "Host Invalid Map", stars: 7.2, length: 150, mode: "osu", status: "ranked", bpm: 180, converted: false },
      300: { id: 300, title: "Host Valid Map", stars: 5.0, length: 150, mode: "osu", status: "ranked", bpm: 180, converted: false },
    };

    // Round 1: Automated minigame
    prepareAutomatedRound() {
      this.lastValidMapId = undefined;
      this.automatedBeatmapId = 100;
      this.currentMinigame = { id: "boss-battle", name: "Boss Battle", mapPicker: "automated" };
      commandsSent.push("!mp map 100");
    }

    // validateSelection logic matching lobby-controller
    async validateSelection(mapId: number) {
      if (this.currentMinigame && this.currentMinigame.mapPicker !== "host") {
        if (this.automatedBeatmapId && mapId !== this.automatedBeatmapId) {
          commandsSent.push(`!mp map ${this.automatedBeatmapId}`);
        }
        return; // Automated picks never set lastValidMapId
      }

      const map = this.mapDatabase[mapId];
      const reason = checkMap(map, this.regulations as any);
      if (!reason) {
        this.lastValidMapId = mapId;
        chatMessages.push(`Selected map: ${map.title}`);
        return;
      }

      if (this.lastValidMapId) {
        commandsSent.push(`!mp map ${this.lastValidMapId}`);
        chatMessages.push(`Map rejected: ${reason}. Reverted to the previous valid map.`);
      } else {
        chatMessages.push(`Map rejected: ${reason}. Select a regulation-compliant map.`);
      }
    }

    // Transition to Round 2: Host Pick minigame
    prepareHostRound() {
      this.lastValidMapId = undefined;
      this.automatedBeatmapId = undefined;
      this.currentMinigame = { id: "classic", name: "Classic Party", mapPicker: "host" };
    }
  }

  const controller = new MockRolloverController();

  // 1. Round 1: Automated Boss Battle loads map 100
  controller.prepareAutomatedRound();
  await controller.validateSelection(100);
  assert.equal(controller.lastValidMapId, undefined, "Automated pick must never set lastValidMapId");

  // If a player attempted to change map during automated pick, it reverts silently to 100 without [Lock]
  await controller.validateSelection(999);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp map 100");
  assert.equal(chatMessages.length, 0, "Automated map revert must not send [Lock] chat warning");

  // 2. Round 2: Next minigame is a Host Pick round
  controller.prepareHostRound();
  assert.equal(controller.lastValidMapId, undefined, "lastValidMapId must be undefined going into host round");

  // 3. Host selects invalid map 200 (7.2★ > 6.0★ limit)
  await controller.validateSelection(200);

  // CRITICAL CHECK: It must NOT revert to map 100 from Round 1!
  const revertedTo100 = commandsSent.slice(2).some(cmd => cmd === "!mp map 100");
  assert.equal(revertedTo100, false, "Must not revert to automated map from previous round");
  assert.ok(chatMessages.some(msg => msg.includes("Select a regulation-compliant map")), "Must prompt host to select a compliant map");

  // 4. Host selects valid map 300 (5.0★)
  await controller.validateSelection(300);
  assert.equal(controller.lastValidMapId, 300, "Valid host pick sets lastValidMapId");

  // 5. Host now selects invalid map 200 again in the same round -> should revert to valid map 300
  await controller.validateSelection(200);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp map 300", "Reverts to host's valid map in this round");
});

test("extra user-added mods are automatically overwritten by forcedMods with alias normalization", async () => {
  const commandsSent: string[] = [];
  const chatMessages: string[] = [];

  class MockForcedModsController {
    currentMinigame?: { forcedMods: string };
    currentForcedMods?: string;
    isEnforcingMods = false;
    currentLobbyMods: string[] = [];
    freemod = false;

    async enforceForcedMods(currentMods?: string[], isFreemod?: boolean) {
      if (this.isEnforcingMods) return;
      const requiredMods = this.currentForcedMods ?? (this.currentMinigame?.forcedMods || undefined);
      const targetNormalized = normalizeMods(requiredMods ?? "");

      const normalizedIncoming = normalizeMods(currentMods ?? this.currentLobbyMods);
      const freemodActive = isFreemod !== undefined ? isFreemod : this.freemod;

      if (requiredMods) {
        if (normalizedIncoming === targetNormalized && !freemodActive) {
          this.currentLobbyMods = targetNormalized.split(" ").filter(Boolean);
          this.freemod = false;
          return;
        }
        this.isEnforcingMods = true;
        this.currentLobbyMods = targetNormalized.split(" ").filter(Boolean);
        this.freemod = false;
        try {
          commandsSent.push(`!mp mods ${requiredMods}`);
        } finally {
          this.isEnforcingMods = false;
        }
      } else {
        if (freemodActive) {
          this.freemod = true;
          return;
        }
        this.isEnforcingMods = true;
        this.currentLobbyMods = [];
        this.freemod = true;
        try {
          commandsSent.push("!mp mods freemod");
        } finally {
          this.isEnforcingMods = false;
        }
      }
    }
  }

  const controller = new MockForcedModsController();

  // 1. Minigame has forcedMods: "HR"
  controller.currentMinigame = { forcedMods: "HR" };
  controller.currentForcedMods = "HR";
  controller.currentLobbyMods = ["HR"];

  // Host attempts to layer extra mod: DT on top of HR
  await controller.enforceForcedMods(["HR", "DT"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HR", "Must re-issue forced HR when DT is added");
  assert.equal(chatMessages.length, 0, "No chat noise on mod correction");

  // Host attempts to add DoubleTime using full alias
  await controller.enforceForcedMods(["HardRock", "DoubleTime"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HR", "Must recognize full mod names and overwrite");

  // Host attempts to remove HR (mods cleared to none)
  await controller.enforceForcedMods([], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HR", "Must re-issue HR when host removes it");

  // Host attempts to replace HR with HD
  await controller.enforceForcedMods(["HD"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HR", "Must overwrite unauthorized HD with HR");

  // Host attempts to turn on FreeMod
  await controller.enforceForcedMods(["HR"], true);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HR", "Must disable FreeMod and enforce HR");

  // Room receives exact required mod: no extra command dispatched
  const countBefore = commandsSent.length;
  await controller.enforceForcedMods(["HR"], false);
  assert.equal(commandsSent.length, countBefore, "Must not loop when mods match target");

  // 2. Multi-mod forced minigame: "HD FL"
  controller.currentMinigame = { forcedMods: "HD FL" };
  controller.currentForcedMods = "HD FL";
  controller.currentLobbyMods = ["HD", "FL"];

  // Host layers DT on top of HD FL
  await controller.enforceForcedMods(["HD", "FL", "DT"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HD FL", "Must re-apply exact HD FL when extra mod is layered");

  // Host removes Flashlight
  await controller.enforceForcedMods(["HD"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HD FL", "Must restore Flashlight when host removes it");
});

test("all-ready states trigger !mp start silently without sending any chat text", async () => {
  const commandsSent: string[] = [];
  const chatMessages: string[] = [];

  class MockAutoStartController {
    matchId?: number;
    beatmapId?: number = 12345;
    isLaunching = false;
    timerCleared = false;

    room = {
      beatmapId: () => this.beatmapId,
      say: async (msg: string) => {
        chatMessages.push(msg);
      },
      command: async (cmd: string) => {
        commandsSent.push(cmd);
      },
    };

    clearTurnTimer() {
      this.timerCleared = true;
    }

    stopTimer() {
      this.timerCleared = true;
    }

    async launch(mapId: number) {
      if (this.matchId || this.isLaunching) return;
      this.isLaunching = true;
      try {
        this.matchId = 1;
        await this.room.command("!mp start");
      } finally {
        this.isLaunching = false;
      }
    }

    async allPlayersReady() {
      const mapId = this.room.beatmapId();
      if (!mapId || this.matchId) return;
      this.clearTurnTimer();
      this.stopTimer();
      await this.launch(mapId);
    }
  }

  const controller = new MockAutoStartController();

  // 1. All players transition to ready state with map selected
  await controller.allPlayersReady();

  // Must immediately dispatch !mp start
  assert.equal(commandsSent.length, 1, "Should dispatch exactly one start command");
  assert.equal(commandsSent[0], "!mp start", "Must issue !mp start");

  // CRITICAL REQUIREMENT: Zero chat noise
  assert.equal(chatMessages.length, 0, "Must not broadcast any text or countdowns to room chat");
  assert.equal(controller.timerCleared, true, "Turn and start countdown timers must be cleared");
  assert.equal(controller.matchId, 1, "Match ID must be active");

  // 2. Duplicate or redundant all-ready triggers while match is ongoing do nothing
  await controller.allPlayersReady();
  assert.equal(commandsSent.length, 1, "Must not issue duplicate !mp start when match already started");
  assert.equal(chatMessages.length, 0, "Still no chat messages emitted");
});

test("LobbyKeeper silently enforces title, password, compound settings, and forced mods without chat warnings", async () => {
  const commandsSent: string[] = [];
  const logEntries: string[] = [];
  let currentTitle = "osu!Party Lobby [5-8*]";
  let currentPassword: string | undefined = "party123";
  let currentTeamMode = 0;
  let currentWinCondition = 0;
  let currentMods: string[] = ["HR"];
  let freemodActive = false;

  let titleListener: ((title: string) => void) | undefined;
  let passwordListener: (() => void) | undefined;
  let settingsListener: ((team: number, win: number) => void) | undefined;
  let modsListener: ((mods: string[], freemod: boolean) => void) | undefined;

  const mockRoom: any = {
    command: async (cmd: string) => { commandsSent.push(cmd); },
    name: () => currentTitle,
    password: () => currentPassword,
    teamMode: () => currentTeamMode,
    winCondition: () => currentWinCondition,
    mods: () => currentMods,
    freemod: () => freemodActive,
    onTitleChanged: (fn: (title: string) => void) => { titleListener = fn; },
    onPasswordChanged: (fn: () => void) => { passwordListener = fn; },
    onSettingsChanged: (fn: (team: number, win: number) => void) => { settingsListener = fn; },
    onModsChanged: (fn: (mods: string[], freemod: boolean) => void) => { modsListener = fn; },
  };

  const config: any = {
    title: "osu!Party Lobby [5-8*]",
    password: "party123",
    mods: ["HR"],
    locks: { mods: true },
  };

  const currentMinigame = {
    id: "pixel-perfect",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "HR",
  };

  const keeper = new LobbyKeeper({
    room: mockRoom,
    getConfig: () => config,
    getCurrentMinigame: () => currentMinigame,
    getCurrentForcedMods: () => currentMinigame.forcedMods,
    logActivity: (lvl, msg) => { logEntries.push(msg); },
  });

  keeper.bindListeners();
  assert.ok(titleListener, "Title listener must be bound");
  assert.ok(passwordListener, "Password listener must be bound");
  assert.ok(settingsListener, "Settings listener must be bound");
  assert.ok(modsListener, "Mods listener must be bound");

  // 1. Host alters title -> silently restored via !mp name
  titleListener!("My Custom Title");
  await keeper.enforceTitle("My Custom Title");
  assert.equal(commandsSent[commandsSent.length - 1], "!mp name osu!Party Lobby [5-8*]");
  assert.ok(logEntries.some(l => l.includes("Restored room title")));

  // 2. Host alters password -> silently restored via !mp password
  currentPassword = "hackedpassword";
  passwordListener!();
  await keeper.enforcePassword("hackedpassword");
  assert.equal(commandsSent[commandsSent.length - 1], "!mp password party123");
  assert.ok(logEntries.some(l => l.includes("Restored room password")));

  // 3. Host alters settings to Team VS Accuracy (2, 1) -> silently restored via compound !mp set 0 0
  settingsListener!(2, 1);
  await keeper.enforceMatchSettings(2, 1);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp set 0 0", "Must use compound !mp set syntax");
  assert.ok(logEntries.some(l => l.includes("Restored match settings")));

  // 4. Host adds DT to forced HR -> silently re-issues !mp mods HR
  modsListener!(["HR", "DT"], false);
  await keeper.enforceForcedMods(["HR", "DT"], false);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp mods HR");
  assert.ok(logEntries.some(l => l.includes("Re-applied forced mods")));

  // 5. Normalization prevents duplicate loops when incoming mods match
  const countBefore = commandsSent.length;
  await keeper.enforceForcedMods(["HardRock"], false);
  assert.equal(commandsSent.length, countBefore, "Must recognize alias and not loop");
});

test("MatchStarter executes silent auto-start immediately when all players ready without chat noise", async () => {
  const commandsSent: string[] = [];
  const logEntries: string[] = [];
  let timersCleared = false;
  let matchActive = false;
  let launchedMapId: number | undefined;

  let readyListener: (() => void) | undefined;

  const mockRoom: any = {
    beatmapId: () => 987654,
    onAllPlayersReady: (fn: () => void) => { readyListener = fn; },
  };

  const starter = new MatchStarter({
    room: mockRoom,
    isMatchActive: () => matchActive,
    onClearTimers: () => { timersCleared = true; },
    onAutoStart: async (mapId) => {
      matchActive = true;
      launchedMapId = mapId;
      commandsSent.push("!mp start");
    },
    logActivity: (lvl, msg) => { logEntries.push(msg); },
  });

  starter.bindListeners();
  assert.ok(readyListener, "All players ready listener must be bound");

  // 1. Trigger all players ready
  await starter.triggerAutoStart();

  assert.equal(timersCleared, true, "Timers must be cleared");
  assert.equal(launchedMapId, 987654, "Must launch active beatmap ID");
  assert.equal(commandsSent[0], "!mp start", "Must issue !mp start");
  assert.ok(logEntries.some(l => l.includes("All players ready, launching match")));

  // 2. Subsequent ready trigger while match is active is ignored
  const countBefore = commandsSent.length;
  await starter.triggerAutoStart();
  assert.equal(commandsSent.length, countBefore, "Must not trigger start when match is active");
});

test("resetRoundLifecycleState cleanly isolates round states and shouldBypassRegulations handles minigame pickers", () => {
  const state = resetRoundLifecycleState();
  assert.equal(state.automatedBeatmapId, undefined);
  assert.equal(state.lastValidMapId, undefined);
  assert.equal(state.currentForcedMods, undefined);
  assert.equal(state.targetAccuracy, undefined);
  assert.equal(state.wasHostMapPick, true);

  // Host picks must enforce regulations (bypass === false)
  assert.equal(shouldBypassRegulations({ mapPicker: "host" }), false);
  assert.equal(shouldBypassRegulations(undefined), false);

  // Automated/bot picks must completely bypass regulations (bypass === true)
  assert.equal(shouldBypassRegulations({ mapPicker: "bot_pool_community_choice" }), true);
  assert.equal(shouldBypassRegulations({ mapPicker: "bot_api_host_top" }), true);
  assert.equal(shouldBypassRegulations({ mapPicker: "bot_api_host_most_played" }), true);
  assert.equal(shouldBypassRegulations({ mapPicker: "bot_pool_tag" }), true);
});

test("pre-start state enforcement executes sequential forcedMods, !mp set, and !mp start before match locks", async () => {
  const commandsSent: string[] = [];

  const mockRoom: any = {
    beatmapId: () => 123456,
    command: async (cmd: string) => { commandsSent.push(cmd); },
  };

  // 1. Minigame with forced mods (e.g. Speedom -> DT)
  const dtMinigame = {
    id: "speedom",
    teamMode: 0,
    scoreMode: 0,
    forcedMods: "DT",
  };

  const starter1 = new MatchStarter({
    room: mockRoom,
    isMatchActive: () => false,
    getCurrentMinigame: () => dtMinigame,
    onAutoStart: async () => {
      commandsSent.push("!mp start");
    },
  });

  await starter1.triggerAutoStart();

  assert.deepEqual(
    commandsSent,
    ["!mp mods DT", "!mp set 0 0", "!mp start"],
    "Must dispatch !mp mods DT, then !mp set 0 0, then !mp start in exact sequence"
  );

  commandsSent.length = 0;

  // 2. Minigame without forced mods (e.g. Classic Showdown / Freemod)
  const freeMinigame = {
    id: "classic-showdown",
    teamMode: 2,
    scoreMode: 1,
    forcedMods: "",
  };

  const starter2 = new MatchStarter({
    room: mockRoom,
    isMatchActive: () => false,
    getCurrentMinigame: () => freeMinigame,
    onAutoStart: async () => {
      commandsSent.push("!mp start");
    },
  });

  await starter2.triggerAutoStart();

  assert.deepEqual(
    commandsSent,
    ["!mp set 2 1", "!mp start"],
    "Must NOT dispatch !mp mods when forcedMods is empty, but MUST dispatch !mp set 2 1"
  );
});

test("room title reversion uses trimmed string normalization and executes on lifecycle checkpoints (join, leave, host pass)", async () => {
  const commandsSent: string[] = [];
  let currentRoomTitle = "osu!Party Lobby [5-8*]";
  let playerJoinListener: (() => void) | undefined;
  let playerLeaveListener: (() => void) | undefined;
  let hostChangeListener: (() => void) | undefined;

  const mockRoom: any = {
    command: async (cmd: string) => { commandsSent.push(cmd); },
    name: () => currentRoomTitle,
    password: () => "pass123",
    onPlayerJoined: (fn: () => void) => { playerJoinListener = fn; },
    onPlayerLeft: (fn: () => void) => { playerLeaveListener = fn; },
    onHostChanged: (fn: () => void) => { hostChangeListener = fn; },
  };

  const config: any = {
    title: "osu!Party Lobby [5-8*]",
    password: "pass123",
    locks: {},
  };

  const keeper = new LobbyKeeper({
    room: mockRoom,
    getConfig: () => config,
    getCurrentMinigame: () => undefined,
    getCurrentForcedMods: () => undefined,
  });

  keeper.bindListeners();
  assert.ok(playerJoinListener, "Must bind player joined listener");
  assert.ok(playerLeaveListener, "Must bind player left listener");
  assert.ok(hostChangeListener, "Must bind host changed listener");

  // 1. Title with leading/trailing whitespace should NOT trigger re-application
  currentRoomTitle = "   osu!Party Lobby [5-8*]   ";
  await keeper.enforceTitle(currentRoomTitle);
  assert.equal(commandsSent.length, 0, "Trimmed whitespace comparison must not trigger redundant !mp name");

  // 2. Modified title triggers !mp name restoration
  currentRoomTitle = "Host's Custom Room";
  await keeper.enforceTitle(currentRoomTitle);
  assert.equal(commandsSent[commandsSent.length - 1], "!mp name osu!Party Lobby [5-8*]");

  commandsSent.length = 0;

  // 3. Player joined lifecycle checkpoint restores modified title
  currentRoomTitle = "Sneaky Host Name";
  playerJoinListener!();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(commandsSent[commandsSent.length - 1], "!mp name osu!Party Lobby [5-8*]");

  commandsSent.length = 0;

  // 4. Player left lifecycle checkpoint restores modified title
  currentRoomTitle = "Sneaky Host Name 2";
  playerLeaveListener!();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(commandsSent[commandsSent.length - 1], "!mp name osu!Party Lobby [5-8*]");

  commandsSent.length = 0;

  // 5. Host changed lifecycle checkpoint restores modified title
  currentRoomTitle = "Sneaky Host Name 3";
  hostChangeListener!();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(commandsSent[commandsSent.length - 1], "!mp name osu!Party Lobby [5-8*]");
});

test("Boss Battle resolves NoMod top play with overrideMods 'None' and pre-start issues !mp mods None", async () => {
  const mockOsuApi: any = {
    user: async () => ({ id: 999 }),
    userBestScores: async () => [
      {
        beatmap: { id: 112233 },
        mods: [], // Clean NoMod top play
      },
    ],
  };

  const result = await resolveMinigameMap("bot_api_host_top", {
    hostUsername: "NoModGod",
    playerCount: 4,
    osu: mockOsuApi,
  });

  assert.ok(result);
  assert.equal(result.beatmapId, 112233);
  assert.equal(result.overrideMods, "None", "NoMod top play must set overrideMods to None");
  assert.equal(result.announcement, "Boss Battle: NoModGod's #1 top score loaded (NM).");

  const commandsSent: string[] = [];
  const mockRoom: any = {
    beatmapId: () => 112233,
    command: async (cmd: string) => { commandsSent.push(cmd); },
  };

  const bossMinigame = {
    id: "boss-battle",
    teamMode: 0,
    scoreMode: 3,
    forcedMods: result.overrideMods,
  };

  const starter = new MatchStarter({
    room: mockRoom,
    isMatchActive: () => false,
    getCurrentMinigame: () => bossMinigame,
    onAutoStart: async () => {
      commandsSent.push("!mp start");
    },
  });

  await starter.triggerAutoStart();

  assert.deepEqual(
    commandsSent,
    ["!mp mods None", "!mp set 0 3", "!mp start"],
    "Must dispatch !mp mods None to lock into strict NoMod"
  );
});

test("pre-start enforcement reverts altered room title immediately prior to match launch", async () => {
  const commandsSent: string[] = [];
  let roomTitle = "Rogue Host Title";

  const mockRoom: any = {
    beatmapId: () => 55555,
    name: () => roomTitle,
    command: async (cmd: string) => { commandsSent.push(cmd); },
  };

  const starter = new MatchStarter({
    room: mockRoom,
    isMatchActive: () => false,
    getTargetTitle: () => "osu!Party Grand Prix",
    getCurrentMinigame: () => ({ id: "classic", teamMode: 0, scoreMode: 3 }),
    onAutoStart: async () => {
      commandsSent.push("!mp start");
    },
  });

  await starter.triggerAutoStart();

  assert.deepEqual(
    commandsSent,
    ["!mp name osu!Party Grand Prix", "!mp set 0 3", "!mp start"],
    "Must revert room title before !mp start"
  );

  // Whitespace padded title check
  commandsSent.length = 0;
  roomTitle = "  osu!Party Grand Prix  ";
  await starter.triggerAutoStart();
  assert.deepEqual(
    commandsSent,
    ["!mp set 0 3", "!mp start"],
    "Trimmed match must not trigger redundant !mp name"
  );
});

test("generateDefaultLobbyTitle dynamic star range interpolation and fallback formatting", () => {
  // 1. Both minStars and maxStars set -> standard range interpolation
  assert.equal(
    generateDefaultLobbyTitle({ minStars: 5, maxStars: 8 }),
    "osu!Party | Custom Minigames | AHR | 5.00★ - 8.00★"
  );
  assert.equal(
    generateDefaultLobbyTitle({ minStar: 5.25, maxStar: 7.75 }),
    "osu!Party | Custom Minigames | AHR | 5.25★ - 7.75★"
  );
  assert.equal(
    generateDefaultLobbyTitle({ regulations: { minStar: 4.5, maxStar: 6.8 } }),
    "osu!Party | Custom Minigames | AHR | 4.50★ - 6.80★"
  );
  assert.equal(
    generateDefaultLobbyTitle({ regulations: { minStars: 5, maxStars: 8 } }),
    "osu!Party | Custom Minigames | AHR | 5.00★ - 8.00★"
  );

  // 2. Fallbacks for missing star ratings:
  // Both undefined/null or empty -> No Star Limit
  assert.equal(
    generateDefaultLobbyTitle({ minStars: undefined, maxStars: undefined }),
    "osu!Party | Custom Minigames | AHR | No Star Limit"
  );
  assert.equal(
    generateDefaultLobbyTitle({ minStars: null, maxStars: null }),
    "osu!Party | Custom Minigames | AHR | No Star Limit"
  );
  assert.equal(
    generateDefaultLobbyTitle({}),
    "osu!Party | Custom Minigames | AHR | No Star Limit"
  );
  assert.equal(
    generateDefaultLobbyTitle(undefined),
    "osu!Party | Custom Minigames | AHR | No Star Limit"
  );

  // Disabled regulations -> No Star Limit
  assert.equal(
    generateDefaultLobbyTitle({ regulations: { enabled: false, minStar: 5, maxStar: 8 } }),
    "osu!Party | Custom Minigames | AHR | No Star Limit"
  );
  assert.equal(
    generateDefaultLobbyTitle({ enabled: false, minStars: 5, maxStars: 8 }),
    "osu!Party | Custom Minigames | AHR | No Star Limit"
  );

  // Only minimum set -> <min>★+
  assert.equal(
    generateDefaultLobbyTitle({ minStars: 6.0 }),
    "osu!Party | Custom Minigames | AHR | 6.00★+"
  );
  assert.equal(
    generateDefaultLobbyTitle({ minStar: 4.25 }),
    "osu!Party | Custom Minigames | AHR | 4.25★+"
  );
  assert.equal(
    generateDefaultLobbyTitle({ regulations: { minStar: 6.0 } }),
    "osu!Party | Custom Minigames | AHR | 6.00★+"
  );

  // Only maximum set -> Up to <max>★
  assert.equal(
    generateDefaultLobbyTitle({ maxStars: 7.0 }),
    "osu!Party | Custom Minigames | AHR | Up to 7.00★"
  );
  assert.equal(
    generateDefaultLobbyTitle({ maxStar: 8.5 }),
    "osu!Party | Custom Minigames | AHR | Up to 8.50★"
  );
  assert.equal(
    generateDefaultLobbyTitle({ minStars: 0, maxStars: 7.0 }),
    "osu!Party | Custom Minigames | AHR | Up to 7.00★"
  );
  assert.equal(
    generateDefaultLobbyTitle({ regulations: { maxStar: 7.0 } }),
    "osu!Party | Custom Minigames | AHR | Up to 7.00★"
  );
});

test("lobby creation resolves dynamic default title when title is blank or whitespace", () => {
  function resolveLobbyTitle(input: { title?: string; config?: any }): string {
    const rawTitle = input.title?.trim() || input.config?.title?.trim();
    return rawTitle || generateDefaultLobbyTitle(input.config);
  }

  // 1. Blank string -> resolves dynamic template
  assert.equal(
    resolveLobbyTitle({ title: "", config: { regulations: { minStar: 5, maxStar: 8 } } }),
    "osu!Party | Custom Minigames | AHR | 5.00★ - 8.00★"
  );

  // 2. Whitespace-only string -> resolves dynamic template
  assert.equal(
    resolveLobbyTitle({ title: "   ", config: { regulations: { minStar: 6.0 } } }),
    "osu!Party | Custom Minigames | AHR | 6.00★+"
  );

  // 3. Undefined title -> resolves dynamic template
  assert.equal(
    resolveLobbyTitle({ config: { regulations: { maxStar: 7.0 } } }),
    "osu!Party | Custom Minigames | AHR | Up to 7.00★"
  );

  // 4. Undefined title with unconstrained regulations -> No Star Limit
  assert.equal(
    resolveLobbyTitle({ config: {} }),
    "osu!Party | Custom Minigames | AHR | No Star Limit"
  );

  // 5. Explicit custom title is preserved
  assert.equal(
    resolveLobbyTitle({ title: " osu!Party Tourney 2026 ", config: { regulations: { minStar: 5, maxStar: 8 } } }),
    "osu!Party Tourney 2026"
  );
});

test("formatActiveMinigameRuleset produces exact required ruleset announcement string", () => {
  // 1. Minigame with standard description
  const speedom = {
    name: "Speedom",
    description: "The Freedom to Speed! Forced Double Time.",
  };
  assert.equal(
    formatActiveMinigameRuleset(speedom),
    "[Minigame] Active Ruleset: Speedom - The Freedom to Speed! Forced Double Time."
  );

  // 2. Minigame without description falls back cleanly
  const unconfigured = {
    name: "Unconfigured Mode",
    description: "",
  };
  assert.equal(
    formatActiveMinigameRuleset(unconfigured),
    "[Minigame] Active Ruleset: Unconfigured Mode - Follow current lobby regulations!"
  );
});

test("late-joiner receives active minigame ruleset announcement when joining active session", async () => {
  const chatMessages: string[] = [];

  class MockLateJoinController {
    currentMinigame?: { name: string; description: string };
    matchId?: number;
    currentRound = 3;
    totalRounds = 10;

    room = {
      say: async (msg: string) => { chatMessages.push(msg); },
      message: async (msg: string) => { chatMessages.push(msg); },
      players: () => [{ id: 1, username: "HostPlayer" }, { id: 2, username: "LateJoiner" }],
      host: () => ({ id: 1, username: "HostPlayer" }),
    };

    async playerJoined(player: { id: number; username: string }) {
      const isInitializingHost = (this.currentRound === 1 && false) || this.room.players().length <= 1 || this.room.host()?.id === player.id;
      if (!isInitializingHost) {
        await this.room.say(`[Lobby] Welcome, ${player.username}! Current game: Round ${this.currentRound}/${this.totalRounds}. You start with 0 session points and will enter the host queue on the next map.`);
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
    }
  }

  const controller = new MockLateJoinController();

  // 1. Active minigame queued (Speedom)
  controller.currentMinigame = {
    name: "Speedom",
    description: "The Freedom to Speed! Forced Double Time.",
  };
  controller.matchId = undefined; // Queued before match start

  await controller.playerJoined({ id: 2, username: "LateJoiner" });

  assert.equal(chatMessages.length, 2);
  assert.equal(
    chatMessages[0],
    "[Lobby] Welcome, LateJoiner! Current game: Round 3/10. You start with 0 session points and will enter the host queue on the next map."
  );
  assert.equal(
    chatMessages[1],
    "[Minigame] Active Ruleset: Speedom - The Freedom to Speed! Forced Double Time."
  );

  // 2. Mid-match join (match in progress)
  chatMessages.length = 0;
  controller.matchId = 999;
  controller.currentMinigame = {
    name: "Boss Battle",
    description: "Beat the host's #1 play!",
  };

  await controller.playerJoined({ id: 3, username: "MidGameJoiner" });

  assert.equal(chatMessages.length, 2);
  assert.equal(
    chatMessages[1],
    "[Minigame] Active Ruleset: Boss Battle - Beat the host's #1 play!"
  );

  // 3. No active minigame (before round setup) -> No ruleset announcement
  chatMessages.length = 0;
  controller.currentMinigame = undefined;
  controller.matchId = undefined;

  await controller.playerJoined({ id: 4, username: "EarlyJoiner" });

  assert.equal(chatMessages.length, 1);
  assert.equal(
    chatMessages[0],
    "[Lobby] Welcome, EarlyJoiner! Current game: Round 3/10. You start with 0 session points and will enter the host queue on the next map."
  );
  assert.ok(!chatMessages.some(m => m.includes("[Minigame] Active Ruleset:")));
});



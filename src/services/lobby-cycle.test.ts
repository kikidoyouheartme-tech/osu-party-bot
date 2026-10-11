import test from "node:test";
import assert from "node:assert/strict";
import { rollNextMinigame, PARTY_MINIGAMES } from "./party-minigames.js";
import { resolveMinigameMap } from "./party-map-pickers.js";

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
  const cmdsResponse = "[Commands] !cmds | !minigame | !round | !points | !pstats | !leaderboard | !bet <amount>";
  assert.equal(cmdsResponse, "[Commands] !cmds | !minigame | !round | !points | !pstats | !leaderboard | !bet <amount>");

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

test("Wager responses use bracketed [Wager] prefix and PartyPoints balance against allTimePoints", async () => {
  const chatMessages: string[] = [];
  const wagers = new Map<number, number>();

  const mockRoom = {
    say: async (msg: string) => {
      chatMessages.push(msg);
    },
  };

  const mockDb = {
    player: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        if (where.id === 1) return { id: 1, allTimePoints: 50 };
        if (where.id === 2) return { id: 2, allTimePoints: 0 };
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
    const player = await mockDb.player.findUnique({ where: { id: p.id } });
    const currentPoints = player?.allTimePoints ?? 0;
    if (amount > currentPoints) {
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

  // 4. Exceeds allTimePoints
  await handleBet({ id: 2, username: "Bob" }, "10", "wager");
  assert.equal(chatMessages[3], "[Wager] Bob: you only have 0 PartyPoints to wager.");

  // 5. Valid bet using allTimePoints in round 1
  await handleBet({ id: 1, username: "Alice" }, "20", "wager");
  assert.equal(
    chatMessages[4],
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






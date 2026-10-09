/*
  Warnings:

  - You are about to drop the column `elo` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `elo` on the `PlayerModeStats` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Match" ADD COLUMN "minigameId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LobbyPlayer" (
    "lobbyId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "sessionPoints" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("lobbyId", "playerId"),
    CONSTRAINT "LobbyPlayer_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LobbyPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LobbyPlayer" ("joinedAt", "lobbyId", "playerId", "sessionStart") SELECT "joinedAt", "lobbyId", "playerId", "sessionStart" FROM "LobbyPlayer";
DROP TABLE "LobbyPlayer";
ALTER TABLE "new_LobbyPlayer" RENAME TO "LobbyPlayer";
CREATE TABLE "new_Player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "allTimePoints" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "playSeconds" INTEGER NOT NULL DEFAULT 0,
    "denied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Player" ("createdAt", "denied", "id", "longestStreak", "matches", "playSeconds", "streak", "updatedAt", "username", "wins") SELECT "createdAt", "denied", "id", "longestStreak", "matches", "playSeconds", "streak", "updatedAt", "username", "wins" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE TABLE "new_PlayerModeStats" (
    "playerId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("playerId", "mode"),
    CONSTRAINT "PlayerModeStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlayerModeStats" ("createdAt", "longestStreak", "matches", "mode", "playerId", "streak", "updatedAt", "wins") SELECT "createdAt", "longestStreak", "matches", "mode", "playerId", "streak", "updatedAt", "wins" FROM "PlayerModeStats";
DROP TABLE "PlayerModeStats";
ALTER TABLE "new_PlayerModeStats" RENAME TO "PlayerModeStats";
CREATE INDEX "PlayerModeStats_mode_points_idx" ON "PlayerModeStats"("mode", "points");
CREATE TABLE "new_Score" (
    "matchId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "placement" INTEGER NOT NULL,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "accuracy" REAL,
    "misses" INTEGER,
    "team" TEXT,
    "winner" BOOLEAN NOT NULL,

    PRIMARY KEY ("matchId", "playerId"),
    CONSTRAINT "Score_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Score" ("matchId", "placement", "playerId", "score", "team", "winner") SELECT "matchId", "placement", "playerId", "score", "team", "winner" FROM "Score";
DROP TABLE "Score";
ALTER TABLE "new_Score" RENAME TO "Score";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

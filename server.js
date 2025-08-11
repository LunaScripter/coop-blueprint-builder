import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const nanoid = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

// --- Tile constants ---
const TILES = { EMPTY: 0, WALL: 1, WINDOW: 2, DOOR: 3, ROOF: 4 };
const TILE_LABELS = ["Empty", "Wall", "Window", "Door", "Roof"];

// --- In-memory rooms ---
// rooms[code] = { code, players:Set<socket.id>, gridW,gridH, board, blueprint, startedAt, seconds, locked }
const rooms = {};

function makeGrid(w, h, fill = TILES.EMPTY) {
  return Array.from({ length: h }, () => Array(w).fill(fill));
}

// Simple top-down "house-ish" blueprint
function makeBlueprint(w, h) {
  const g = makeGrid(w, h, TILES.EMPTY);
  const left = 2, right = w - 3, top = 2, bot = h - 3;

  // outer walls
  for (let x = left; x <= right; x++) {
    g[top][x] = TILES.WALL;
    g[bot][x] = TILES.WALL;
  }
  for (let y = top; y <= bot; y++) {
    g[y][left] = TILES.WALL;
    g[y][right] = TILES.WALL;
  }

  // interior cross wall
  const midY = Math.floor((top + bot) / 2);
  for (let x = left + 1; x < right; x++) g[midY][x] = TILES.WALL;

  // doors (bottom wall + interior)
  g[bot][Math.floor((left + right) / 2)] = TILES.DOOR;
  g[midY][Math.floor((left + right) / 2) - 2] = TILES.DOOR;

  // windows (two front, two top)
  g[top][left + 2] = TILES.WINDOW;
  g[top][right - 2] = TILES.WINDOW;
  g[bot][left + 2] = TILES.WINDOW;
  g[bot][right - 2] = TILES.WINDOW;

  // roof hint (just a stripe above top wall)
  for (let x = left + 1; x < right; x++) g[top - 1][x] = TILES.ROOF;

  return g;
}

function newRoom() {
  const code = nanoid();
  const gridW = 12, gridH = 12;
  const seconds = 90;
  rooms[code] = {
    code,
    players: new Set(),
    gridW,
    gridH,
    board: makeGrid(gridW, gridH, TILES.EMPTY),
    blueprint: makeBlueprint(gridW, gridH),
    startedAt: null,
    seconds,
    locked: false
  };
  return rooms[code];
}

// Scoring: percent match on non-empty blueprint tiles, minus small penalty for wrong placements
function scoreRoom(r) {
  let totalTargets = 0;
  let matches = 0;
  let wrong = 0;
  for (let y = 0; y < r.gridH; y++) {
    for (let x = 0; x < r.gridW; x++) {
      const t = r.blueprint[y][x];
      const p = r.board[y][x];
      if (t !== TILES.EMPTY) totalTargets++;
      if (p === t && t !== TILES.EMPTY) matches++;
      if (p !== t && p !== TILES.EMPTY) wrong++;
    }
  }
  const accuracy = totalTargets ? Math.round((matches / totalTargets) * 100) : 100;
  const penalty = Math.min(20, wrong * 1);
  const finalScore = Math.max(0, Math.min(100, accuracy - penalty));
  let stars = 1;
  if (finalScore >= 85) stars = 3;
  else if (finalScore >= 65) stars = 2;
  return { accuracy, wrong, finalScore, stars, totalTargets, matches };
}

// Clean out empty rooms after a while
function maybeCleanup(code) {
  const r = rooms[code];
  if (!r) return;
  if (r.players.size === 0) {
    setTimeout(() => {
      const rr = rooms[code];
      if (rr && rr.players.size === 0) delete rooms[code];
    }, 5 * 60 * 1000);
  }
}

io.on("connection", (socket) => {
  let joinedCode = null;

  socket.on("createRoom", (cb) => {
    const r = newRoom();
    r.players.add(socket.id);
    joinedCode = r.code;
    socket.join(r.code);
    cb?.({
      ok: true,
      code: r.code,
      gridW: r.gridW,
      gridH: r.gridH,
      seconds: r.seconds,
      palette: TILE_LABELS,
      board: r.board,
      blueprint: r.blueprint
    });
    io.to(r.code).emit("roomUpdate", { players: r.players.size });
  });

  socket.on("joinRoom", ({ code }, cb) => {
    const r = rooms[code];
    if (!r) return cb?.({ ok: false, error: "Room not found." });
    if (r.locked) return cb?.({ ok: false, error: "Round in progress; try later." });
    r.players.add(socket.id);
    joinedCode = code;
    socket.join(code);
    cb?.({
      ok: true,
      code,
      gridW: r.gridW,
      gridH: r.gridH,
      seconds: r.seconds,
      palette: TILE_LABELS,
      board: r.board,
      blueprint: r.blueprint
    });
    io.to(code).emit("roomUpdate", { players: r.players.size });
  });

  socket.on("placeTile", ({ code, x, y, tile }) => {
    const r = rooms[code];
    if (!r || r.locked) return;
    if (x < 0 || y < 0 || x >= r.gridW || y >= r.gridH) return;

    // simple rules: doors/windows must be on a wall cell in blueprint
    const target = r.blueprint[y][x];
    if ((tile === TILES.DOOR || tile === TILES.WINDOW) && target === TILES.EMPTY) {
      return; // ignore invalid placement
    }

    r.board[y][x] = tile;
    io.to(code).emit("gridUpdate", { x, y, tile });
  });

  socket.on("review", ({ code }, cb) => {
    const r = rooms[code];
    if (!r) return cb?.({ ok: false, error: "Room not found." });
    r.locked = true;
    const res = scoreRoom(r);
    io.to(code).emit("scored", res);
    cb?.({ ok: true, ...res });
  });

  socket.on("nextRound", ({ code }) => {
    const r = rooms[code];
    if (!r) return;
    r.board = makeGrid(r.gridW, r.gridH, TILES.EMPTY);
    r.blueprint = makeBlueprint(r.gridW, r.gridH);
    r.locked = false;
    io.to(code).emit("roundReset", { board: r.board, blueprint: r.blueprint });
  });

  socket.on("disconnect", () => {
    if (joinedCode && rooms[joinedCode]) {
      const r = rooms[joinedCode];
      r.players.delete(socket.id);
      io.to(joinedCode).emit("roomUpdate", { players: r.players.size });
      maybeCleanup(joinedCode);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log("Server running on", PORT);
});

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

const TILES = { EMPTY:0, WALL:1, WINDOW:2, DOOR:3, ROOF:4 };

const COMP_ROUNDS = [
  { gridW:20, gridH:18, previewSec:6,  buildSec:90,  editCap:400 },
  { gridW:22, gridH:18, previewSec:4,  buildSec:90,  editCap:450 },
  { gridW:24, gridH:18, previewSec:2,  buildSec:105, editCap:500 },
];
const TEAM_ROUND =  { gridW:28, gridH:20, previewSec:6, buildSec:120, peekTokens:2, peekDurSec:2, editCap:1400 };

function makeGrid(w,h,fill=TILES.EMPTY){ return Array.from({length:h},()=>Array(w).fill(fill)); }
const rnd = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;

/** side-view façade blueprint */
function makeFacadeBlueprint(w,h){
  const g = makeGrid(w,h,TILES.EMPTY);
  const baseY = h - 3;
  const houseW = rnd(12, Math.min(18,w-4));
  const houseH = rnd(8, Math.min(12,h-4));
  const left = Math.floor((w - houseW)/2);
  const right = left + houseW - 1;
  const top = baseY - houseH + 1;
  for (let x=left;x<=right;x++){ g[top][x]=TILES.WALL; g[baseY][x]=TILES.WALL; }
  for (let y=top;y<=baseY;y++){ g[y][left]=TILES.WALL; g[y][right]=TILES.WALL; }
  const doorX = rnd(left+2,right-3);
  g[baseY][doorX]=TILES.DOOR; g[baseY][doorX+1]=TILES.DOOR;
  const rowTop = top + Math.floor(houseH*0.35);
  const rowBot = top + Math.floor(houseH*0.65);
  const candidates = [
    [left+3,rowTop],[right-3,rowTop],
    [left+Math.max(5,Math.floor(houseW*0.35)), rowBot],
    [right-Math.max(5,Math.floor(houseW*0.35)), rowBot]
  ];
  for(const [x,y] of candidates){ if(x!==doorX && x!==(doorX+1)) g[y][x]=TILES.WINDOW; }
  const roofH = rnd(2,4);
  for(let r=0;r<roofH;r++){
    const y = top - 1 - r;
    const lx = left + r + 1;
    const rx = right - r - 1;
    for(let x=lx;x<=rx;x++) g[y][x]=TILES.ROOF;
  }
  return g;
}

function boardsEqual(b, bp){
  const h = bp.length, w = bp[0].length;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    if((b[y][x]||0)!==bp[y][x]) return false;
  }
  return true;
}
function scoreAccuracy(board, bp){
  let total=0, match=0, wrong=0;
  for(let y=0;y<bp.length;y++) for(let x=0;x<bp[0].length;x++){
    const t=bp[y][x], p=board[y][x]||0;
    if(t!==TILES.EMPTY) total++;
    if(p===t && t!==TILES.EMPTY) match++;
    if(p!==t && p!==TILES.EMPTY) wrong++;
  }
  const accuracy = total? Math.round((match/total)*100):100;
  return { accuracy, wrong };
}

const rooms = {};
function newRoom(){
  const code = nanoid();
  rooms[code] = {
    code,
    hostId: null,
    players: new Set(),
    spectators: new Set(),
    ready: new Set(),
    matchType: "competitive", // "competitive" | "team"
    phase: "lobby",
    totalRounds: 3,
    roundNum: 0,

    gridW: 0, gridH: 0,
    blueprint: null,

    // Competitive
    boardsByPlayer: {},
    finished: [],
    edits: {},
    editCap: 400,
    submits: {},
    lastSubmit: {},

    // Team
    teamBoard: null,
    peekUntil: 0,
    peeksRemaining: 0,

    // Timers
    countdownEndsAt: 0,
    previewEndsAt: 0,
    buildEndsAt: 0,
    timers: { countdown:null, preview:null, build:null, results:null },

    // Points across rounds
    points: {}
  };
  return rooms[code];
}

function canStart(r){
  const n = r.players.size;
  if(r.phase!=="lobby") return false;
  const allReady = r.ready.size===n && n>=2;
  return allReady && n>=2;
}

function broadcastLobby(r){
  io.to(r.code).emit("lobby", {
    code: r.code,
    hostId: r.hostId,
    matchType: r.matchType,
    players: Array.from(r.players),
    readyCount: r.ready.size,
    canStart: canStart(r),
    phase: r.phase,
    roundNum: r.roundNum,
    totalRounds: r.totalRounds
  });
}

function clearTimers(r){
  for(const k of ["countdown","preview","build","results"]){
    if(r.timers[k]) { clearTimeout(r.timers[k]); r.timers[k]=null; }
  }
}

function abortMatch(r){
  clearTimers(r);
  r.phase = "lobby";
  r.roundNum = 0;
  r.ready.clear();
  r.blueprint = null;
  r.boardsByPlayer = {};
  r.teamBoard = null;
  r.finished = [];
  r.peekUntil = 0; r.peeksRemaining = 0;
  broadcastLobby(r);
}

function setupRound(r){
  r.roundNum += 1;
  if(r.matchType==="competitive"){
    const cfg = COMP_ROUNDS[r.roundNum-1] || COMP_ROUNDS[COMP_ROUNDS.length-1];
    r.gridW = cfg.gridW; r.gridH = cfg.gridH; r.editCap = cfg.editCap;
    r.blueprint = makeFacadeBlueprint(r.gridW,r.gridH);
    r.boardsByPlayer = {};
    r.finished = [];
    r.edits = {}; r.submits = {}; r.lastSubmit = {};
    for(const id of r.players){ r.boardsByPlayer[id] = makeGrid(r.gridW,r.gridH,TILES.EMPTY); r.edits[id]=0; r.submits[id]=0; }
  } else { // team
    const cfg = TEAM_ROUND;
    r.gridW = cfg.gridW; r.gridH = cfg.gridH; r.editCap = cfg.editCap;
    r.blueprint = makeFacadeBlueprint(r.gridW,r.gridH);
    r.teamBoard = makeGrid(r.gridW,r.gridH,TILES.EMPTY);
    r.peeksRemaining = cfg.peekTokens;
    r.peekUntil = 0;
  }
}

function beginCountdown(r){
  r.phase = "countdown";
  r.countdownEndsAt = Date.now() + 3000;
  io.to(r.code).emit("phase", { phase:r.phase, roundNum:r.roundNum, totalRounds:r.totalRounds, countdownEndsAt:r.countdownEndsAt, matchType:r.matchType });
  r.timers.countdown = setTimeout(()=> beginPreview(r), 3000);
}
function beginPreview(r){
  r.phase = "preview";
  const sec = (r.matchType==="competitive" ? (COMP_ROUNDS[r.roundNum-1]?.previewSec || 4) : TEAM_ROUND.previewSec);
  r.previewEndsAt = Date.now() + sec*1000;
  io.to(r.code).emit("phase", { phase:r.phase, roundNum:r.roundNum, totalRounds:r.totalRounds, previewEndsAt:r.previewEndsAt, matchType:r.matchType, peeksRemaining:r.peeksRemaining||0 });
  r.timers.preview = setTimeout(()=> beginBuild(r), sec*1000);
}
function beginBuild(r){
  r.phase = "build";
  const sec = (r.matchType==="competitive" ? (COMP_ROUNDS[r.roundNum-1]?.buildSec || 90) : TEAM_ROUND.buildSec);
  r.buildEndsAt = Date.now() + sec*1000;
  io.to(r.code).emit("phase", { phase:r.phase, roundNum:r.roundNum, totalRounds:r.totalRounds, buildEndsAt:r.buildEndsAt, matchType:r.matchType, peeksRemaining:r.peeksRemaining||0 });
  r.timers.build = setTimeout(()=> finishRound(r), sec*1000);
}
function finishRound(r){
  clearTimers(r);
  r.phase = "review";
  const results = { roundNum:r.roundNum, entries:[] };

  if(r.matchType==="competitive"){
    const ranks = {};
    r.finished.forEach((f,i)=>{ ranks[f.id]=i+1; });
    for(const id of r.players){
      const b = r.boardsByPlayer[id];
      const {accuracy, wrong} = scoreAccuracy(b, r.blueprint);
      let pts;
      if(ranks[id]===1) pts = 100;
      else if(ranks[id]===2) pts = 80;
      else if(ranks[id]===3) pts = 65;
      else pts = accuracy;
      r.points[id] = (r.points[id]||0) + pts;
      results.entries.push({ id, rank:ranks[id]||null, accuracy, wrong, pts, total:r.points[id] });
    }
    results.entries.sort((a,b)=>{
      if(a.rank && b.rank) return a.rank-b.rank;
      if(a.rank && !b.rank) return -1;
      if(!a.rank && b.rank) return 1;
      return b.pts - a.pts;
    });
  } else {
    const b = r.teamBoard;
    const {accuracy, wrong} = scoreAccuracy(b, r.blueprint);
    const peekSpent = (TEAM_ROUND.peekTokens - (r.peeksRemaining||0));
    let final = Math.max(0, Math.min(100, accuracy - Math.min(20, wrong*1) - peekSpent*5));
    for(const id of r.players){ r.points[id] = (r.points[id]||0) + final; }
    results.entries.push({ team:true, accuracy, wrong, pts:final, total:final });
  }

  io.to(r.code).emit("roundResults", results);

  if(r.roundNum < r.totalRounds){
    r.phase = "results";
    r.timers.results = setTimeout(()=>{
      setupRound(r);
      for(const id of r.players){
        const sock = io.sockets.sockets.get(id);
        if(!sock) continue;
        if(r.matchType==="competitive"){
          sock.emit("roundSetup", { gridW:r.gridW, gridH:r.gridH, blueprint:r.blueprint, board:r.boardsByPlayer[id], matchType:r.matchType, roundNum:r.roundNum, totalRounds:r.totalRounds });
        } else {
          sock.emit("roundSetup", { gridW:r.gridW, gridH:r.gridH, blueprint:r.blueprint, board:r.teamBoard, matchType:r.matchType, roundNum:r.roundNum, totalRounds:r.totalRounds, peeksRemaining:r.peeksRemaining });
        }
      }
      beginCountdown(r);
    }, 5500);
  } else {
    const summary = [];
    for(const id of r.players){ summary.push({ id, total:r.points[id]||0 }); }
    summary.sort((a,b)=> b.total-a.total);
    io.to(r.code).emit("matchSummary", { entries: summary });
    r.phase = "lobby";
    r.roundNum = 0;
    r.ready.clear();
    r.blueprint = null;
    r.boardsByPlayer = {};
    r.teamBoard = null;
    r.finished = [];
    r.peekUntil = 0; r.peeksRemaining = 0;
    broadcastLobby(r);
  }
}

io.on("connection",(socket)=>{
  let joined=null;

  socket.on("createRoom",(cb)=>{
    const r = newRoom();
    r.hostId = socket.id;
    r.players.add(socket.id);
    joined = r.code;
    socket.join(r.code);
    cb?.({ ok:true, code:r.code, selfId:socket.id, hostId:r.hostId, matchType:r.matchType, phase:r.phase, roundNum:r.roundNum, totalRounds:r.totalRounds });
    broadcastLobby(r);
  });

  socket.on("joinRoom",({code},cb)=>{
    const r = rooms[code];
    if(!r) return cb?.({ ok:false, error:"Room not found." });
    socket.join(code); joined=code;
    if(r.phase!=="lobby"){ r.spectators.add(socket.id); }
    else { r.players.add(socket.id); }
    cb?.({ ok:true, code, selfId:socket.id, hostId:r.hostId, matchType:r.matchType, phase:r.phase, roundNum:r.roundNum, totalRounds:r.totalRounds, spectator: r.phase!=="lobby" });
    // Immediately tell the joiner the current mode so they see the selected radio
    socket.emit("modeUpdate",{ matchType:r.matchType });
    broadcastLobby(r);
  });

  socket.on("setMatchType",({code, matchType})=>{
    const r = rooms[code]; if(!r) return;
    if(socket.id!==r.hostId) return;
    if(r.phase!=="lobby") return;
    if(matchType!=="competitive" && matchType!=="team") return;
    r.matchType = matchType;
    // broadcast explicit mode change so non-host radios update instantly
    io.to(r.code).emit("modeUpdate",{ matchType:r.matchType });
    broadcastLobby(r);
  });

  socket.on("setReady",({code, ready})=>{
    const r = rooms[code]; if(!r) return;
    if(!r.players.has(socket.id)) return;
    if(ready) r.ready.add(socket.id); else r.ready.delete(socket.id);
    broadcastLobby(r);
  });

  socket.on("startMatch",({code})=>{
    const r = rooms[code]; if(!r) return;
    if(socket.id!==r.hostId) return;
    if(!canStart(r)) return;
    r.points = {};
    r.roundNum = 0;
    setupRound(r);
    for(const id of r.players){
      const sock = io.sockets.sockets.get(id);
      if(!sock) continue;
      if(r.matchType==="competitive"){
        sock.emit("roundSetup", { gridW:r.gridW, gridH:r.gridH, blueprint:r.blueprint, board:r.boardsByPlayer[id], matchType:r.matchType, roundNum:r.roundNum, totalRounds:r.totalRounds });
      } else {
        sock.emit("roundSetup", { gridW:r.gridW, gridH:r.gridH, blueprint:r.blueprint, board:r.teamBoard, matchType:r.matchType, roundNum:r.roundNum, totalRounds:r.totalRounds, peeksRemaining:r.peeksRemaining });
      }
    }
    beginCountdown(r);
  });

  socket.on("peek",({code})=>{
    const r = rooms[code]; if(!r) return;
    if(r.matchType!=="team") return;
    if(r.phase!=="build") return;
    if(r.peeksRemaining<=0) return;
    r.peeksRemaining--;
    r.peekUntil = Date.now() + TEAM_ROUND.peekDurSec*1000;
    io.to(r.code).emit("peekWindow",{ until:r.peekUntil, peeksRemaining:r.peeksRemaining });
  });

  socket.on("placeTile",({code,x,y,tile})=>{
    const r = rooms[code]; if(!r) return;
    if(r.phase!=="build") return;
    const key = `last:${socket.id}`;
    const now = Date.now();
    socket.data[key] = socket.data[key]||0;
    if(now - socket.data[key] < 150) return;
    socket.data[key] = now;

    if(r.matchType==="competitive"){
      if(!r.players.has(socket.id)) return;
      if(!r.boardsByPlayer[socket.id]) return;
      if(r.edits[socket.id]>=r.editCap) return;
      r.boardsByPlayer[socket.id][y][x] = tile;
      r.edits[socket.id]++;
      io.to(r.code).emit("gridUpdate",{ owner:socket.id, x,y,tile });

      if(!r.finished.find(f=>f.id===socket.id) && boardsEqual(r.boardsByPlayer[socket.id], r.blueprint)){
        const rank = r.finished.length + 1;
        r.finished.push({ id:socket.id, rank, finishedAt:Date.now() });
        io.to(r.code).emit("playerFinished",{ id:socket.id, rank });
        if(r.finished.length === r.players.size){
          finishRound(r);
        }
      }
    } else {
      if(!r.players.has(socket.id)) return;
      r.teamBoard[y][x] = tile;
      io.to(r.code).emit("gridUpdate",{ x,y,tile });
    }
  });

  socket.on("submit",({code})=>{
    const r = rooms[code]; if(!r) return;
    if(r.matchType!=="competitive") return;
    if(r.phase!=="build") return;
    if(!r.players.has(socket.id)) return;

    const last = r.lastSubmit[socket.id]||0;
    if(Date.now()-last < 1000) return;
    r.lastSubmit[socket.id] = Date.now();
    r.submits[socket.id] = (r.submits[socket.id]||0)+1;

    if(!r.finished.find(f=>f.id===socket.id) && boardsEqual(r.boardsByPlayer[socket.id], r.blueprint)){
      const rank = r.finished.length + 1;
      r.finished.push({ id:socket.id, rank, finishedAt:Date.now() });
      io.to(r.code).emit("playerFinished",{ id:socket.id, rank });
      if(r.finished.length === r.players.size){
        finishRound(r);
      }
    }
  });

  socket.on("disconnect",()=>{
    if(!joined) return;
    const r = rooms[joined]; if(!r) return;
    const leftId = socket.id;

    r.players.delete(leftId);
    r.spectators.delete(leftId);
    r.ready.delete(leftId);

    if(r.hostId===leftId){
      r.hostId = Array.from(r.players)[0] || null;
    }

    if(r.phase!=="lobby"){
      // Always tell clients someone left
      io.to(r.code).emit("opponentLeft",{ id:leftId });
      // If it's 1v1 (or now <2), show notice briefly then abort to lobby
      if(r.players.size < 2){
        setTimeout(()=> abortMatch(r), 800);
        return;
      }
    }
    broadcastLobby(r);
  });
});

httpServer.listen(PORT, ()=> console.log("Server running on", PORT));

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
const TILE_LABELS = ["Empty","Wall","Window","Door","Roof"];

const DEFAULT_CONFIG = {
  mode: "memory",                  // "memory" | "silhouette" | "fog"
  memory: { previewSeconds: 8, peekTokens: 3, peekDuration: 2 },
  silhouette: { showCounts: true },
  fog: { radius: 3, widePeek: false, widePeekCooldownMs: 10000 }
};

const rooms = {};
const lastPlace = new Map(); // anti-spam per socket

const rnd = (a,b)=> Math.floor(Math.random()*(b-a+1))+a;
function makeGrid(w,h,fill=TILES.EMPTY){ return Array.from({length:h},()=>Array(w).fill(fill)); }

function makeFacadeBlueprint(w,h){
  const g = makeGrid(w,h,TILES.EMPTY);

  const baseY = h - 3;
  const houseW = rnd(12,16);
  const houseH = rnd(8,10);
  const left = Math.floor((w - houseW)/2);
  const right = left + houseW - 1;
  const top = baseY - houseH + 1;

  for (let x=left; x<=right; x++){ g[top][x]=TILES.WALL; g[baseY][x]=TILES.WALL; }
  for (let y=top; y<=baseY; y++){ g[y][left]=TILES.WALL; g[y][right]=TILES.WALL; }

  const doorX = rnd(left+2, right-3);
  g[baseY][doorX]=TILES.DOOR; g[baseY][doorX+1]=TILES.DOOR;

  const rowTop = top + Math.floor(houseH*0.35);
  const rowBot = top + Math.floor(houseH*0.65);
  const wx1 = left + 3, wx2 = right - 3;
  const wx3 = left + Math.max(5, Math.floor(houseW*0.35));
  const wx4 = right - Math.max(5, Math.floor(houseW*0.35));
  for (const [x,y] of [[wx1,rowTop],[wx2,rowTop],[wx3,rowBot],[wx4,rowBot]]) {
    if (x!==doorX && x!==(doorX+1)) g[y][x]=TILES.WINDOW;
  }

  const roofH = rnd(2,4);
  for (let r=0;r<roofH;r++){
    const y = top - 1 - r;
    const lx = left + r + 1;
    const rx = right - r - 1;
    for (let x=lx; x<=rx; x++) g[y][x]=TILES.ROOF;
  }
  return g;
}

function countDW(board){
  let doors=0, windows=0;
  for (let row of board) for (let v of row){
    if (v===TILES.DOOR) doors++;
    else if (v===TILES.WINDOW) windows++;
  }
  return {doors, windows};
}

function newRoom() {
  const code = nanoid();
  const gridW = 20, gridH = 18;
  const blueprint = makeFacadeBlueprint(gridW,gridH);
  rooms[code] = {
    code, players:new Set(),
    gridW, gridH,
    board: makeGrid(gridW,gridH,TILES.EMPTY),
    blueprint,
    seconds: 90,
    locked: false,
    startedAt: null,
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    previewUntil: 0,
    peekUntil: 0,
    peeksRemaining: 0
  };
  return rooms[code];
}

function scoreRoom(r){
  let total=0, match=0, wrong=0;
  for(let y=0;y<r.gridH;y++) for(let x=0;x<r.gridW;x++){
    const t=r.blueprint[y][x], p=r.board[y][x];
    if(t!==TILES.EMPTY) total++;
    if(p===t && t!==TILES.EMPTY) match++;
    if(p!==t && p!==TILES.EMPTY) wrong++;
  }
  const accuracy = total? Math.round((match/total)*100):100;
  const penalty = Math.min(20, wrong*1);
  let finalScore = Math.max(0, Math.min(100, accuracy - penalty));
  if (r.config.mode==="memory"){
    const spent = (r.config.memory.peekTokens - r.peeksRemaining);
    finalScore = Math.max(0, finalScore - spent*5);
  }
  const stars = finalScore>=85?3 : finalScore>=65?2 : 1;
  return { accuracy, wrong, finalScore, stars, totalTargets:total, matches:match };
}

function maybeCleanup(code){
  const r=rooms[code]; if(!r) return;
  if(r.players.size===0){
    setTimeout(()=>{ const rr=rooms[code]; if(rr && rr.players.size===0) delete rooms[code]; }, 5*60*1000);
  }
}

io.on("connection",(socket)=>{
  let joined=null;

  socket.on("createRoom",(cb)=>{
    const r=newRoom(); r.players.add(socket.id); joined=r.code; socket.join(r.code);
    cb?.({ ok:true, code:r.code, gridW:r.gridW, gridH:r.gridH, seconds:r.seconds, palette:TILE_LABELS,
      board:r.board, blueprint:r.blueprint, config:r.config, counts:countDW(r.blueprint) });
    io.to(r.code).emit("roomUpdate",{players:r.players.size});
  });

  socket.on("joinRoom",({code},cb)=>{
    const r=rooms[code];
    if(!r) return cb?.({ok:false,error:"Room not found."});
    if(r.locked) return cb?.({ok:false,error:"Round in progress; try later."});
    r.players.add(socket.id); joined=code; socket.join(code);
    cb?.({ ok:true, code, gridW:r.gridW, gridH:r.gridH, seconds:r.seconds, palette:TILE_LABELS,
      board:r.board, blueprint:r.blueprint, config:r.config, counts:countDW(r.blueprint) });
    io.to(code).emit("roomUpdate",{players:r.players.size});
  });

  // Host starts round with config (we don't strictly verify "host" for MVP)
  socket.on("startRound",({code, config})=>{
    const r=rooms[code]; if(!r) return;
    if(config){ r.config = {...DEFAULT_CONFIG, ...config,
      memory:{...DEFAULT_CONFIG.memory, ...(config.memory||{})},
      silhouette:{...DEFAULT_CONFIG.silhouette, ...(config.silhouette||{})},
      fog:{...DEFAULT_CONFIG.fog, ...(config.fog||{})}
    }; }
    r.locked=false; r.startedAt=Date.now();
    r.previewUntil=0; r.peekUntil=0; r.peeksRemaining=0;

    if(r.config.mode==="memory"){
      r.previewUntil = Date.now() + r.config.memory.previewSeconds*1000;
      r.peeksRemaining = r.config.memory.peekTokens;
    }
    io.to(code).emit("roundStarted",{
      mode:r.config.mode,
      previewUntil:r.previewUntil,
      peeksRemaining:r.peeksRemaining,
      counts: countDW(r.blueprint),
      fog: r.config.fog
    });
  });

  // Memory peeks
  socket.on("peek",({code})=>{
    const r=rooms[code]; if(!r) return;
    if(r.config.mode!=="memory") return;
    if(r.peeksRemaining<=0) return;
    r.peeksRemaining--;
    r.peekUntil = Date.now() + r.config.memory.peekDuration*1000;
    io.to(code).emit("peekWindow",{ until:r.peekUntil, peeksRemaining:r.peeksRemaining });
  });

  // Tile placement (with small cooldown to prevent spam)
  socket.on("placeTile",({code,x,y,tile})=>{
    const now=Date.now(), last=lastPlace.get(socket.id)||0;
    if(now-last<150) return;
    lastPlace.set(socket.id, now);

    const r=rooms[code];
    if(!r || r.locked) return;
    if(x<0||y<0||x>=r.gridW||y>=r.gridH) return;
    r.board[y][x]=tile;
    io.to(code).emit("gridUpdate",{x,y,tile});
  });

  socket.on("review",({code},cb)=>{
    const r=rooms[code]; if(!r) return cb?.({ok:false,error:"Room not found."});
    r.locked=true;
    const res=scoreRoom(r);
    io.to(code).emit("scored",res);
    cb?.({ok:true,...res});
  });

  socket.on("nextRound",({code})=>{
    const r=rooms[code]; if(!r) return;
    r.board = makeGrid(r.gridW,r.gridH,TILES.EMPTY);
    r.blueprint = makeFacadeBlueprint(r.gridW,r.gridH);
    r.locked=false; r.previewUntil=0; r.peekUntil=0; r.peeksRemaining=0;
    io.to(code).emit("roundReset",{board:r.board, blueprint:r.blueprint, counts:countDW(r.blueprint)});
  });

  socket.on("disconnect",()=>{
    if(joined && rooms[joined]){ const r=rooms[joined]; r.players.delete(socket.id); io.to(joined).emit("roomUpdate",{players:r.players.size}); maybeCleanup(joined); }
  });
});

httpServer.listen(PORT,()=>console.log("Server running on",PORT));

const socket = io();
const cvs = document.getElementById('grid');
const ctx = cvs.getContext('2d');

const statusEl = document.getElementById('status');
const pcountEl = document.getElementById('pcount');
const roomLabel = document.getElementById('roomLabel');
const sessionCard = document.getElementById('sessionCard');

const modeSel = document.getElementById('mode');
const memCfg = document.getElementById('memCfg');
const silCfg = document.getElementById('silCfg');
const fogCfg = document.getElementById('fogCfg');

const memPreview = document.getElementById('memPreview');
const memPeeks = document.getElementById('memPeeks');
const memPeekDur = document.getElementById('memPeekDur');
const peekLeftEl = document.getElementById('peekLeft');
const peekBtn = document.getElementById('peekBtn');

const silCountsEl = document.getElementById('silCounts');
const winCountEl = document.getElementById('winCount');
const doorCountEl = document.getElementById('doorCount');

const fogRadEl = document.getElementById('fogRad');

const bpAlphaInput = document.getElementById('bpAlpha');

const TILES = { EMPTY:0, WALL:1, WINDOW:2, DOOR:3, ROOF:4 };
const TILE_NAMES = ["Empty","Wall","Window","Door","Roof"];
const COLORS = {
  grid:"#1a203a",
  cell:"#0f142b",
  wall:"#5b91ff",
  window:"#5bffd2",
  door:"#ffd35b",
  roof:"#ff5b9f"
};

let code=null, gridW=20, gridH=18;
let board=null, blueprint=null, cell=36, currentTile=TILES.WALL, locked=false;
let bpAlpha=0.18;

// Mode state
let config = {
  mode: "memory",
  memory: { previewSeconds: 8, peekTokens: 3, peekDuration: 2 },
  silhouette: { showCounts: true },
  fog: { radius: 3 }
};
let previewUntil = 0;
let peekUntil = 0;
let peeksRemaining = 0;
let counts = {windows:0, doors:0};

let mouseCell = {x:-999,y:-999};

// ==== UI: session ====
document.getElementById('create').onclick = ()=>{
  socket.emit('createRoom',(res)=>{
    if(!res.ok){ alert(res.error); return; }
    code=res.code; applySnapshot(res);
    roomLabel.textContent = code;
    sessionCard.style.display='none';
    statusEl.textContent="Room created. Pick a mode and Start.";
  });
};
document.getElementById('join').onclick = ()=>{
  const c = document.getElementById('code').value.trim().toUpperCase(); if(!c) return;
  socket.emit('joinRoom',{code:c},(res)=>{
    if(!res.ok){ alert(res.error); return; }
    code=c; applySnapshot(res);
    roomLabel.textContent = code;
    sessionCard.style.display='none';
    statusEl.textContent="Joined room. Wait for host to Start.";
  });
};

// Mode settings show/hide
function refreshModePanels(){
  memCfg.classList.toggle('hidden', modeSel.value!=="memory");
  silCfg.classList.toggle('hidden', modeSel.value!=="silhouette");
  fogCfg.classList.toggle('hidden', modeSel.value!=="fog");
}
modeSel.addEventListener('change', refreshModePanels);
refreshModePanels();

// Start / Review / Next
document.getElementById('start').onclick = ()=>{
  if(!code) return;
  // collect config
  config.mode = modeSel.value;
  config.memory.previewSeconds = +memPreview.value;
  config.memory.peekTokens = +memPeeks.value;
  config.memory.peekDuration = +memPeekDur.value;
  config.silhouette.showCounts = !!silCountsEl.checked;
  config.fog.radius = +fogRadEl.value;
  socket.emit('startRound',{code, config});
};
document.getElementById('review').onclick = ()=>{
  if(!code) return;
  socket.emit('review',{code}, (res)=>{ if(res&&res.ok) showScore(res); });
};
document.getElementById('nextRound').onclick = ()=>{
  if(!code) return;
  socket.emit('nextRound',{code});
};

// Peeks (memory)
peekBtn.onclick = ()=>{ if(!code) return; if(peeksRemaining>0) socket.emit('peek',{code}); };

// Palette
const palRoot = document.getElementById('palette');
[ TILES.EMPTY, TILES.WALL, TILES.WINDOW, TILES.DOOR, TILES.ROOF ].forEach(t=>{
  const b=document.createElement('button'); b.textContent=TILE_NAMES[t];
  b.onclick=()=>{ currentTile=t; hintStatus(); };
  palRoot.appendChild(b);
});
function hintStatus(){ statusEl.textContent = `Selected: ${TILE_NAMES[currentTile]}`; }
window.addEventListener('keydown',(e)=>{
  const map={'1':TILES.EMPTY,'2':TILES.WALL,'3':TILES.WINDOW,'4':TILES.DOOR,'5':TILES.ROOF};
  if(map[e.key]!=null){ currentTile=map[e.key]; hintStatus(); }
});

// Canvas interactions
cvs.addEventListener('contextmenu',e=>e.preventDefault());
cvs.addEventListener('mousedown',(e)=>{
  if(!code || locked) return;
  const {x,y}=cellFromMouse(e);
  if(x<0||y<0||x>=gridW||y>=gridH) return;
  const tile = (e.button===2)? TILES.EMPTY : currentTile;
  socket.emit('placeTile',{code,x,y,tile});
});
cvs.addEventListener('mousemove',(e)=>{
  const r=cvs.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  mouseCell = { x:Math.floor(mx/cell), y:Math.floor(my/cell) };
});

bpAlphaInput.addEventListener('input',()=>{ bpAlpha=(+bpAlphaInput.value)/100; draw(); });

function cellFromMouse(e){
  const r=cvs.getBoundingClientRect(); const mx=e.clientX-r.left, my=e.clientY-r.top;
  return { x:Math.floor(mx/cell), y:Math.floor(my/cell) };
}

function applySnapshot(res){
  gridW=res.gridW; gridH=res.gridH; board=res.board; blueprint=res.blueprint;
  config = res.config || config;
  counts = res.counts || counts;
  locked=false; previewUntil=0; peekUntil=0; peeksRemaining = config.memory.peekTokens;
  winCountEl.textContent = counts.windows; doorCountEl.textContent = counts.doors;
  resizeCanvas(); draw();
}

// ==== Drawing ====
function resizeCanvas(){
  cell = Math.floor(Math.min(820/gridW, 720/gridH, 40));
  cvs.width = gridW*cell; cvs.height = gridH*cell;
}
function draw(){
  if(!board){ ctx.clearRect(0,0,cvs.width,cvs.height); return; }
  ctx.clearRect(0,0,cvs.width,cvs.height);

  // background cells
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    ctx.fillStyle = COLORS.cell;
    ctx.fillRect(x*cell, y*cell, cell, cell);
  }

  // blueprint by mode
  const now = Date.now();
  const mode = config.mode;

  if(mode==="memory"){
    const show = (now < previewUntil) || (now < peekUntil);
    if(show) drawBlueprint((t)=>true, bpAlpha);
  } else if(mode==="silhouette"){
    // outline-only: show walls + roof; optionally show counts
    drawBlueprint((t)=> t===TILES.WALL || t===TILES.ROOF, bpAlpha);
  } else if(mode==="fog"){
    // reveal around cursor
    const rad = (config.fog?.radius||3);
    drawBlueprint((t,x,y)=>{
      const dx = x - mouseCell.x, dy = y - mouseCell.y;
      return (dx*dx + dy*dy) <= (rad*rad);
    }, bpAlpha);
  }

  // placed tiles
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    const t=board[y][x]; if(t===TILES.EMPTY) continue;
    ctx.fillStyle =
      t===TILES.WALL ? COLORS.wall :
      t===TILES.WINDOW ? COLORS.window :
      t===TILES.DOOR ? COLORS.door : COLORS.roof;
    ctx.fillRect(x*cell+4, y*cell+4, cell-8, cell-8);
  }

  // grid lines
  ctx.strokeStyle = "#1a203a";
  for(let x=0;x<=gridW;x++){ ctx.beginPath(); ctx.moveTo(x*cell,0); ctx.lineTo(x*cell,gridH*cell); ctx.stroke(); }
  for(let y=0;y<=gridH;y++){ ctx.beginPath(); ctx.moveTo(0,y*cell); ctx.lineTo(gridW*cell,y*cell); ctx.stroke(); }
}

function drawBlueprint(shouldDraw, alpha=0.18){
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    const t=blueprint[y][x]; if(t===TILES.EMPTY) continue;
    let ok=false;
    if(typeof shouldDraw==="function") ok = shouldDraw(t,x,y);
    else ok = !!shouldDraw;
    if(!ok) continue;

    ctx.globalAlpha = alpha;
    ctx.fillStyle =
      t===TILES.WALL ? COLORS.wall :
      t===TILES.WINDOW ? COLORS.window :
      t===TILES.DOOR ? COLORS.door : COLORS.roof;
    ctx.fillRect(x*cell+2, y*cell+2, cell-4, cell-4);
    ctx.globalAlpha = 1;
  }
}

// ==== Sockets ====
socket.on('roomUpdate',({players})=>{ pcountEl.textContent=players; });
socket.on('gridUpdate',({x,y,tile})=>{ if(board){ board[y][x]=tile; draw(); }});

socket.on('roundStarted',({mode:md, previewUntil:pu, peeksRemaining:pr, counts:ct, fog})=>{
  config.mode = md;
  previewUntil = pu || 0;
  peekUntil = 0;
  peeksRemaining = pr ?? 0;
  counts = ct || counts;
  if(fog && fog.radius) config.fog.radius = fog.radius;

  // reflect UI
  modeSel.value = config.mode; refreshModePanels();
  peekLeftEl.textContent = peeksRemaining;
  winCountEl.textContent = counts.windows; doorCountEl.textContent = counts.doors;

  statusEl.textContent = "Round started!";
  tickTimerOnce(); // update drawing during preview/peek
});

socket.on('peekWindow',({until, peeksRemaining:pr})=>{
  peekUntil = until || 0;
  peeksRemaining = pr ?? peeksRemaining;
  peekLeftEl.textContent = peeksRemaining;
  tickTimerOnce();
});

socket.on('roundReset',({board:nb, blueprint:bp, counts:ct})=>{
  board=nb; blueprint=bp; counts=ct||counts; locked=false;
  previewUntil=0; peekUntil=0; peeksRemaining=config.memory.peekTokens;
  winCountEl.textContent = counts.windows; doorCountEl.textContent = counts.doors;
  draw();
});

socket.on('scored',res=> showScore(res));

// Simple periodic redraw to handle preview/peek timeouts
function tickTimerOnce(){
  draw();
  // keep updating during windows
  const int = setInterval(()=>{
    const now=Date.now();
    const show = (config.mode==="memory" && (now<previewUntil || now<peekUntil));
    draw();
    if(!show) clearInterval(int);
  }, 200);
}

// Score modal
document.getElementById('closeScore').onclick = ()=> document.getElementById('scorePanel').classList.add('hidden');
function showScore(res){
  locked=true;
  document.getElementById('acc').textContent=res.accuracy;
  document.getElementById('wrong').textContent=res.wrong;
  document.getElementById('final').textContent=res.finalScore;
  document.getElementById('stars').textContent = res.stars===3? "★★★" : res.stars===2? "★★☆" : "★☆☆";
  document.getElementById('scorePanel').classList.remove('hidden');
}

function hintStatus(){ statusEl.textContent=`Selected: ${TILE_NAMES[currentTile]}`; }
hintStatus(); resizeCanvas(); draw();

// --- State ---
const socket = io();
let code=null, selfId=null, hostId=null, matchType="competitive";
let spectator=false;

let phase="lobby";
let roundNum=0, totalRounds=3;
let gridW=0, gridH=0, board=null, blueprint=null;
let previewEndsAt=0, buildEndsAt=0, countdownEndsAt=0;
let peekUntil=0, peeksRemaining=0;

const TILES = { EMPTY:0, WALL:1, WINDOW:2, DOOR:3, ROOF:4 };
const TILE_NAMES = ["Empty","Wall","Window","Door","Roof"];
const COLORS = { grid:"#1a203a", cell:"#0f142b", wall:"#5b91ff", window:"#5bffd2", door:"#ffd35b", roof:"#ff5b9f" };
let cell=36, currentTile=TILES.WALL;

// --- Elements ---
const leftCol = document.getElementById('left');
const sessionCard = document.getElementById('sessionCard');
const pcountEl = document.getElementById('pcount');
const readyCountEl = document.getElementById('readyCount');
const roomLabel = document.getElementById('roomLabel');
const roundInfo = document.getElementById('roundInfo');

const cvs = document.getElementById('grid'); const ctx = cvs.getContext('2d');

// Top HUD
const topHUD = document.getElementById('topHUD');
const roundLabel = document.getElementById('roundLabel');
const timerLabel = document.getElementById('timerLabel');

// Bottom bar
const bottomBar = document.getElementById('bottomBar');
const paletteBar = document.getElementById('paletteBar');
const actionsBar = document.getElementById('actionsBar');
const peekBtn = document.getElementById('peekBtn');
const peekLeft = document.getElementById('peekLeft');
const submitBtn = document.getElementById('submitBtn');

// Lobby overlay (center)
const lobbyOverlay = document.getElementById('lobbyOverlay');
const roomLabelBig = document.getElementById('roomLabelBig');
const pcountBig = document.getElementById('pcountBig');
const readyBig = document.getElementById('readyBig');
const startBtn = document.getElementById('startBtn');
const readyBtn = document.getElementById('readyBtn');
const hostHint = document.getElementById('hostHint');
const modeRadios = document.getElementsByName('mtype');

// Phase overlay
const phaseOverlay = document.getElementById('phaseOverlay');
const overlayText = document.getElementById('overlayText');
const overlaySub = document.getElementById('overlaySub');

// Results modal
const scorePanel = document.getElementById('scorePanel');
const scoreList = document.getElementById('scoreList');
const resultTitle = document.getElementById('resultTitle');
const closeScore = document.getElementById('closeScore');

// --- Session create/join ---
document.getElementById('create').onclick = ()=>{
  socket.emit('createRoom',(res)=>{
    if(!res.ok) return alert(res.error||'Failed');
    code=res.code; selfId=res.selfId; hostId=res.hostId; matchType=res.matchType;
    spectator=false; roomLabel.textContent=code; roomLabelBig.textContent=code;
    // Hide left column once joined; show lobby overlay in middle
    leftCol.classList.add('hidden'); lobbyOverlay.classList.remove('hidden');
    updateModeRadios();
  });
};
document.getElementById('join').onclick = ()=>{
  const c = document.getElementById('code').value.trim().toUpperCase(); if(!c) return;
  socket.emit('joinRoom',{code:c},(res)=>{
    if(!res.ok) return alert(res.error||'Failed');
    code=c; selfId=res.selfId; hostId=res.hostId; matchType=res.matchType; spectator=!!res.spectator;
    roomLabel.textContent=code; roomLabelBig.textContent=code;
    leftCol.classList.add('hidden'); lobbyOverlay.classList.remove('hidden');
    updateModeRadios();
    if(spectator){ showPhaseOverlay("Spectating","Match in progress"); }
  });
};

// --- Lobby controls (center overlay) ---
function updateModeRadios(){
  for(const r of modeRadios){
    r.checked = (r.value===matchType);
    r.disabled = (selfId!==hostId);
    r.onchange = ()=>{ if(r.checked) socket.emit('setMatchType',{code, matchType:r.value}); };
  }
  hostHint.textContent = (selfId===hostId) ? "You are host." : "Waiting for host…";
}
readyBtn.onclick = ()=>{
  const on = readyBtn.dataset.ready!=="true";
  readyBtn.dataset.ready = on ? "true" : "false";
  readyBtn.textContent = on ? "Unready" : "Ready";
  socket.emit('setReady',{code, ready:on});
};
startBtn.onclick = ()=> socket.emit('startMatch',{code});

// --- Actions ---
submitBtn.onclick = ()=> socket.emit('submit',{code});
peekBtn.onclick = ()=> socket.emit('peek',{code});

// --- Palette on bottom bar ---
function buildPalette(){
  paletteBar.innerHTML = "";
  [TILES.EMPTY,TILES.WALL,TILES.WINDOW,TILES.DOOR,TILES.ROOF].forEach(t=>{
    const b=document.createElement('button');
    b.textContent=TILE_NAMES[t];
    b.onclick=()=>{ currentTile=t; };
    paletteBar.appendChild(b);
  });
}
window.addEventListener('keydown',(e)=>{
  const map={'1':TILES.EMPTY,'2':TILES.WALL,'3':TILES.WINDOW,'4':TILES.DOOR,'5':TILES.ROOF};
  if(map[e.key]!=null){ currentTile=map[e.key]; }
});

// --- Canvas interactions ---
cvs.addEventListener('contextmenu',e=>e.preventDefault());
cvs.addEventListener('mousedown',(e)=>{
  if(!code || spectator) return;
  if(phase!=="build") return;
  const r=cvs.getBoundingClientRect();
  const x = Math.floor((e.clientX-r.left)/cell);
  const y = Math.floor((e.clientY-r.top)/cell);
  if(x<0||y<0||x>=gridW||y>=gridH) return;
  const tile = (e.button===2)? TILES.EMPTY : currentTile;
  socket.emit('placeTile',{code,x,y,tile});
});

// --- Rendering ---
function resizeCanvas(){
  cell = Math.floor(Math.min(880/gridW, 720/gridH, 40));
  cvs.width = gridW*cell; cvs.height = gridH*cell;
}
function draw(){
  if(!board){ ctx.clearRect(0,0,cvs.width,cvs.height); return; }
  ctx.clearRect(0,0,cvs.width,cvs.height);
  // background
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    ctx.fillStyle=COLORS.cell; ctx.fillRect(x*cell,y*cell,cell,cell);
  }
  // blueprint visible only in preview or (team) peek window
  const now=Date.now();
  const showBp = (phase==="preview") || (matchType==="team" && now<peekUntil);
  if(showBp && blueprint){
    for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
      const t=blueprint[y][x]; if(t===TILES.EMPTY) continue;
      ctx.globalAlpha=.18;
      ctx.fillStyle=(t===TILES.WALL?COLORS.wall:t===TILES.WINDOW?COLORS.window:t===TILES.DOOR?COLORS.door:COLORS.roof);
      ctx.fillRect(x*cell+2,y*cell+2,cell-4,cell-4);
      ctx.globalAlpha=1;
    }
  }
  // placed tiles
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    const t=board[y][x]; if(t===TILES.EMPTY) continue;
    ctx.fillStyle=(t===TILES.WALL?COLORS.wall:t===TILES.WINDOW?COLORS.window:t===TILES.DOOR?COLORS.door:COLORS.roof);
    ctx.fillRect(x*cell+4,y*cell+4,cell-8,cell-8);
  }
  // grid lines
  ctx.strokeStyle=COLORS.grid;
  for(let x=0;x<=gridW;x++){ ctx.beginPath(); ctx.moveTo(x*cell,0); ctx.lineTo(x*cell,gridH*cell); ctx.stroke(); }
  for(let y=0;y<=gridH;y++){ ctx.beginPath(); ctx.moveTo(0,y*cell); ctx.lineTo(gridW*cell,y*cell); ctx.stroke(); }
}

// --- Overlays / HUD toggles ---
function showPhaseOverlay(main,sub){ overlaySet(main,sub); phaseOverlay.classList.remove('hidden'); }
function hidePhaseOverlay(){ phaseOverlay.classList.add('hidden'); }
function overlaySet(main,sub){ overlayText.textContent=main; overlaySub.textContent=sub||""; }

// Top/bottom bars only during match phases
function setInGameUI(on){
  topHUD.classList.toggle('hidden', !on);
  bottomBar.classList.toggle('hidden', !on);
}

// Timer loop
let timerInt=null;
function startTimer(){
  if(timerInt) clearInterval(timerInt);
  timerInt = setInterval(()=>{
    const now=Date.now();
    let ms=0, label="";
    if(phase==="countdown"){ ms = countdownEndsAt - now; label="Starting"; }
    else if(phase==="preview"){ ms = previewEndsAt - now; label="Preview"; }
    else if(phase==="build"){ ms = buildEndsAt - now; label="Build"; }
    const s = Math.max(0, Math.ceil(ms/1000));
    timerLabel.textContent = s+"s";
    roundLabel.textContent = (roundNum? `Round ${roundNum}/${totalRounds}` : "Round —");
    draw();
  }, 200);
}

// --- Socket events ---
socket.on('lobby', (st)=>{
  // counts
  pcountEl.textContent = st.players.length;
  pcountBig.textContent = st.players.length;
  readyCountEl.textContent = st.readyCount;
  readyBig.textContent = st.readyCount;

  hostId = st.hostId; matchType = st.matchType;
  roundNum = st.roundNum; totalRounds = st.totalRounds;
  roundInfo.textContent = (roundNum>0? `${roundNum}/${totalRounds}` : "—");
  roomLabelBig.textContent = code||"—";

  // Start eligibility
  startBtn.disabled = !(st.canStart && selfId===hostId);
  updateModeRadios();

  // Show lobby overlay if phase==lobby, else hide it
  const inLobby = st.phase==="lobby";
  lobbyOverlay.classList.toggle('hidden', !inLobby);

  // Show/hide in-game HUD
  setInGameUI(!inLobby);
});

socket.on('roundSetup', ({gridW:W, gridH:H, blueprint:bp, board:b, matchType:mt, roundNum:rn, totalRounds:tr, peeksRemaining:pr})=>{
  matchType = mt; gridW=W; gridH=H; blueprint=bp; board=b; roundNum=rn; totalRounds=tr;
  peeksRemaining = pr||0; peekLeft.textContent = `x${peeksRemaining}`;
  // Bottom actions visibility
  submitBtn.classList.toggle('hidden', matchType!=="competitive");
  peekBtn.classList.toggle('hidden', matchType!=="team");
  // Ensure palette is present
  buildPalette();
  resizeCanvas(); draw();
});

socket.on('phase', (ph)=>{
  if(ph.countdownEndsAt) countdownEndsAt=ph.countdownEndsAt;
  if(ph.previewEndsAt)   previewEndsAt=ph.previewEndsAt;
  if(ph.buildEndsAt)     buildEndsAt=ph.buildEndsAt;

  phase = ph.phase;
  // Phase overlays
  if(phase==="countdown"){ showPhaseOverlay("Get Ready","3…2…1…"); }
  else if(phase==="preview"){ showPhaseOverlay("Blueprint","Memorize it!"); }
  else if(phase==="build"){ showPhaseOverlay("Build!",""); setTimeout(()=> hidePhaseOverlay(), 900); }

  // HUD active during pre/build
  setInGameUI(phase!=="lobby" && phase!=="results" && phase!=="review");

  startTimer();
});

socket.on('peekWindow', ({until, peeksRemaining:pr})=>{
  peekUntil = until||0;
  peeksRemaining = pr||0; peekLeft.textContent = `x${peeksRemaining}`;
  draw();
});

socket.on('gridUpdate', ({owner,x,y,tile})=>{
  if(!board) return;
  if(matchType==="competitive" && owner!==selfId) return; // only my board updates
  board[y][x]=tile;
  draw();
});

socket.on('playerFinished', ({id, rank})=>{
  if(id===selfId){ showPhaseOverlay(`Finished!`, `Place: ${rank}`); setTimeout(()=> hidePhaseOverlay(), 1200); }
});

socket.on('roundResults', ({roundNum:rn, entries})=>{
  scoreList.innerHTML = "";
  resultTitle.textContent = `Round ${rn} Results`;
  if(matchType==="competitive"){
    entries.forEach(e=>{
      const me = (e.id===selfId) ? " (You)" : "";
      const rank = e.rank? `#${e.rank}` : "-";
      const li = document.createElement('li');
      li.innerHTML = `<span>${rank} ${e.id.slice(0,5)}${me}</span><span>${e.accuracy}% · +${e.pts} pts</span>`;
      scoreList.appendChild(li);
    });
  } else {
    const e = entries[0];
    const li = document.createElement('li');
    li.innerHTML = `<span>Team</span><span>${e.accuracy}% · ${e.pts} pts</span>`;
    scoreList.appendChild(li);
  }
  scorePanel.classList.remove('hidden');
});
closeScore.onclick = ()=> scorePanel.classList.add('hidden');

socket.on('matchSummary', ({entries})=>{
  scoreList.innerHTML = "";
  resultTitle.textContent = `Match Summary`;
  entries.forEach((e,i)=>{
    const me = (e.id===selfId) ? " (You)" : "";
    const li = document.createElement('li');
    li.innerHTML = `<span>#${i+1} ${e.id.slice(0,5)}${me}</span><span>${e.total} pts</span>`;
    scoreList.appendChild(li);
  });
  scorePanel.classList.remove('hidden');
});

// --- Init ---
function init(){
  // start with left column visible (create/join); board idle
  draw();
}
init();

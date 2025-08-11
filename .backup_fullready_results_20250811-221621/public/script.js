// --- Constants & State ---
const socket = io();
const TILES = { EMPTY:0, WALL:1, WINDOW:2, DOOR:3, ROOF:4 };
const TILE_NAMES = ["Empty","Wall","Window","Door","Roof"];
const COLORS = { grid:"#1a203a", cell:"#0f142b", wall:"#5b91ff", window:"#5bffd2", door:"#ffd35b", roof:"#ff5b9f" };
const PHASE = { LOBBY:'lobby', COUNTDOWN:'countdown', PREVIEW:'preview', BUILD:'build', RESULTS:'results' };

let code=null, selfId=null, hostId=null, spectator=false;
let matchType="competitive";
let phase=PHASE.LOBBY;

let roundNum=0, totalRounds=3;
let gridW=0, gridH=0, cell=36;
let board=null, blueprint=null;

let countdownEndsAt=0, previewEndsAt=0, buildEndsAt=0;
let peekUntil=0, peeksRemaining=0;

let mySubmitted=false, submittedCount=0, submittedTotal=0;
let currentTile=TILES.WALL;

// --- Elements ---
const boardWrap = document.getElementById('boardWrap');
const cvs = document.getElementById('grid'); const ctx = cvs.getContext('2d');
const previewCanvas = document.getElementById('previewCanvas'); const pctx = previewCanvas.getContext('2d');
const bpLabel = document.getElementById('bpLabel');
const bpTimer = document.getElementById('bpTimer');

const topHUD = document.getElementById('topHUD');
const roundLabel = document.getElementById('roundLabel');
const timerLabel = document.getElementById('timerLabel');
const submitStatus = document.getElementById('submitStatus');

const bottomBar = document.getElementById('bottomBar');
const paletteBar = document.getElementById('paletteBar');
const peekBtn = document.getElementById('peekBtn');
const peekLeft = document.getElementById('peekLeft');
const submitBtn = document.getElementById('submitBtn');

const welcomeOverlay = document.getElementById('welcomeOverlay');
const lobbyOverlay = document.getElementById('lobbyOverlay');
const roomLabelBig = document.getElementById('roomLabelBig');
const pcountBig = document.getElementById('pcountBig');
const readyBig = document.getElementById('readyBig');
const startBtn = document.getElementById('startBtn');
const readyBtn = document.getElementById('readyBtn');
const hostHint = document.getElementById('hostHint');
const modeRadios = document.getElementsByName('mtype');

const scorePanel = document.getElementById('scorePanel');
const scoreList = document.getElementById('scoreList');
const resultTitle = document.getElementById('resultTitle');
const closeScore = document.getElementById('closeScore');

const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const codeInput = document.getElementById('codeInput');

// --- Utils ---
const computeCell = (w,h)=> Math.floor(Math.min(880/w, 720/h, 40));
function setHidden(el, hidden){ el.classList.toggle('hidden', !!hidden); }
function show(el){ setHidden(el, false); } function hide(el){ setHidden(el, true); }

function setBoardVisible(on){
  setHidden(boardWrap, !on);
  setHidden(topHUD, !on);
  setHidden(bottomBar, !on);
}

function resizeBoard(){
  if(!gridW || !gridH) return;
  cell = computeCell(gridW, gridH);
  const pxW = gridW * cell, pxH = gridH * cell;
  cvs.width = pxW;  cvs.height = pxH;
  previewCanvas.width = pxW; previewCanvas.height = pxH;
  boardWrap.style.width = pxW + "px";
  boardWrap.style.height = pxH + "px";
  drawBoard();
  if(phase===PHASE.PREVIEW){ drawPreview(); }
}

function drawBoard(){
  if(!board || boardWrap.classList.contains('hidden')) return;
  const now=Date.now();
  ctx.clearRect(0,0,cvs.width,cvs.height);
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    ctx.fillStyle=COLORS.cell; ctx.fillRect(x*cell,y*cell,cell,cell);
  }
  const showBp = (matchType==="team" && now<peekUntil);
  if(showBp && blueprint){
    for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
      const t=blueprint[y][x]; if(t===TILES.EMPTY) continue;
      ctx.globalAlpha=.18;
      ctx.fillStyle=(t===TILES.WALL?COLORS.wall:t===TILES.WINDOW?COLORS.window:t===TILES.DOOR?COLORS.door:COLORS.roof);
      ctx.fillRect(x*cell+2,y*cell+2,cell-4,cell-4);
      ctx.globalAlpha=1;
    }
  }
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    const t=board[y][x]; if(t===TILES.EMPTY) continue;
    ctx.fillStyle=(t===TILES.WALL?COLORS.wall:t===TILES.WINDOW?COLORS.window:t===TILES.DOOR?COLORS.door:COLORS.roof);
    ctx.fillRect(x*cell+4,y*cell+4,cell-8,cell-8);
  }
  ctx.strokeStyle=COLORS.grid;
  for(let x=0;x<=gridW;x++){ ctx.beginPath(); ctx.moveTo(x*cell,0); ctx.lineTo(x*cell,gridH*cell); ctx.stroke(); }
  for(let y=0;y<=gridH;y++){ ctx.beginPath(); ctx.moveTo(0,y*cell); ctx.lineTo(gridW*cell,y*cell); ctx.stroke(); }
}

function drawPreview(){
  if(!blueprint) return;
  const px = cell;
  pctx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    pctx.fillStyle="#0b0f1d"; pctx.fillRect(x*px,y*px,px,px);
  }
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    const t=blueprint[y][x]; if(t===TILES.EMPTY) continue;
    pctx.globalAlpha=.26;
    pctx.fillStyle=(t===TILES.WALL?COLORS.wall:t===TILES.WINDOW?COLORS.window:t===TILES.DOOR?COLORS.door:COLORS.roof);
    pctx.fillRect(x*px+2,y*px+2,px-4,px-4); pctx.globalAlpha=1;
  }
  pctx.strokeStyle=COLORS.grid;
  for(let x=0;x<=gridW;x++){ pctx.beginPath(); pctx.moveTo(x*px,0); pctx.lineTo(x*px,gridH*px); pctx.stroke(); }
  for(let y=0;y<=gridH;y++){ pctx.beginPath(); pctx.moveTo(0,y*px); pctx.lineTo(gridW*px,y*px); pctx.stroke(); }
}

// --- Phase helpers ---
function enterCountdown(){
  phase = PHASE.COUNTDOWN;
  show(boardWrap); hide(bottomBar); hide(topHUD);
  show(bpLabel); show(bpTimer);
  bpLabel.textContent = "GET READY";
  hide(previewCanvas); // no blueprint during countdown
}
function enterPreview(){
  phase = PHASE.PREVIEW;
  show(boardWrap); hide(bottomBar); hide(topHUD);
  show(previewCanvas); show(bpLabel); show(bpTimer);
  bpLabel.textContent = "BLUEPRINT!";
  drawPreview();
}
function enterBuild(){
  phase = PHASE.BUILD;
  show(boardWrap); show(bottomBar); show(topHUD);
  hide(previewCanvas); hide(bpLabel); hide(bpTimer);
}

function updateHUD(){
  const now = Date.now();
  let ms = 0;
  if(phase===PHASE.COUNTDOWN) ms = countdownEndsAt - now;
  if(phase===PHASE.PREVIEW)   ms = previewEndsAt   - now;
  if(phase===PHASE.BUILD)     ms = buildEndsAt     - now;
  const s = Math.max(0, Math.ceil(ms/1000));
  timerLabel.textContent = (phase===PHASE.BUILD) ? `${s}s` : "—s";
  roundLabel.textContent = (roundNum? `Round ${roundNum}/${totalRounds}` : "Round —");
  if(phase===PHASE.COUNTDOWN) bpTimer.textContent = `Starting: ${s}s`;
  if(phase===PHASE.PREVIEW)   bpTimer.textContent = `Preview: ${s}s`;
}

let hudInt = null;
function startHudTimer(){
  if(hudInt) clearInterval(hudInt);
  hudInt = setInterval(()=>{ updateHUD(); drawBoard(); }, 200);
}

// --- Palette & input ---
function buildPalette(){
  paletteBar.innerHTML = "";
  [TILES.EMPTY,TILES.WALL,TILES.WINDOW,TILES.DOOR,TILES.ROOF].forEach(t=>{
    const b=document.createElement('button'); b.textContent=TILE_NAMES[t];
    b.onclick=()=>{ if(!mySubmitted) currentTile=t; };
    paletteBar.appendChild(b);
  });
}
window.addEventListener('keydown',(e)=>{
  if(mySubmitted) return;
  const map={'1':TILES.EMPTY,'2':TILES.WALL,'3':TILES.WINDOW,'4':TILES.DOOR,'5':TILES.ROOF};
  if(map[e.key]!=null){ currentTile=map[e.key]; }
});
cvs.addEventListener('contextmenu', e=> e.preventDefault());
cvs.addEventListener('mousedown', (e)=>{
  if(!code || spectator) return;
  if(phase!==PHASE.BUILD || mySubmitted) return;
  const r = cvs.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left)/cell);
  const y = Math.floor((e.clientY - r.top)/cell);
  if(x<0||y<0||x>=gridW||y>=gridH) return;
  const tile = (e.button===2) ? TILES.EMPTY : currentTile;
  socket.emit('placeTile',{ code, x, y, tile });
});

// Buttons
submitBtn.onclick = ()=>{
  if(!code || phase!==PHASE.BUILD) return;
  socket.emit('submitToggle',{ code, submit: !mySubmitted });
};
peekBtn.onclick = ()=> socket.emit('peek',{ code });

// Lobby actions
createBtn.onclick = ()=>{
  socket.emit('createRoom',(res)=>{
    if(!res.ok) return alert(res.error||'Failed');
    code=res.code; selfId=res.selfId; hostId=res.hostId; matchType=res.matchType; spectator=false;
    roomLabelBig.textContent=code; hide(welcomeOverlay); show(lobbyOverlay); updateModeRadios();
  });
};
joinBtn.onclick = ()=>{
  const c = (codeInput.value||"").trim().toUpperCase(); if(!c) return;
  socket.emit('joinRoom',{ code:c },(res)=>{
    if(!res.ok) return alert(res.error||'Failed');
    code=c; selfId=res.selfId; hostId=res.hostId; matchType=res.matchType; spectator=!!res.spectator;
    roomLabelBig.textContent=code; hide(welcomeOverlay); show(lobbyOverlay); updateModeRadios();
  });
};
readyBtn.onclick = ()=>{
  const on = readyBtn.dataset.ready!=="true";
  readyBtn.dataset.ready = on ? "true" : "false";
  readyBtn.textContent = on ? "Unready" : "Ready";
  socket.emit('setReady',{ code, ready:on });
};
startBtn.onclick = ()=> socket.emit('startMatch',{ code });

// Mode radios
function updateModeRadios(){
  for(const r of modeRadios){
    r.checked = (r.value===matchType);
    r.onchange = null; r.onclick = null; r.disabled = false;
    if(selfId===hostId){
      r.onchange = ()=>{ if(r.checked) socket.emit('setMatchType',{ code, matchType:r.value }); };
    }else{
      r.onclick = (e)=>{ e.preventDefault(); for(const rr of modeRadios){ rr.checked = (rr.value===matchType); } };
    }
  }
  hostHint.textContent = (selfId===hostId) ? "You are host." : "Waiting for host…";
}

// Sockets
socket.on('lobby',(st)=>{
  pcountBig.textContent = st.players.length;
  readyBig.textContent = st.readyCount;
  hostId = st.hostId;
  matchType = st.matchType;
  roundNum = st.roundNum;
  totalRounds = st.totalRounds;

  startBtn.disabled = !(st.canStart && selfId===hostId);
  updateModeRadios();

  show(lobbyOverlay); hide(welcomeOverlay);
  setBoardVisible(false);
  hide(scorePanel);

  submittedTotal = st.players.length;
  submittedCount = 0; mySubmitted=false;
  submitStatus.textContent = "";
});

socket.on('modeUpdate',({matchType:mt})=>{
  matchType = mt; updateModeRadios();
});

socket.on('roundSetup',({gridW:W,gridH:H,blueprint:bp,board:b,matchType:mt,roundNum:rn,totalRounds:tr,peeksRemaining:pr})=>{
  matchType=mt; gridW=W; gridH=H; blueprint=bp; board=b; roundNum=rn; totalRounds=tr;
  peeksRemaining=pr||0; peekLeft.textContent=`x${peeksRemaining}`;
  mySubmitted=false; submittedCount=0;

  // Submit button visible in BOTH modes now
  submitBtn.classList.remove('hidden');
  peekBtn.classList.toggle('hidden', matchType!=="team");

  buildPalette();
  resizeBoard();
  setBoardVisible(true);
  hide(lobbyOverlay); hide(welcomeOverlay);
  hide(scorePanel);
  submitBtn.textContent = "Submit";
  submitStatus.textContent = "";
});

socket.on('phase',(ph)=>{
  if(ph.countdownEndsAt) countdownEndsAt=ph.countdownEndsAt;
  if(ph.previewEndsAt)   previewEndsAt=ph.previewEndsAt;
  if(ph.buildEndsAt)     buildEndsAt=ph.buildEndsAt;
  const prev = phase;
  phase = ph.phase;

  if(phase===PHASE.COUNTDOWN) enterCountdown();
  if(phase===PHASE.PREVIEW)   enterPreview();
  if(phase===PHASE.BUILD)     enterBuild();

  // Auto-hide results modal as soon as next phase arrives
  if(prev===PHASE.RESULTS && (phase===PHASE.COUNTDOWN || phase===PHASE.PREVIEW || phase===PHASE.BUILD)){
    hide(scorePanel);
  }

  startHudTimer();
  resizeBoard();
});

socket.on('peekWindow',({until,peeksRemaining:pr})=>{
  peekUntil=until||0; peeksRemaining=pr||0; peekLeft.textContent=`x${peeksRemaining}`;
  drawBoard();
});

socket.on('gridUpdate',({owner,x,y,tile})=>{
  if(!board) return;
  if(matchType==="competitive" && owner!==selfId) return;
  if(y>=0 && y<board.length && x>=0 && x<board[0].length){
    board[y][x]=tile; drawBoard();
  }
});

socket.on('submitState',({id, submitted, count, total})=>{
  if(total!=null) submittedTotal = total;
  if(count!=null) submittedCount = count;
  if(id===selfId && submitted!=null) mySubmitted = !!submitted;
  submitBtn.textContent = mySubmitted ? "Unsubmit" : "Submit";
  bottomBar.style.opacity = mySubmitted ? ".7" : "1";
  submitStatus.textContent = (phase===PHASE.BUILD) ? `Submitted: ${submittedCount}/${submittedTotal||"?"}` : "";
});

socket.on('opponentLeft',({id})=>{
  alert("Opponent left. Match ended.");
  // server moves to lobby
});

socket.on('roundResults',({roundNum:rn,entries})=>{
  // Only sent on timer-end rounds (not all-submitted)
  scoreList.innerHTML="";
  resultTitle.textContent=`Round ${rn} Results`;
  entries.forEach((e,i)=>{
    const me=(e.id===selfId)?" (You)":"";
    const rank = e.rank?`#${e.rank}`:`#${i+1}`;
    const right = matchType==="competitive" ? (e.total!=null ? `${e.total} pts` : `${e.accuracy||0}%`) : `${e.pts} pts`;
    const li=document.createElement('li');
    li.innerHTML=`<span>${rank} ${e.id.slice(0,5)}${me}</span><span>${right}</span>`;
    scoreList.appendChild(li);
  });
  show(scorePanel);
});
socket.on('matchSummary',({entries})=>{
  scoreList.innerHTML="";
  resultTitle.textContent=`Match Summary`;
  entries.forEach((e,i)=>{
    const me=(e.id===selfId)?" (You)":"";
    const li=document.createElement('li');
    li.innerHTML=`<span>#${i+1} ${e.id.slice(0,5)}${me}</span><span>${e.total} pts</span>`;
    scoreList.appendChild(li);
  });
  show(scorePanel);
});
closeScore.onclick = ()=> hide(scorePanel);

// Init
function init(){
  hide(scorePanel);
  show(welcomeOverlay);
  hide(lobbyOverlay);
  setBoardVisible(false);
  drawBoard();
}
window.addEventListener('resize', resizeBoard);
init();

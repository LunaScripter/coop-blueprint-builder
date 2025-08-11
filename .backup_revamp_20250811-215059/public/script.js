// --- State ---
const socket = io();
let code=null, selfId=null, hostId=null, matchType="competitive";
let spectator=false;

let phase="lobby";
let roundNum=0, totalRounds=3;
let gridW=0, gridH=0, board=null, blueprint=null;
let previewEndsAt=0, buildEndsAt=0, countdownEndsAt=0;
let peekUntil=0, peeksRemaining=0;

let mySubmitted=false, submittedCount=0, submittedTotal=0;
let instantNext=false; // from server/host

const TILES = { EMPTY:0, WALL:1, WINDOW:2, DOOR:3, ROOF:4 };
const TILE_NAMES = ["Empty","Wall","Window","Door","Roof"];
const COLORS = { grid:"#1a203a", cell:"#0f142b", wall:"#5b91ff", window:"#5bffd2", door:"#ffd35b", roof:"#ff5b9f" };
let cell=36, currentTile=TILES.WALL;

// --- Elements ---
const cvs = document.getElementById('grid'); const ctx = cvs.getContext('2d');
const topHUD = document.getElementById('topHUD');
const roundLabel = document.getElementById('roundLabel');
const timerLabel = document.getElementById('timerLabel');
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
const modeLabel = document.getElementById('modeLabel');
const instantNextBox = document.getElementById('instantNextBox');

const phaseOverlay = document.getElementById('phaseOverlay');
const overlayText = document.getElementById('overlayText');
const overlaySub = document.getElementById('overlaySub');
const previewCanvas = document.getElementById('previewCanvas');
const pctx = previewCanvas.getContext('2d');

const scorePanel = document.getElementById('scorePanel');
const scoreList = document.getElementById('scoreList');
const resultTitle = document.getElementById('resultTitle');
const closeScore = document.getElementById('closeScore');

// HUD chip for submit counts
const submitStatus = document.createElement('div');
submitStatus.id = 'submitStatus';
topHUD.appendChild(submitStatus);

// --- Helpers ---
const computeCell = (w,h)=> Math.floor(Math.min(880/w, 720/h, 40));

function setBoardVisible(on){
  cvs.classList.toggle('hidden', !on);
  topHUD.classList.toggle('hidden', !on);
  bottomBar.classList.toggle('hidden', !on);
}
function showCenter(el){ el.classList.remove('hidden'); }
function hideCenter(el){ el.classList.add('hidden'); }

function showPhaseOverlay(main, sub, withPreview=false){
  overlayText.textContent = main;
  overlaySub.textContent = sub||"";
  // pills style for preview phase
  overlayText.classList.toggle('overlay-pill', withPreview);
  overlaySub.classList.toggle('overlay-pill-sub', withPreview);
  previewCanvas.classList.toggle('hidden', !withPreview);
  phaseOverlay.classList.remove('hidden');
}
function hidePhaseOverlay(){ phaseOverlay.classList.add('hidden'); }
function showModal(){ scorePanel.classList.add('show'); }
function hideModal(){ scorePanel.classList.remove('show'); }

function resizeCanvas(){
  if(!gridW || !gridH) return;
  cell = computeCell(gridW, gridH);
  cvs.width = gridW * cell;
  cvs.height = gridH * cell;
  cvs.style.width = cvs.width + "px";
  cvs.style.height = cvs.height + "px";
}

function posRelativeToBoard(place){ // place: 'tl' | 'tr'
  const boardRect = cvs.getBoundingClientRect();
  const overlayRect = phaseOverlay.getBoundingClientRect();
  const top = boardRect.top - overlayRect.top - 10; // just above board
  if(place==='tl'){
    const left = boardRect.left - overlayRect.left + 4;
    return {left, top, transform:"translate(0,-100%)"};
  } else {
    const right = boardRect.right - overlayRect.left - 4; // we’ll set left then translate
    return {left:right, top, transform:"translate(-100%,-100%)"};
  }
}
function positionBlueprintUI(){
  if(phase!=='preview') return;
  const tl = posRelativeToBoard('tl');
  overlayText.style.left = `${Math.round(tl.left)}px`;
  overlayText.style.top  = `${Math.round(tl.top)}px`;
  overlayText.style.transform = tl.transform;

  const tr = posRelativeToBoard('tr');
  overlaySub.style.left = `${Math.round(tr.left)}px`;
  overlaySub.style.top  = `${Math.round(tr.top)}px`;
  overlaySub.style.transform = tr.transform;

  // align preview canvas exactly over the board
  const boardRect = cvs.getBoundingClientRect();
  const overlayRect = phaseOverlay.getBoundingClientRect();
  previewCanvas.style.left = (boardRect.left - overlayRect.left) + "px";
  previewCanvas.style.top  = (boardRect.top  - overlayRect.top)  + "px";
}

function draw(){
  if(!board || cvs.classList.contains('hidden')) return;
  const now=Date.now();
  ctx.clearRect(0,0,cvs.width,cvs.height);
  for(let y=0;y<gridH;y++) for(let x=0;x<gridW;x++){
    ctx.fillStyle=COLORS.cell; ctx.fillRect(x*cell,y*cell,cell,cell);
  }
  const showBp=(matchType==="team" && now<peekUntil);
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

function drawPreviewCanvas(){
  if(!blueprint) return;
  const px = cell || computeCell(gridW, gridH);
  previewCanvas.width = gridW * px;
  previewCanvas.height = gridH * px;
  previewCanvas.style.width  = previewCanvas.width + "px";
  previewCanvas.style.height = previewCanvas.height + "px";
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

// --- Lobby & Join ---
createBtn.onclick = ()=>{
  socket.emit('createRoom',(res)=>{
    if(!res.ok) return alert(res.error||'Failed');
    code=res.code; selfId=res.selfId; hostId=res.hostId; matchType=res.matchType; spectator=false;
    roomLabelBig.textContent=code;
    hideCenter(welcomeOverlay); showCenter(lobbyOverlay);
    applyLobbyState(res);
  });
};
joinBtn.onclick = ()=>{
  const c = codeInput.value.trim().toUpperCase(); if(!c) return;
  socket.emit('joinRoom',{code:c},(res)=>{
    if(!res.ok) return alert(res.error||'Failed');
    code=c; selfId=res.selfId; hostId=res.hostId; matchType=res.matchType; spectator=!!res.spectator;
    roomLabelBig.textContent=code;
    hideCenter(welcomeOverlay); showCenter(lobbyOverlay);
    applyLobbyState(res);
    if(spectator){ showPhaseOverlay("Spectating","Match in progress"); }
  });
};

function applyLobbyState(st){
  if(st.instantNext!=null) instantNext = !!st.instantNext;
  if(modeLabel) modeLabel.textContent = `Mode: ${matchType === 'competitive' ? 'Competitive' : 'Team'}`;
  if(instantNextBox){
    instantNextBox.checked = instantNext;
    instantNextBox.disabled = (selfId!==hostId);
    instantNextBox.onchange = ()=> socket.emit('setInstantNext',{code, instant: instantNextBox.checked});
  }
  updateModeRadios();
}

// --- Lobby controls ---
function updateModeRadios(){
  for(const r of modeRadios){
    r.checked = (r.value===matchType);
    r.onchange = null; r.onclick = null; r.disabled = false;
    if(selfId===hostId){
      r.onchange = ()=>{ if(r.checked) socket.emit('setMatchType',{code, matchType:r.value}); };
    }else{
      r.onclick = (e)=>{ e.preventDefault(); for(const rr of modeRadios){ rr.checked = (rr.value===matchType); } };
    }
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

// --- Submit toggle ---
submitBtn.onclick = ()=>{
  if(!code || phase!=="build") return;
  const next = !mySubmitted;
  socket.emit('submitToggle',{code, submit:next});
};

// --- Peek ---
peekBtn.onclick = ()=> socket.emit('peek',{code});

// --- Palette ---
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

// --- Canvas interactions ---
cvs.addEventListener('contextmenu',e=>e.preventDefault());
cvs.addEventListener('mousedown',(e)=>{
  if(!code || spectator) return;
  if(phase!=="build" || mySubmitted) return;
  const r=cvs.getBoundingClientRect();
  const x=Math.floor((e.clientX-r.left)/cell), y=Math.floor((e.clientY-r.top)/cell);
  if(x<0||y<0||x>=gridW||y>=gridH) return;
  const tile=(e.button===2)? TILES.EMPTY : currentTile;
  socket.emit('placeTile',{code,x,y,tile});
});

// --- Submit UI + timer ---
function updateSubmitUI(){
  submitBtn.textContent = mySubmitted ? "Unsubmit" : "Submit";
  bottomBar.style.opacity = mySubmitted ? ".7" : "1";
  submitStatus.textContent = (phase==="build") ? `Submitted: ${submittedCount}/${submittedTotal||"?"}` : "";
}

let timerInt=null;
function startTimer(){
  if(timerInt) clearInterval(timerInt);
  timerInt=setInterval(()=>{
    const now=Date.now();
    let ms=0;
    if(phase==="countdown") ms = countdownEndsAt - now;
    else if(phase==="preview") ms = previewEndsAt - now;
    else if(phase==="build") ms = buildEndsAt - now;
    const s=Math.max(0, Math.ceil(ms/1000));
    timerLabel.textContent=(phase==="build") ? (s+"s") : "—s";
    roundLabel.textContent=(roundNum? `Round ${roundNum}/${totalRounds}` : "Round —");
    if(phase==="countdown") overlaySub.textContent = `Starting in ${s}s`;
    if(phase==="preview")   overlaySub.textContent = `Preview ends in ${s}s`;
    if(phase==="preview")   positionBlueprintUI();
    draw();
  },200);
}

// --- Sockets ---
socket.on('lobby',(st)=>{
  pcountBig.textContent=st.players.length;
  readyBig.textContent=st.readyCount;
  hostId=st.hostId; matchType=st.matchType;
  roundNum=st.roundNum; totalRounds=st.totalRounds;
  submittedTotal = st.players.length;
  startBtn.disabled = !(st.canStart && selfId===hostId);
  instantNext = !!st.instantNext;
  applyLobbyState(st);

  showCenter(lobbyOverlay); hideCenter(welcomeOverlay);
  setBoardVisible(false); hidePhaseOverlay(); hideModal();

  submittedCount = 0; mySubmitted=false; updateSubmitUI();
});

socket.on('modeUpdate',({matchType:mt})=>{
  matchType = mt; updateModeRadios();
});
socket.on('instantNextUpdate',({instant})=>{
  instantNext = !!instant;
  if(instantNextBox){ instantNextBox.checked = instantNext; }
});

socket.on('roundSetup',({gridW:W,gridH:H,blueprint:bp,board:b,matchType:mt,roundNum:rn,totalRounds:tr,peeksRemaining:pr})=>{
  matchType=mt; gridW=W; gridH=H; blueprint=bp; board=b; roundNum=rn; totalRounds=tr;
  peeksRemaining=pr||0; peekLeft.textContent=`x${peeksRemaining}`;
  mySubmitted=false; submittedCount=0;
  submitBtn.classList.toggle('hidden', matchType!=="competitive");
  peekBtn.classList.toggle('hidden', matchType!=="team");
  buildPalette();
  resizeCanvas();
  setBoardVisible(true);
  bottomBar.classList.add('hidden');
  topHUD.classList.add('hidden');
  updateSubmitUI();
});

socket.on('phase',(ph)=>{
  if(ph.countdownEndsAt) countdownEndsAt=ph.countdownEndsAt;
  if(ph.previewEndsAt)   previewEndsAt=ph.previewEndsAt;
  if(ph.buildEndsAt)     buildEndsAt=ph.buildEndsAt;
  phase=ph.phase;

  if(phase==="countdown"){
    hideCenter(lobbyOverlay);
    resizeCanvas(); setBoardVisible(true);
    bottomBar.classList.add('hidden'); topHUD.classList.add('hidden');
    showPhaseOverlay("Get Ready","Starting soon", false);
  } else if(phase==="preview"){
    resizeCanvas(); setBoardVisible(true);
    bottomBar.classList.add('hidden'); topHUD.classList.add('hidden');
    showPhaseOverlay("BLUEPRINT!","Preview ends in …", true);
    drawPreviewCanvas();
    positionBlueprintUI();
  } else if(phase==="build"){
    resizeCanvas();
    hidePhaseOverlay(); setBoardVisible(true);
    bottomBar.classList.remove('hidden'); topHUD.classList.remove('hidden');
    showPhaseOverlay("Build!","", false);
    setTimeout(()=> hidePhaseOverlay(), 350);
  }
  startTimer();
});

window.addEventListener('resize', ()=>{
  if(!gridW || !gridH) return;
  resizeCanvas();
  if(phase==="preview"){
    drawPreviewCanvas();
    positionBlueprintUI();
  }
});

socket.on('peekWindow',({until,peeksRemaining:pr})=>{
  peekUntil=until||0; peeksRemaining=pr||0; peekLeft.textContent=`x${peeksRemaining}`;
  draw();
});

socket.on('gridUpdate',({owner,x,y,tile})=>{
  if(!board) return;
  if(matchType==="competitive" && owner!==selfId) return;
  board[y][x]=tile; draw();
});

socket.on('playerFinished',({id,rank})=>{
  if(id===selfId){ showPhaseOverlay(`Finished!`,`Place: ${rank}`, false); setTimeout(()=> hidePhaseOverlay(),900); }
});

socket.on('opponentLeft',()=>{
  showPhaseOverlay("Opponent left","Round ended", false);
  setBoardVisible(false);
});

// submit states
socket.on('submitState',({id, submitted, count, total})=>{
  if(total!=null) submittedTotal = total;
  if(count!=null) submittedCount = count;
  if(id===selfId && submitted!=null) mySubmitted = !!submitted;
  updateSubmitUI();
});

// results
socket.on('roundResults',({roundNum:rn,entries,fast})=>{
  scoreList.innerHTML="";
  resultTitle.textContent=`Round ${rn} Results`;
  entries.forEach((e,i)=>{
    const me=(e.id===selfId)?" (You)":"";
    const rank = e.rank?`#${e.rank}`:`#${i+1}`;
    const li=document.createElement('li');
    li.innerHTML=`<span>${rank} ${e.id.slice(0,5)}${me}</span><span>${e.total!=null? e.total+' pts' : (e.accuracy? e.accuracy+'%':'' )}</span>`;
    scoreList.appendChild(li);
  });
  if(!fast){ showModal(); }
});
closeScore.onclick=()=> hideModal();

socket.on('matchSummary',({entries})=>{
  scoreList.innerHTML="";
  resultTitle.textContent=`Match Summary`;
  entries.forEach((e,i)=>{
    const me=(e.id===selfId)?" (You)":"";
    const li=document.createElement('li');
    li.innerHTML=`<span>#${i+1} ${e.id.slice(0,5)}${me}</span><span>${e.total} pts</span>`;
    scoreList.appendChild(li);
  });
  showModal();
});

// --- Init ---
function init(){
  hideModal(); showCenter(welcomeOverlay); hideCenter(lobbyOverlay);
  setBoardVisible(false); draw(); updateSubmitUI();
}
init();

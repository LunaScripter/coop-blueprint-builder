// Client state
const socket = io();
const cvs = document.getElementById('grid');
const ctx = cvs.getContext('2d');

const statusEl = document.getElementById('status');
const pcountEl = document.getElementById('pcount');
const roomLabel = document.getElementById('roomLabel');

const TILES = { EMPTY:0, WALL:1, WINDOW:2, DOOR:3, ROOF:4 };
const TILE_NAMES = ["Empty","Wall","Window","Door","Roof"];
const COLORS = {
  grid:"#1a203a",
  cell:"#0f142b",
  wall:"#5b91ff",
  window:"#5bffd2",
  door:"#ffd35b",
  roof:"#ff5b9f",
  blueprint:"#7c8cb7"
};

let code = null;
let gridW = 12, gridH = 12;
let board = null;
let blueprint = null;
let cell = 48; // px per cell
let currentTile = TILES.WALL;
let locked = false;

// UI wiring
document.getElementById('create').onclick = ()=>{
  socket.emit('createRoom', (res)=>{
    if(!res.ok){ alert(res.error); return; }
    code = res.code; applySnapshot(res);
    roomLabel.textContent = code;
    statusEl.textContent = "Room created. Share the code.";
  });
};
document.getElementById('join').onclick = ()=>{
  const c = document.getElementById('code').value.trim().toUpperCase();
  if(!c) return;
  socket.emit('joinRoom', { code:c }, (res)=>{
    if(!res.ok){ alert(res.error); return; }
    code = c; applySnapshot(res);
    roomLabel.textContent = code;
    statusEl.textContent = "Joined room.";
  });
};
document.getElementById('review').onclick = ()=>{
  if(!code) return;
  socket.emit('review', { code }, (res)=>{
    if(res && res.ok) showScore(res);
  });
};
document.getElementById('nextRound').onclick = ()=>{
  if(!code) return;
  socket.emit('nextRound', { code });
};

document.getElementById('closeScore').onclick = ()=> {
  document.getElementById('scorePanel').classList.add('hidden');
};

// Build palette
const palRoot = document.getElementById('palette');
[ TILES.EMPTY, TILES.WALL, TILES.WINDOW, TILES.DOOR, TILES.ROOF ].forEach(t=>{
  const b = document.createElement('button');
  b.textContent = TILE_NAMES[t];
  b.onclick = ()=> { currentTile = t; hintStatus(); };
  palRoot.appendChild(b);
});
function hintStatus(){
  statusEl.textContent = `Selected: ${TILE_NAMES[currentTile]}`;
}

// Canvas interactions
cvs.addEventListener('contextmenu', e => e.preventDefault());
cvs.addEventListener('mousedown', (e)=>{
  if(!code || locked) return;
  const {x,y} = cellFromMouse(e);
  if(x<0||y<0||x>=gridW||y>=gridH) return;
  const tile = (e.button === 2) ? TILES.EMPTY : currentTile;
  socket.emit('placeTile', { code, x, y, tile });
});

window.addEventListener('keydown', (e)=>{
  const map = { '1':TILES.EMPTY, '2':TILES.WALL, '3':TILES.WINDOW, '4':TILES.DOOR, '5':TILES.ROOF };
  if(map[e.key]!=null){ currentTile = map[e.key]; hintStatus(); }
});

function cellFromMouse(e){
  const r = cvs.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  return { x:Math.floor(mx/cell), y:Math.floor(my/cell) };
}

function applySnapshot(res){
  gridW = res.gridW; gridH = res.gridH;
  board = res.board; blueprint = res.blueprint;
  locked = false;
  resizeCanvas();
  draw();
}

function resizeCanvas(){
  cell = Math.floor(Math.min(600/gridW, 600/gridH, 48));
  cvs.width = gridW*cell; cvs.height = gridH*cell;
}

function draw(){
  if(!board) { ctx.clearRect(0,0,cvs.width,cvs.height); return; }
  ctx.clearRect(0,0,cvs.width,cvs.height);

  // background cells
  for(let y=0;y<gridH;y++){
    for(let x=0;x<gridW;x++){
      ctx.fillStyle = COLORS.cell;
      ctx.fillRect(x*cell, y*cell, cell, cell);
    }
  }

  // blueprint faint overlay
  if(blueprint){
    for(let y=0;y<gridH;y++){
      for(let x=0;x<gridW;x++){
        const t = blueprint[y][x];
        if(t!==TILES.EMPTY){
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = COLORS.blueprint;
          ctx.fillRect(x*cell+2, y*cell+2, cell-4, cell-4);
          ctx.globalAlpha = 1.0;
        }
      }
    }
  }

  // placed tiles
  for(let y=0;y<gridH;y++){
    for(let x=0;x<gridW;x++){
      const t = board[y][x];
      if(t===TILES.EMPTY) continue;
      ctx.fillStyle =
        t===TILES.WALL ? COLORS.wall :
        t===TILES.WINDOW ? COLORS.window :
        t===TILES.DOOR ? COLORS.door :
        COLORS.roof;
      ctx.fillRect(x*cell+4, y*cell+4, cell-8, cell-8);
    }
  }

  // grid lines
  ctx.strokeStyle = COLORS.grid;
  for(let x=0;x<=gridW;x++){
    ctx.beginPath(); ctx.moveTo(x*cell,0); ctx.lineTo(x*cell,gridH*cell); ctx.stroke();
  }
  for(let y=0;y<=gridH;y++){
    ctx.beginPath(); ctx.moveTo(0,y*cell); ctx.lineTo(gridW*cell,y*cell); ctx.stroke();
  }
}

// socket events
socket.on('roomUpdate', ({players})=>{
  pcountEl.textContent = players;
});
socket.on('gridUpdate', ({x,y,tile})=>{
  if(board){ board[y][x] = tile; draw(); }
});
socket.on('scored', (res)=>{
  showScore(res);
});
socket.on('roundReset', ({board:nb, blueprint:bp})=>{
  board = nb; blueprint = bp; locked = false; draw();
});

// helpers
function showScore(res){
  locked = true;
  document.getElementById('acc').textContent = res.accuracy;
  document.getElementById('wrong').textContent = res.wrong;
  document.getElementById('final').textContent = res.finalScore;
  const starTxt = res.stars===3 ? "★★★" : res.stars===2 ? "★★☆" : "★☆☆";
  document.getElementById('stars').textContent = starTxt;
  document.getElementById('scorePanel').classList.remove('hidden');
}

hintStatus();
resizeCanvas();
draw();

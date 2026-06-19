const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../public')));

// ── CONFIG ─────────────────────────────────────────────────────────────────
const SITE_CODE      = '4829173';
const TICK_MS        = 50;
const PLAYER_HP      = 100;
const BULLET_SPEED   = 0.55;
const BULLET_LIFE    = 70;
const BULLET_DMG_MIN = 18;
const BULLET_DMG_MAX = 28;
const RESPAWN_MS     = 5000;
const TDM_LIMIT      = 20;
const CTF_LIMIT      = 3;
const DUEL_LIMIT     = 10;
const BOT_SPEED      = 0.06;
const BOT_SHOOT_PROB = 0.07;
const BOT_NAMES      = ['Vortex','Cipher','Kraken','Nova','Reaper','Shade','Titan','Hex','Blitz','Ghost','Cobra','Dusk','Specter','Raze','Volt','Pyro'];

// ── MAP ─────────────────────────────────────────────────────────────────────
// Walls: { x, z, w, d }  (all Y heights are 3 units)
const HALF = 20;
const WALLS = [
  // Outer boundary
  { x:0,    z:-HALF, w:HALF*2, d:1 },
  { x:0,    z: HALF, w:HALF*2, d:1 },
  { x:-HALF,z:0,     w:1, d:HALF*2 },
  { x: HALF,z:0,     w:1, d:HALF*2 },
  // Interior cover boxes
  { x:-8, z:-6, w:4, d:4 },
  { x: 8, z:-6, w:4, d:4 },
  { x:-8, z: 6, w:4, d:4 },
  { x: 8, z: 6, w:4, d:4 },
  { x: 0, z: 0, w:3, d:8 },
  { x:-14,z: 0, w:2, d:6 },
  { x: 14,z: 0, w:2, d:6 },
  { x: 0, z:-12,w:8, d:2 },
  { x: 0, z: 12,w:8, d:2 },
];

const SPAWNS = {
  red:  [{x:-17,z:0},{x:-15,z:4},{x:-15,z:-4},{x:-13,z:2},{x:-13,z:-2}],
  blue: [{x: 17,z:0},{x: 15,z:4},{x: 15,z:-4},{x: 13,z:2},{x: 13,z:-2}],
};

const FLAG_HOME = {
  red:  { x:-17, z:0 },
  blue: { x: 17, z:0 },
};

function randSpawn(team) {
  const pts = SPAWNS[team];
  const p = pts[Math.floor(Math.random() * pts.length)];
  return { x: p.x + (Math.random()-.5), z: p.z + (Math.random()-.5) };
}

function collidesWall(x, z, r=0.45) {
  for (const w of WALLS) {
    if (x+r > w.x-w.w/2 && x-r < w.x+w.w/2 &&
        z+r > w.z-w.d/2 && z-r < w.z+w.d/2) return true;
  }
  return false;
}

// ── STATE ───────────────────────────────────────────────────────────────────
const lobbies    = new Map(); // code -> lobby
const socketLobby= new Map(); // socketId -> code

function mkLobby(code, hostId, mode) {
  return {
    code, mode, hostId,
    state: 'waiting',
    players: {},   // socketId -> playerState
    bots:    {},   // botId    -> playerState
    bullets: [],
    score: { red:0, blue:0 },
    flags: {
      red:  { x:FLAG_HOME.red.x,  z:FLAG_HOME.red.z,  home:true, carrier:null },
      blue: { x:FLAG_HOME.blue.x, z:FLAG_HOME.blue.z, home:true, carrier:null },
    },
    tick: null,
    limit: mode==='ctf' ? CTF_LIMIT : mode==='1v1' ? DUEL_LIMIT : TDM_LIMIT,
  };
}

function mkPlayerState(id, name, team, isBot=false) {
  const sp = randSpawn(team);
  return {
    id, name, team, isBot,
    x: sp.x, y:0, z: sp.z,
    rotY: team==='red' ? 0 : Math.PI,
    hp: PLAYER_HP, dead:false,
    kills:0, deaths:0, score:0,
    hasFlag:false,
  };
}

function genCode() { return Math.random().toString(36).toUpperCase().slice(2,8); }

// ── GAME LOOP ────────────────────────────────────────────────────────────────
function startGame(lobby) {
  lobby.state = 'playing';

  // Assign teams to human players
  const humans = Object.values(lobby.players);
  humans.forEach((p, i) => {
    const team = (lobby.mode==='1v1') ? (i===0?'red':'blue') : (i%2===0?'red':'blue');
    const sp = randSpawn(team);
    p.team=team; p.x=sp.x; p.z=sp.z; p.hp=PLAYER_HP; p.dead=false;
    p.rotY=team==='red'?0:Math.PI; p.kills=0; p.deaths=0; p.score=0; p.hasFlag=false;
  });
  // Reset bots
  Object.values(lobby.bots).forEach(b => {
    const sp = randSpawn(b.team);
    b.x=sp.x; b.z=sp.z; b.hp=PLAYER_HP; b.dead=false;
    b.rotY=b.team==='red'?0:Math.PI; b.kills=0; b.deaths=0; b.score=0; b.hasFlag=false;
  });

  lobby.tick = setInterval(() => gameTick(lobby), TICK_MS);
}

function gameTick(lobby) {
  if (lobby.state !== 'playing') return;
  tickBots(lobby);
  tickBullets(lobby);
  broadcastState(lobby);
}

function tickBots(lobby) {
  const all = allPlayers(lobby);
  for (const bot of Object.values(lobby.bots)) {
    if (bot.dead) continue;
    const enemies = all.filter(p => p.team!==bot.team && !p.dead);
    if (!enemies.length) continue;

    let tx, tz;
    if (lobby.mode==='ctf') {
      const eFlag = lobby.flags[bot.team==='red'?'blue':'red'];
      const mFlag = lobby.flags[bot.team];
      if (!bot.hasFlag) {
        tx = eFlag.carrier ? (all.find(p=>p.id===eFlag.carrier)||eFlag).x : eFlag.x;
        tz = eFlag.carrier ? (all.find(p=>p.id===eFlag.carrier)||eFlag).z : eFlag.z;
      } else {
        tx = FLAG_HOME[bot.team].x; tz = FLAG_HOME[bot.team].z;
      }
    } else {
      const t = enemies.reduce((a,b)=>dist2(bot,a)<dist2(bot,b)?a:b);
      tx=t.x; tz=t.z;
    }

    const dx=tx-bot.x, dz=tz-bot.z, d=Math.sqrt(dx*dx+dz*dz);
    if (d>0.5) {
      bot.rotY = Math.atan2(dx,dz);
      const nx=bot.x+(dx/d)*BOT_SPEED, nz=bot.z+(dz/d)*BOT_SPEED;
      if (!collidesWall(nx,nz))      { bot.x=nx; bot.z=nz; }
      else if (!collidesWall(nx,bot.z)) bot.x=nx;
      else if (!collidesWall(bot.x,nz)) bot.z=nz;
    }

    // Shoot
    const nearest = enemies.reduce((a,b)=>dist2(bot,a)<dist2(bot,b)?a:b);
    if (dist2(bot,nearest)<18*18 && Math.random()<BOT_SHOOT_PROB) {
      const ang = Math.atan2(nearest.x-bot.x, nearest.z-bot.z) + (Math.random()-.5)*0.25;
      lobby.bullets.push({
        id:uuidv4().slice(0,8), owner:bot.id, team:bot.team,
        x:bot.x, y:0.6, z:bot.z,
        vx:Math.sin(ang)*BULLET_SPEED, vz:Math.cos(ang)*BULLET_SPEED,
        life:BULLET_LIFE,
      });
    }

    // CTF flag logic
    if (lobby.mode==='ctf') ctfPickup(lobby, bot);
  }
}

function dist2(a,b) { return (a.x-b.x)**2+(a.z-b.z)**2; }

function tickBullets(lobby) {
  const all = allPlayers(lobby);
  lobby.bullets = lobby.bullets.filter(b => {
    b.x+=b.vx; b.z+=b.vz; b.life--;
    if (b.life<=0 || b.x<-HALF||b.x>HALF||b.z<-HALF||b.z>HALF) return false;
    if (collidesWall(b.x,b.z,0.1)) return false;

    for (const p of all) {
      if (p.id===b.owner || p.dead || p.team===b.team) continue;
      if (dist2(b,p)<0.9*0.9) {
        const dmg = BULLET_DMG_MIN + Math.floor(Math.random()*(BULLET_DMG_MAX-BULLET_DMG_MIN));
        p.hp -= dmg;
        io.to(lobby.code).emit('hit', { id:p.id, dmg, hp:Math.max(0,p.hp) });
        if (p.hp<=0) killPlayer(lobby, p, b.owner);
        return false;
      }
    }
    return true;
  });
}

function killPlayer(lobby, victim, killerId) {
  victim.dead=true; victim.hp=0; victim.deaths++;
  const killer = allPlayers(lobby).find(p=>p.id===killerId);
  if (killer) { killer.kills++; killer.score++; }

  // Drop flag
  if (victim.hasFlag) {
    const ft = victim.team==='red'?'blue':'red';
    lobby.flags[ft].carrier=null; lobby.flags[ft].x=victim.x; lobby.flags[ft].z=victim.z;
    victim.hasFlag=false;
  }

  io.to(lobby.code).emit('killed', {
    victimId:victim.id, victimName:victim.name,
    killerId: killer?.id, killerName:killer?.name||'?',
    killerTeam: killer?.team,
  });

  if (lobby.mode!=='ctf' && killer) {
    lobby.score[killer.team]++;
    checkWin(lobby);
  }

  setTimeout(()=>{
    if (!lobby.players[victim.id] && !lobby.bots[victim.id]) return;
    const sp = randSpawn(victim.team);
    victim.x=sp.x; victim.z=sp.z; victim.hp=PLAYER_HP; victim.dead=false;
    io.to(lobby.code).emit('respawned', { id:victim.id, x:victim.x, z:victim.z, hp:PLAYER_HP });
  }, RESPAWN_MS);
}

function ctfPickup(lobby, player) {
  const eTeam = player.team==='red'?'blue':'red';
  const eFlag = lobby.flags[eTeam];
  const mFlag = lobby.flags[player.team];

  if (!player.hasFlag && eFlag.home && !eFlag.carrier && dist2(player,eFlag)<1.5*1.5) {
    eFlag.home=false; eFlag.carrier=player.id; player.hasFlag=true;
    io.to(lobby.code).emit('flagEvent',{type:'pickup',player:player.name,team:eTeam});
  }
  if (player.hasFlag && mFlag.home && dist2(player,FLAG_HOME[player.team])<1.5*1.5) {
    lobby.score[player.team]++;
    player.hasFlag=false; player.score++;
    eFlag.home=true; eFlag.x=FLAG_HOME[eTeam].x; eFlag.z=FLAG_HOME[eTeam].z; eFlag.carrier=null;
    io.to(lobby.code).emit('flagEvent',{type:'capture',player:player.name,team:player.team,score:lobby.score});
    checkWin(lobby);
  }
  if (!mFlag.home && !mFlag.carrier && dist2(player,mFlag)<1.5*1.5) {
    mFlag.home=true; mFlag.x=FLAG_HOME[player.team].x; mFlag.z=FLAG_HOME[player.team].z;
    io.to(lobby.code).emit('flagEvent',{type:'return',player:player.name,team:player.team});
  }
}

function checkWin(lobby) {
  if (lobby.score.red>=lobby.limit) endGame(lobby,'red');
  else if (lobby.score.blue>=lobby.limit) endGame(lobby,'blue');
}

function endGame(lobby, winner) {
  lobby.state='ended';
  clearInterval(lobby.tick); lobby.tick=null;
  io.to(lobby.code).emit('gameOver',{winner,score:lobby.score});
}

function allPlayers(lobby) {
  return [...Object.values(lobby.players), ...Object.values(lobby.bots)];
}

function broadcastState(lobby) {
  io.to(lobby.code).emit('state', {
    players: allPlayers(lobby).map(p=>({
      id:p.id,name:p.name,team:p.team,isBot:p.isBot,
      x:p.x,y:p.y,z:p.z,rotY:p.rotY,
      hp:p.hp,dead:p.dead,hasFlag:p.hasFlag,
      kills:p.kills,deaths:p.deaths,score:p.score,
    })),
    bullets: lobby.bullets.map(b=>({id:b.id,x:b.x,y:b.y,z:b.z,team:b.team})),
    score: lobby.score,
    flags: lobby.flags,
  });
}

function lobbyInfo(lobby) {
  return {
    code:lobby.code, mode:lobby.mode, hostId:lobby.hostId, state:lobby.state,
    score:lobby.score, limit:lobby.limit,
    players: allPlayers(lobby).map(p=>({
      id:p.id,name:p.name,team:p.team,isBot:p.isBot||false,
      kills:p.kills,deaths:p.deaths,
    })),
  };
}

// ── SOCKET ──────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('auth', ({code,name}) => {
    if (code!==SITE_CODE) { socket.emit('authFail'); return; }
    socket.playerName = name.slice(0,16).trim() || 'Player';
    socket.emit('authOk', { name: socket.playerName });
    socket.emit('lobbyList', publicLobbies());
  });

  socket.on('createLobby', ({mode}) => {
    const code = genCode();
    const lobby = mkLobby(code, socket.id, mode||'tdm');
    const p = mkPlayerState(socket.id, socket.playerName, 'red');
    lobby.players[socket.id] = p;
    lobbies.set(code, lobby);
    socketLobby.set(socket.id, code);
    socket.join(code);
    socket.emit('lobbyJoined', lobbyInfo(lobby));
    broadcastLobbyList();
  });

  socket.on('joinLobby', ({code}) => {
    const lobby = lobbies.get(code);
    if (!lobby)                    { socket.emit('joinErr','Lobby not found'); return; }
    if (lobby.state!=='waiting')   { socket.emit('joinErr','Game already started'); return; }
    if (allPlayers(lobby).length>=10){ socket.emit('joinErr','Lobby is full'); return; }
    const reds  = allPlayers(lobby).filter(p=>p.team==='red').length;
    const blues = allPlayers(lobby).filter(p=>p.team==='blue').length;
    const team  = reds<=blues?'red':'blue';
    const p = mkPlayerState(socket.id, socket.playerName, team);
    lobby.players[socket.id]=p;
    socketLobby.set(socket.id,code);
    socket.join(code);
    socket.emit('lobbyJoined', lobbyInfo(lobby));
    io.to(code).emit('lobbyUpdate', lobbyInfo(lobby));
    broadcastLobbyList();
  });

  socket.on('addBot', () => {
    const lobby = myLobby(socket.id);
    if (!lobby||lobby.state!=='waiting') return;
    if (allPlayers(lobby).length>=10) return;
    const reds  = allPlayers(lobby).filter(p=>p.team==='red').length;
    const blues = allPlayers(lobby).filter(p=>p.team==='blue').length;
    const team  = reds<=blues?'red':'blue';
    const id    = 'bot-'+uuidv4().slice(0,6);
    const name  = BOT_NAMES[Object.keys(lobby.bots).length % BOT_NAMES.length];
    lobby.bots[id] = mkPlayerState(id, name, team, true);
    io.to(lobby.code).emit('lobbyUpdate', lobbyInfo(lobby));
  });

  socket.on('removeBot', () => {
    const lobby = myLobby(socket.id);
    if (!lobby||lobby.state!=='waiting') return;
    const ids = Object.keys(lobby.bots);
    if (!ids.length) return;
    delete lobby.bots[ids[ids.length-1]];
    io.to(lobby.code).emit('lobbyUpdate', lobbyInfo(lobby));
  });

  socket.on('startGame', () => {
    const lobby = myLobby(socket.id);
    if (!lobby||lobby.hostId!==socket.id||lobby.state!=='waiting') return;
    startGame(lobby);
    io.to(lobby.code).emit('gameStart', { mode:lobby.mode });
    broadcastLobbyList();
  });

  socket.on('move', ({x,z,rotY}) => {
    const lobby = myLobby(socket.id);
    if (!lobby||lobby.state!=='playing') return;
    const p = lobby.players[socket.id];
    if (!p||p.dead) return;
    const nx = Math.max(-HALF+0.5, Math.min(HALF-0.5, x));
    const nz = Math.max(-HALF+0.5, Math.min(HALF-0.5, z));
    if (!collidesWall(nx,nz)) { p.x=nx; p.z=nz; }
    else if (!collidesWall(nx,p.z)) p.x=nx;
    else if (!collidesWall(p.x,nz)) p.z=nz;
    p.rotY=rotY;
    if (lobby.mode==='ctf') ctfPickup(lobby, p);
  });

  socket.on('shoot', ({vx,vz}) => {
    const lobby = myLobby(socket.id);
    if (!lobby||lobby.state!=='playing') return;
    const p = lobby.players[socket.id];
    if (!p||p.dead) return;
    const mag = Math.sqrt(vx*vx+vz*vz)||1;
    lobby.bullets.push({
      id:uuidv4().slice(0,8), owner:p.id, team:p.team,
      x:p.x, y:0.6, z:p.z,
      vx:(vx/mag)*BULLET_SPEED, vz:(vz/mag)*BULLET_SPEED,
      life:BULLET_LIFE,
    });
  });

  socket.on('leaveLobby', () => cleanup(socket));
  socket.on('disconnect', () => cleanup(socket));
  socket.on('getLobbies',  () => socket.emit('lobbyList', publicLobbies()));
});

function myLobby(socketId) {
  const code = socketLobby.get(socketId);
  return code ? lobbies.get(code) : null;
}

function cleanup(socket) {
  const lobby = myLobby(socket.id);
  socketLobby.delete(socket.id);
  if (!lobby) return;
  const p = lobby.players[socket.id];
  if (p?.hasFlag) {
    const ft = p.team==='red'?'blue':'red';
    lobby.flags[ft].carrier=null; lobby.flags[ft].x=p.x; lobby.flags[ft].z=p.z;
  }
  delete lobby.players[socket.id];
  if (Object.keys(lobby.players).length===0) {
    clearInterval(lobby.tick);
    lobbies.delete(lobby.code);
  } else {
    if (lobby.hostId===socket.id) lobby.hostId=Object.keys(lobby.players)[0];
    io.to(lobby.code).emit('lobbyUpdate', lobbyInfo(lobby));
  }
  broadcastLobbyList();
}

function publicLobbies() {
  return [...lobbies.values()]
    .filter(l=>l.state==='waiting')
    .map(l=>({ code:l.code, mode:l.mode, players:allPlayers(l).length, max:10 }));
}

function broadcastLobbyList() {
  io.emit('lobbyList', publicLobbies());
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`KourZone running on :${PORT}`));

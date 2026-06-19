/* ui.js — Lobby UI */
const UI = (() => {
  let curLobby=null, mySocketId=null, selMode='tdm';
  const MODES={tdm:'TEAM DEATHMATCH',ctf:'CAPTURE THE FLAG','1v1':'1v1 DUEL'};

  function init(sid){
    mySocketId=sid;
    // Tabs
    document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.tc').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const tc=document.getElementById('tc-'+t.dataset.t);
      if(tc) tc.classList.add('active');
    }));
    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.mode-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); selMode=b.dataset.m;
    }));
    // Buttons
    document.getElementById('createBtn').onclick=()=>window._sock.emit('createLobby',{mode:selMode});
    document.getElementById('joinBtn').onclick=doJoin;
    document.getElementById('joinIn').onkeydown=e=>{if(e.key==='Enter')doJoin();};
    document.getElementById('addBotBtn').onclick=()=>window._sock.emit('addBot');
    document.getElementById('rmBotBtn').onclick=()=>window._sock.emit('removeBot');
    document.getElementById('startBtn').onclick=()=>window._sock.emit('startGame');
    document.getElementById('leaveBtn').onclick=()=>{window._sock.emit('leaveLobby');hideLobby();};
    document.getElementById('copyBtn').onclick=()=>{
      if(!curLobby) return;
      navigator.clipboard.writeText(curLobby.code).catch(()=>{});
      const b=document.getElementById('copyBtn');
      b.textContent='✓ COPIED!'; b.style.color='#2ecc71';
      setTimeout(()=>{b.textContent='COPY CODE';b.style.color='';},1500);
    };
    document.getElementById('goBackBtn').onclick=()=>{
      document.getElementById('goSc').style.display='none';
      showScreen('lobby');
    };
  }

  function doJoin(){
    const code=document.getElementById('joinIn').value.toUpperCase().trim();
    if(code.length<6){document.getElementById('joinErr').textContent='Enter 6-character code';return;}
    window._sock.emit('joinLobby',{code});
  }

  function showLobby(lobby){
    curLobby=lobby;
    document.getElementById('lbRight').style.display='block';
    document.getElementById('inviteCode').textContent=lobby.code;
    document.getElementById('modeTitle').textContent=MODES[lobby.mode]||lobby.mode;
    const isHost=lobby.hostId===mySocketId;
    document.getElementById('startBtn').style.display=isHost?'block':'none';
    document.getElementById('addBotBtn').style.display=isHost?'block':'none';
    document.getElementById('rmBotBtn').style.display=isHost?'block':'none';
    document.getElementById('hostNote').textContent=isHost?'You are the host — start when ready.':'Waiting for host to start…';
    const red=lobby.players.filter(p=>p.team==='red');
    const blue=lobby.players.filter(p=>p.team==='blue');
    document.getElementById('redList').innerHTML=red.map(pRow).join('')||'<p style="color:rgba(255,255,255,.2);font-size:12px;padding:4px 0">Empty</p>';
    document.getElementById('blueList').innerHTML=blue.map(pRow).join('')||'<p style="color:rgba(255,255,255,.2);font-size:12px;padding:4px 0">Empty</p>';
  }

  function pRow(p){
    const me=p.id===window._mySocketId;
    const tc=p.team;
    const bot=p.isBot?'<span class="prow-bot">BOT</span>':'';
    const you=me?'<span class="prow-you">(you)</span>':'';
    return `<div class="prow ${tc}"><span class="prow-name">${p.isBot?'🤖 ':''}${p.name}${you}</span>${bot}</div>`;
  }

  function hideLobby(){curLobby=null;document.getElementById('lbRight').style.display='none';}

  function showBrowse(list){
    const el=document.getElementById('browseList');
    if(!list||!list.length){el.innerHTML='<p class="empty">No open lobbies — create one!</p>';return;}
    el.innerHTML=list.map(l=>`
      <div class="browse-item">
        <div><p class="bi-code">${l.code} · ${MODES[l.mode]||l.mode}</p><p class="bi-sub">${l.players}/${l.max} PLAYERS</p></div>
        <button class="btn-blue" onclick="window._sock.emit('joinLobby',{code:'${l.code}'})">JOIN</button>
      </div>`).join('');
  }

  function getLobby(){return curLobby;}

  return {init,showLobby,hideLobby,showBrowse,getLobby};
})();

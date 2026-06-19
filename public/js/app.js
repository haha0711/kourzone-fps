/* app.js — Auth, socket, screen routing */
(function(){
  const SITE_CODE='4829173';
  let sock=null, myName='', myTeam='red', gameOn=false;

  // ── SCREEN HELPER ─────────────────────────────────────────────────────
  function show(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById('s-'+id).classList.add('active');
  }
  window.showScreen=show;

  // ── AUTH GATE ─────────────────────────────────────────────────────────
  const digitRow=document.getElementById('digitRow');
  const codeIn=document.getElementById('codeIn');
  const authBtn=document.getElementById('authBtn');
  const authErr=document.getElementById('authError')||document.getElementById('authErr');

  for(let i=0;i<7;i++){
    const b=document.createElement('div');
    b.className='digit-box'; b.id='db'+i; digitRow.appendChild(b);
  }
  digitRow.addEventListener('click',()=>codeIn.focus());
  document.getElementById('s-auth').addEventListener('click',()=>codeIn.focus());

  codeIn.addEventListener('input',()=>{
    const v=codeIn.value.replace(/\D/g,'').slice(0,7);
    codeIn.value=v;
    for(let i=0;i<7;i++){
      const b=document.getElementById('db'+i);
      b.textContent=v[i]||''; b.classList.toggle('on',i<v.length); b.classList.remove('err');
    }
    if(authErr) authErr.textContent='';
    authBtn.disabled=v.length<7;
  });
  codeIn.addEventListener('keydown',e=>{if(e.key==='Enter'&&!authBtn.disabled)authBtn.click();});

  authBtn.addEventListener('click',()=>{
    if(codeIn.value===SITE_CODE){ show('name'); setTimeout(()=>document.getElementById('nameIn').focus(),80); }
    else{
      for(let i=0;i<7;i++) document.getElementById('db'+i).classList.add('err');
      if(authErr) authErr.textContent='⚠ ACCESS DENIED';
      codeIn.value=''; for(let i=0;i<7;i++) document.getElementById('db'+i).textContent='';
      authBtn.disabled=true;
      setTimeout(()=>{for(let i=0;i<7;i++) document.getElementById('db'+i).classList.remove('err');if(authErr)authErr.textContent='';},1200);
    }
  });
  setTimeout(()=>codeIn.focus(),120);

  // ── NAME SCREEN ───────────────────────────────────────────────────────
  const nameIn=document.getElementById('nameIn');
  const nameBtn=document.getElementById('nameBtn');
  const nameErr=document.getElementById('nameErr');

  function submitName(){
    const n=nameIn.value.trim();
    if(n.length<2||n.length>16){if(nameErr)nameErr.textContent='2–16 characters required';return;}
    if(nameErr) nameErr.textContent='';
    myName=n; connect();
  }
  nameBtn.addEventListener('click',submitName);
  nameIn.addEventListener('keydown',e=>{if(e.key==='Enter')submitName();});

  // ── SOCKET ────────────────────────────────────────────────────────────
  function connect(){
    sock=io(); window._sock=sock;

    sock.on('connect',()=>{
      window._mySocketId=sock.id;
      sock.emit('auth',{code:SITE_CODE,name:myName});
    });

    sock.on('authOk',({name})=>{
      myName=name;
      document.getElementById('onlineTag').textContent=name;
      UI.init(sock.id);
      sock.emit('getLobbies');
      show('lobby');
    });

    sock.on('authFail',()=>alert('Server auth failed. Refresh.'));

    sock.on('lobbyJoined',lobby=>{
      document.getElementById('joinErr').textContent='';
      UI.showLobby(lobby);
    });
    sock.on('lobbyUpdate',lobby=>{
      const cur=UI.getLobby();
      if(cur&&cur.code===lobby.code) UI.showLobby(lobby);
    });
    sock.on('joinErr',msg=>{
      document.getElementById('joinErr').textContent='⚠ '+msg;
    });
    sock.on('lobbyList',list=>UI.showBrowse(list));

    sock.on('gameStart',({mode})=>startGame(mode));

    sock.on('state',state=>{if(gameOn) Engine.onState(state);});
    sock.on('killed',data=>{if(gameOn) Engine.onKilled(data);});
    sock.on('respawned',data=>{if(gameOn) Engine.onRespawned(data);});

    sock.on('hit',({id})=>{
      if(id!==sock.id||!gameOn) return;
      const f=document.createElement('div');
      f.style.cssText='position:fixed;inset:0;background:rgba(220,40,40,.32);pointer-events:none;z-index:999;animation:kfFade .35s forwards';
      document.body.appendChild(f); setTimeout(()=>f.remove(),350);
    });

    sock.on('flagEvent',({type,player,team,score})=>{
      const msgs={
        pickup:`🚩 ${player} picked up the ${team.toUpperCase()} flag!`,
        capture:`🎉 ${player} captured the ${team.toUpperCase()} flag! [${score?.red??''}–${score?.blue??''}]`,
        return:`↩ ${player} returned the ${team.toUpperCase()} flag`,
      };
      if(gameOn) Engine.addAlert(msgs[type]||'',type==='capture'?'#2ecc71':'#f1c40f');
    });

    sock.on('gameOver',({winner,score})=>{
      if(!gameOn) return;
      gameOn=false;
      document.exitPointerLock();
      const ws=document.getElementById('goSc');
      const ww=document.getElementById('goWinner');
      ww.textContent=winner.toUpperCase()+' TEAM WINS!';
      ww.style.color=winner==='red'?'#e74c3c':'#3498db';
      document.getElementById('goScore').textContent=`RED ${score.red} — BLUE ${score.blue}`;
      ws.style.display='flex';
    });

    sock.on('disconnect',()=>{
      if(gameOn) Engine.addAlert('⚠ Disconnected — refresh to reconnect','#e74c3c');
    });
  }

  // ── GAME START ────────────────────────────────────────────────────────
  function startGame(mode){
    const lobby=UI.getLobby();
    const me=lobby?.players.find(p=>p.id===sock.id);
    myTeam=me?.team||'red';

    // Reset HUD
    document.getElementById('deathSc').style.display='none';
    document.getElementById('goSc').style.display='none';
    document.getElementById('tabSB').style.display='none';
    document.getElementById('flagHUD').style.display='none';
    document.getElementById('killFeed').innerHTML='';
    document.getElementById('reloadTxt').style.display='none';
    document.getElementById('hpBar').style.width='100%';
    document.getElementById('hpNum').textContent='100';
    document.getElementById('ammoNum').innerHTML='30<span class="dim">/30</span>';

    gameOn=true;
    show('game');

    const canvas=document.getElementById('gc');
    Engine.cleanup();
    Engine.init(canvas, sock.id, myTeam);
    Engine.setMode(mode);
    const spawnX=myTeam==='red'?-17:17;
    Engine.setPos(spawnX,0);
  }

  show('auth');
})();

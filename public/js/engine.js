/* engine.js — Three.js first-person FPS renderer */
const Engine = (() => {
  let scene, camera, renderer, clock;
  let myId, myTeam, myX=0, myZ=0, myHP=100, myAmmo=30;
  let dead=false, reloading=false;
  let yaw=0, pitch=0;
  let moveF=false,moveB=false,moveL=false,moveR=false;
  let locked=false;
  let lastShot=0;
  const SHOOT_CD=200, SPEED=0.11, MAX_AMMO=30, HALF=20;
  const playerMeshes={}, bulletMeshes={}, flagMeshes={};

  // ── WALLS (mirror server) ──────────────────────────────────────────────
  const WALLS=[
    {x:0,z:-HALF,w:HALF*2,d:1},{x:0,z:HALF,w:HALF*2,d:1},
    {x:-HALF,z:0,w:1,d:HALF*2},{x:HALF,z:0,w:1,d:HALF*2},
    {x:-8,z:-6,w:4,d:4},{x:8,z:-6,w:4,d:4},
    {x:-8,z:6,w:4,d:4},{x:8,z:6,w:4,d:4},
    {x:0,z:0,w:3,d:8},{x:-14,z:0,w:2,d:6},{x:14,z:0,w:2,d:6},
    {x:0,z:-12,w:8,d:2},{x:0,z:12,w:8,d:2},
  ];

  function hitWall(x,z,r=0.44){
    for(const w of WALLS)
      if(x+r>w.x-w.w/2&&x-r<w.x+w.w/2&&z+r>w.z-w.d/2&&z-r<w.z+w.d/2) return true;
    return false;
  }

  // ── INIT ──────────────────────────────────────────────────────────────
  function init(canvas, id, team){
    myId=id; myTeam=team;

    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x7ab8d4);
    scene.fog=new THREE.Fog(0x7ab8d4,22,60);

    camera=new THREE.PerspectiveCamera(75,canvas.clientWidth/canvas.clientHeight,0.05,150);
    camera.position.set(0,0.72,0);

    renderer=new THREE.WebGLRenderer({canvas,antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(canvas.clientWidth,canvas.clientHeight);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    clock=new THREE.Clock();

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff,0.55));
    const sun=new THREE.DirectionalLight(0xfff5dd,1.1);
    sun.position.set(8,28,12); sun.castShadow=true;
    sun.shadow.mapSize.width=sun.shadow.mapSize.height=2048;
    sun.shadow.camera.left=-HALF; sun.shadow.camera.right=HALF;
    sun.shadow.camera.top=HALF; sun.shadow.camera.bottom=-HALF;
    sun.shadow.camera.near=1; sun.shadow.camera.far=80;
    scene.add(sun);

    buildMap();
    buildWeapon();
    setupPointerLock(canvas);
    setupKeys();
    window.addEventListener('resize',()=>{
      camera.aspect=canvas.clientWidth/canvas.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(canvas.clientWidth,canvas.clientHeight);
    });
    loop();
  }

  // ── MAP ────────────────────────────────────────────────────────────────
  function buildMap(){
    // Floor
    const floorGeo=new THREE.PlaneGeometry(HALF*2,HALF*2,20,20);
    const floorMat=new THREE.MeshLambertMaterial({color:0x3a5a35});
    const floor=new THREE.Mesh(floorGeo,floorMat);
    floor.rotation.x=-Math.PI/2; floor.receiveShadow=true;
    scene.add(floor);

    // Floor tile pattern
    const tlMat=new THREE.MeshLambertMaterial({color:0x334f2f});
    for(let i=-HALF+2;i<HALF;i+=4) for(let j=-HALF+2;j<HALF;j+=4){
      const tg=new THREE.PlaneGeometry(3.6,3.6);
      const tm=new THREE.Mesh(tg,tlMat);
      tm.rotation.x=-Math.PI/2; tm.position.set(i,0.002,j); tm.receiveShadow=true;
      scene.add(tm);
    }

    // Ceiling
    const ceilGeo=new THREE.PlaneGeometry(HALF*2,HALF*2);
    const ceilMat=new THREE.MeshLambertMaterial({color:0x2a2a36});
    const ceil=new THREE.Mesh(ceilGeo,ceilMat);
    ceil.rotation.x=Math.PI/2; ceil.position.y=3.2;
    scene.add(ceil);

    // Walls
    WALLS.forEach(w=>{
      const isOuter=w.w>=HALF||w.d>=HALF;
      const geo=new THREE.BoxGeometry(w.w,3.2,w.d);
      const mat=new THREE.MeshLambertMaterial({color:isOuter?0x22242e:0x5c3d20});
      const mesh=new THREE.Mesh(geo,mat);
      mesh.position.set(w.x,1.6,w.z);
      mesh.castShadow=true; mesh.receiveShadow=true;
      scene.add(mesh);
      // Top cap
      const capGeo=new THREE.BoxGeometry(w.w+.15,0.12,w.d+.15);
      const capMat=new THREE.MeshLambertMaterial({color:isOuter?0x33364a:0x7a5530});
      const cap=new THREE.Mesh(capGeo,capMat);
      cap.position.set(w.x,3.26,w.z);
      scene.add(cap);
    });

    // Grid lines on floor
    const grid=new THREE.GridHelper(HALF*2,HALF*2,0x000000,0x000000);
    grid.position.y=0.004; grid.material.opacity=0.06; grid.material.transparent=true;
    scene.add(grid);

    // Base circles
    addBase(-HALF+2,0,0xff2222,'red');
    addBase( HALF-2,0,0x2255ff,'blue');

    // Flags
    addFlag('red', -HALF+2,0);
    addFlag('blue', HALF-2,0);

    // Ammo crates scattered around
    const cratePos=[{x:0,z:0},{x:-8,z:-6},{x:8,z:6},{x:-8,z:6},{x:8,z:-6}];
    cratePos.forEach(p=>{
      const cg=new THREE.BoxGeometry(.7,.7,.7);
      const cm=new THREE.MeshLambertMaterial({color:0x8b6914});
      const c=new THREE.Mesh(cg,cm);
      c.position.set(p.x,0.35,p.z); c.castShadow=true;
      scene.add(c);
    });
  }

  function addBase(x,z,color,team){
    const geo=new THREE.CylinderGeometry(2.2,2.2,0.06,32);
    const mat=new THREE.MeshLambertMaterial({color,transparent:true,opacity:.3});
    const m=new THREE.Mesh(geo,mat);
    m.position.set(x,.03,z); scene.add(m);
  }

  function addFlag(team,x,z){
    const g=new THREE.Group();
    // Pole
    const poleMat=new THREE.MeshLambertMaterial({color:0xbbbbbb});
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,2.2,8),poleMat);
    pole.position.y=1.1; g.add(pole);
    // Cloth
    const cloth=new THREE.Mesh(
      new THREE.BoxGeometry(.75,.42,.06),
      new THREE.MeshLambertMaterial({color:team==='red'?0xff1111:0x1155ff})
    );
    cloth.position.set(.38,2,.0); g.add(cloth);
    // Base disc
    const disc=new THREE.Mesh(
      new THREE.CylinderGeometry(.2,.2,.1,12),
      new THREE.MeshLambertMaterial({color:0x666666})
    );
    disc.position.y=.05; g.add(disc);
    g.position.set(x,0,z);
    scene.add(g);
    flagMeshes[team]=g;
  }

  // ── WEAPON ────────────────────────────────────────────────────────────
  let weaponGroup;
  function buildWeapon(){
    weaponGroup=new THREE.Group();
    const dark=new THREE.MeshLambertMaterial({color:0x1a1a1a});
    const mid =new THREE.MeshLambertMaterial({color:0x2d2d2d});
    // Body
    const body=new THREE.Mesh(new THREE.BoxGeometry(.09,.1,.52),dark);
    // Barrel
    const barrel=new THREE.Mesh(new THREE.BoxGeometry(.04,.04,.32),mid);
    barrel.position.set(0,.02,-.38);
    // Handle
    const handle=new THREE.Mesh(new THREE.BoxGeometry(.07,.15,.09),dark);
    handle.position.set(0,-.1,.05);
    // Scope
    const scope=new THREE.Mesh(new THREE.BoxGeometry(.04,.05,.12),mid);
    scope.position.set(0,.08,-.08);
    // Mag
    const mag=new THREE.Mesh(new THREE.BoxGeometry(.06,.12,.05),dark);
    mag.position.set(0,-.08,0);
    weaponGroup.add(body,barrel,handle,scope,mag);
    weaponGroup.position.set(.2,-.19,-.42);
    camera.add(weaponGroup);
    scene.add(camera);
  }

  // ── PLAYER MESHES ─────────────────────────────────────────────────────
  function getOrMakePlayer(p){
    if(playerMeshes[p.id]) return playerMeshes[p.id];
    const g=new THREE.Group();
    const isRed=p.team==='red';
    const bodyCol=isRed?0xbb1f1f:0x1a5ab5;
    const headCol=isRed?0xdd2222:0x2266cc;
    const armorCol=isRed?0x881515:0x0f3f8a;
    const visorCol=isRed?0x1a8cff:0xff4422;

    // Shadow
    const shadowGeo=new THREE.CylinderGeometry(.4,.4,.05,16);
    const shadowMat=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.28});
    const shadow=new THREE.Mesh(shadowGeo,shadowMat);
    shadow.position.y=.02; g.add(shadow);

    // Legs
    const legMat=new THREE.MeshLambertMaterial({color:0x111122});
    const legGeo=new THREE.BoxGeometry(.22,.55,.22);
    const lL=new THREE.Mesh(legGeo,legMat); lL.position.set(-.15,-.05,0); lL.castShadow=true;
    const lR=new THREE.Mesh(legGeo,legMat); lR.position.set(.15,-.05,0);  lR.castShadow=true;
    g.add(lL,lR);

    // Torso
    const torsoMat=new THREE.MeshLambertMaterial({color:bodyCol});
    const torso=new THREE.Mesh(new THREE.BoxGeometry(.58,.75,.38),torsoMat);
    torso.position.y=.5; torso.castShadow=true; g.add(torso);

    // Chest plate
    const plateMat=new THREE.MeshLambertMaterial({color:armorCol});
    const plate=new THREE.Mesh(new THREE.BoxGeometry(.5,.28,.12),plateMat);
    plate.position.set(0,.6,.2); g.add(plate);

    // Arms
    const armMat=new THREE.MeshLambertMaterial({color:armorCol});
    const armGeo=new THREE.BoxGeometry(.18,.52,.2);
    const aL=new THREE.Mesh(armGeo,armMat); aL.position.set(-.38,.45,0); aL.castShadow=true;
    const aR=new THREE.Mesh(armGeo,armMat); aR.position.set(.38,.45,0);  aR.castShadow=true;
    g.add(aL,aR);

    // Gun model on player
    const gunMat=new THREE.MeshLambertMaterial({color:0x1a1a1a});
    const gun=new THREE.Mesh(new THREE.BoxGeometry(.07,.07,.44),gunMat);
    gun.position.set(.35,.45,-.22); g.add(gun);

    // Head
    const headMat=new THREE.MeshLambertMaterial({color:headCol});
    const head=new THREE.Mesh(new THREE.BoxGeometry(.42,.42,.42),headMat);
    head.position.y=1.08; head.castShadow=true; g.add(head);

    // Visor
    const visorMat=new THREE.MeshLambertMaterial({color:visorCol,emissive:isRed?0x001833:0x330011});
    const visor=new THREE.Mesh(new THREE.BoxGeometry(.28,.14,.08),visorMat);
    visor.position.set(0,1.1,.22); g.add(visor);

    // Helmet ridge
    const ridgeMat=new THREE.MeshLambertMaterial({color:armorCol});
    const ridge=new THREE.Mesh(new THREE.BoxGeometry(.44,.1,.12),ridgeMat);
    ridge.position.set(0,1.32,0); g.add(ridge);

    // Name sprite
    const nameSpr=makeNameSprite(p.name,p.team);
    nameSpr.position.y=1.72; g.add(nameSpr);

    g.position.set(p.x,0,p.z);
    scene.add(g);
    playerMeshes[p.id]=g;
    return g;
  }

  function makeNameSprite(name,team){
    const c=document.createElement('canvas');
    c.width=256; c.height=56;
    const ctx=c.getContext('2d');
    ctx.fillStyle=team==='red'?'rgba(200,20,20,.88)':'rgba(20,80,200,.88)';
    ctx.beginPath(); ctx.roundRect(4,8,248,40,6); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 22px Rajdhani,sans-serif';
    ctx.textAlign='center'; ctx.fillText(name.slice(0,12),128,34);
    const tex=new THREE.CanvasTexture(c);
    const geo=new THREE.PlaneGeometry(1.15,.26);
    const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false});
    const mesh=new THREE.Mesh(geo,mat);
    mesh.renderOrder=999;
    return mesh;
  }

  // ── INPUT ─────────────────────────────────────────────────────────────
  function setupPointerLock(canvas){
    const overlay=document.getElementById('clickPlay');
    overlay.addEventListener('click',()=>canvas.requestPointerLock());
    document.addEventListener('pointerlockchange',()=>{
      locked=document.pointerLockElement===canvas;
      overlay.style.display=locked?'none':'flex';
    });
    document.addEventListener('mousemove',e=>{
      if(!locked||dead) return;
      yaw  -=e.movementX*.0018;
      pitch-=e.movementY*.0018;
      pitch=Math.max(-1.1,Math.min(1.1,pitch));
    });
    canvas.addEventListener('click',()=>{
      if(!locked){ canvas.requestPointerLock(); return; }
      shoot();
    });
  }

  function setupKeys(){
    document.addEventListener('keydown',e=>{
      if(e.code==='KeyW'||e.code==='ArrowUp')    moveF=true;
      if(e.code==='KeyS'||e.code==='ArrowDown')  moveB=true;
      if(e.code==='KeyA'||e.code==='ArrowLeft')  moveL=true;
      if(e.code==='KeyD'||e.code==='ArrowRight') moveR=true;
      if(e.code==='KeyR') startReload();
      if(e.code==='Tab'){e.preventDefault();document.getElementById('tabSB').style.display='block';}
      if(e.code==='Escape') document.exitPointerLock();
    });
    document.addEventListener('keyup',e=>{
      if(e.code==='KeyW'||e.code==='ArrowUp')    moveF=false;
      if(e.code==='KeyS'||e.code==='ArrowDown')  moveB=false;
      if(e.code==='KeyA'||e.code==='ArrowLeft')  moveL=false;
      if(e.code==='KeyD'||e.code==='ArrowRight') moveR=false;
      if(e.code==='Tab') document.getElementById('tabSB').style.display='none';
    });
  }

  function shoot(){
    if(dead||reloading||myAmmo<=0) return;
    if(Date.now()-lastShot<SHOOT_CD) return;
    lastShot=Date.now(); myAmmo--;
    if(myAmmo<=0) startReload(); else updateAmmoHUD();
    // Kick weapon
    if(weaponGroup){ weaponGroup.position.z=-0.36; setTimeout(()=>{if(weaponGroup)weaponGroup.position.z=-.42;},55); }
    const dir=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));
    window._sock&&window._sock.emit('shoot',{vx:dir.x,vz:dir.z});
  }

  function startReload(){
    if(reloading||myAmmo>=MAX_AMMO) return;
    reloading=true; document.getElementById('reloadTxt').style.display='block';
    setTimeout(()=>{reloading=false;myAmmo=MAX_AMMO;document.getElementById('reloadTxt').style.display='none';updateAmmoHUD();},1500);
  }

  function updateAmmoHUD(){
    document.getElementById('ammoNum').innerHTML=`${myAmmo}<span class="dim">/${MAX_AMMO}</span>`;
  }

  // ── GAME STATE ────────────────────────────────────────────────────────
  function onState(state){
    const seen=new Set();
    state.players.forEach(p=>{
      seen.add(p.id);
      if(p.id===myId){
        myHP=p.hp; dead=p.dead;
        updateHpHUD(myHP);
        if(!dead) document.getElementById('deathSc').style.display='none';
        return;
      }
      const mesh=getOrMakePlayer(p);
      mesh.position.set(p.x,0,p.z);
      mesh.rotation.y=p.rotY;
      mesh.visible=!p.dead;
      // Billboard name sprite
      const spr=mesh.children.find(c=>c.material&&c.material.depthTest===false);
      if(spr) spr.quaternion.copy(camera.quaternion);
    });
    // Remove gone players
    Object.keys(playerMeshes).forEach(id=>{
      if(!seen.has(id)){scene.remove(playerMeshes[id]);delete playerMeshes[id];}
    });

    // Bullets
    const bseen=new Set();
    if(state.bullets) state.bullets.forEach(b=>{
      bseen.add(b.id);
      if(!bulletMeshes[b.id]){
        const geo=new THREE.SphereGeometry(.07,6,6);
        const mat=new THREE.MeshBasicMaterial({color:b.team==='red'?0xff5522:0x22aaff});
        const m=new THREE.Mesh(geo,mat); scene.add(m);
        bulletMeshes[b.id]=m;
      }
      bulletMeshes[b.id].position.set(b.x,b.y,b.z);
    });
    Object.keys(bulletMeshes).forEach(id=>{
      if(!bseen.has(id)){scene.remove(bulletMeshes[id]);delete bulletMeshes[id];}
    });

    // Score HUD
    document.getElementById('sr').textContent=`RED ${state.score.red}`;
    document.getElementById('sb').textContent=`BLUE ${state.score.blue}`;

    // Flags
    if(state.flags){
      ['red','blue'].forEach(t=>{
        const f=state.flags[t];
        if(flagMeshes[t]){
          flagMeshes[t].position.set(f.x,0,f.z);
          flagMeshes[t].visible=f.home;
        }
      });
      // Flag HUD
      const myFlag=state.flags[myTeam];
      const eTeam=myTeam==='red'?'blue':'red';
      const eFlag=state.flags[eTeam];
      const fhud=document.getElementById('flagHUD');
      let txt='';
      if(!myFlag.home) txt+='⚠ OUR FLAG TAKEN  ';
      if(eFlag.carrier===myId) txt+='🚩 CARRY FLAG TO BASE!';
      fhud.textContent=txt; fhud.style.display=txt?'block':'none';
    }

    // Scoreboard
    const red=state.players.filter(p=>p.team==='red').sort((a,b)=>b.score-a.score);
    const blue=state.players.filter(p=>p.team==='blue').sort((a,b)=>b.score-a.score);
    const row=p=>`<div class="sb-row"><span class="name">${p.isBot?'🤖 ':''}${p.name}</span><span class="stats">${p.kills}K/${p.deaths}D</span></div>`;
    document.getElementById('sbRed').innerHTML=red.map(row).join('');
    document.getElementById('sbBlue').innerHTML=blue.map(row).join('');
  }

  function updateHpHUD(hp){
    const pct=Math.max(0,hp); document.getElementById('hpNum').textContent=pct;
    const bar=document.getElementById('hpBar');
    bar.style.width=pct+'%';
    bar.style.background=hp>60?'#2ecc71':hp>30?'#f39c12':'#e74c3c';
  }

  function onKilled(data){
    if(data.victimId===myId){
      dead=true; document.getElementById('deathSc').style.display='flex';
      let t=5; document.getElementById('respawnTxt').textContent=`Respawning in ${t}s…`;
      const iv=setInterval(()=>{t--;if(t<=0)clearInterval(iv);else document.getElementById('respawnTxt').textContent=`Respawning in ${t}s…`;},1000);
    }
    const feed=document.getElementById('killFeed');
    const el=document.createElement('div'); el.className='kf';
    const kt=data.killerTeam==='red'?'kr':'kb';
    el.innerHTML=`<span class="${kt}">${data.killerName}</span> ☠ ${data.victimName}`;
    feed.appendChild(el); setTimeout(()=>el.remove(),3000);
  }

  function onRespawned(data){
    if(data.id!==myId) return;
    dead=false; myHP=data.hp; myAmmo=MAX_AMMO; reloading=false;
    updateHpHUD(myHP); updateAmmoHUD();
    myX=data.x; myZ=data.z;
    camera.position.set(myX,.72,myZ);
    document.getElementById('deathSc').style.display='none';
    document.getElementById('reloadTxt').style.display='none';
  }

  // ── MAIN LOOP ─────────────────────────────────────────────────────────
  function loop(){
    requestAnimationFrame(loop);
    if(!dead&&locked){
      const sin=Math.sin(yaw),cos=Math.cos(yaw);
      let dx=0,dz=0;
      if(moveF){dx-=sin*SPEED;dz-=cos*SPEED;}
      if(moveB){dx+=sin*SPEED;dz+=cos*SPEED;}
      if(moveL){dx-=cos*SPEED;dz+=sin*SPEED;}
      if(moveR){dx+=cos*SPEED;dz-=sin*SPEED;}
      if(dx||dz){
        const nx=Math.max(-HALF+.5,Math.min(HALF-.5,myX+dx));
        const nz=Math.max(-HALF+.5,Math.min(HALF-.5,myZ+dz));
        let cx=myX,cz=myZ;
        if(!hitWall(nx,cz)) cx=nx;
        if(!hitWall(cx,nz)) cz=nz;
        if(cx!==myX||cz!==myZ){
          myX=cx; myZ=cz;
          window._sock&&window._sock.emit('move',{x:myX,z:myZ,rotY:yaw});
        }
      }
      camera.position.set(myX,.72,myZ);
      camera.rotation.order='YXZ';
      camera.rotation.y=yaw; camera.rotation.x=pitch;
      // Weapon bob
      if(weaponGroup){
        const bob=(dx||dz)?Math.sin(Date.now()*.009)*.012:0;
        weaponGroup.position.y=-.19+bob;
      }
    }
    renderer.render(scene,camera);
  }

  function setPos(x,z){ myX=x; myZ=z; camera.position.set(x,.72,z); }
  function setMode(mode){ document.getElementById('modeLbl').textContent=mode==='tdm'?'TEAM DEATHMATCH':mode==='ctf'?'CAPTURE THE FLAG':'1v1 DUEL'; }
  function addAlert(msg,col='#f1c40f'){
    const feed=document.getElementById('killFeed');
    const el=document.createElement('div'); el.className='kf';
    el.style.color=col; el.textContent=msg;
    feed.appendChild(el); setTimeout(()=>el.remove(),4500);
  }
  function cleanup(){
    Object.values(playerMeshes).forEach(m=>scene.remove(m));
    Object.values(bulletMeshes).forEach(m=>scene.remove(m));
    Object.keys(playerMeshes).forEach(k=>delete playerMeshes[k]);
    Object.keys(bulletMeshes).forEach(k=>delete bulletMeshes[k]);
  }

  return {init,setPos,setMode,onState,onKilled,onRespawned,addAlert,cleanup};
})();

/* Guided play is the authoritative interaction layer over the tabletop renderer. */
const GuidedPlay = (() => {
    let state = null, message = '', privateBids = {}, revealSent = false;
    const other = p => p === 'p1' ? 'p2' : 'p1';
    const label = p => p === 'p1' ? 'Player 1' : 'Player 2';
    const connected = () => Boolean(conn && conn.open);
    const controls = p => !connected() || p === getLocalBidPlayerKey();
    const units = () => [...table.querySelectorAll('.unit')].filter(u => !u.classList.contains('ghost'));
    const terrain = () => [...table.querySelectorAll('.terrain')];
    const find = id => units().find(u => u.dataset.unitId === id);
    const stat = (s, names, fallback=0) => {
        const value=getStatValue(s,...names);
        const n=parseFloat(value); return Number.isFinite(n)?n:fallback;
    };
    function model(el) {
        const s=getUnitStats(el).stats||{}, melee=String(getStatValue(s,'Melee')||''), shoot=String(getStatValue(s,'Shoot','Ranged')||'');
        return {id:getPieceId(el),owner:el.dataset.owner,x:parseFloat(el.style.left),y:parseFloat(el.style.top),
            w:parseFloat(el.style.width),h:parseFloat(el.style.height),angle:parseFloat(el.dataset.angle)||0,
            terrain:el.classList.contains('terrain'),type:el.dataset.subType,
            pace:stat(s,['Pace','Speed']),mobility:stat(s,['Mobility','Drill']),melee:stat(s,['Melee']),
            shoot:stat(s,['Shoot','Ranged']),range:stat(s,['Range'],parseFloat(shoot.split('/')[1])||0),defence:stat(s,['Defence','Def'],6),
            meleeAP:melee.includes('*'),shootAP:shoot.includes('*')};
    }
    const context = () => ({units:units().map(model),terrain:terrain().map(model),master:biddingState.master,activation:state.activation});
    function fresh() {
        privateBids={}; revealSent=false; message='';
        state={version:1,stage:'pick',picker:biddingState.firstDraftPick||'p1',darkPlayer:Math.random()<.5?'p1':'p2',picked:null,activation:null,
            used:[],starting:{p1:0,p2:0},routed:{p1:0,p2:0},winner:null,log:[]};
        return state;
    }
    function ensure() {
        if(state) return state;
        fresh();
        if(hasBattleStarted()) {
            units().forEach(u=>u.dataset.owner ||= getAssignedPlayer(u));
            state.starting=counts(); state.stage=biddingState.revealed?'commands':'bidding';
            state.used=commandTokens.filter(t=>t.status==='unit').map(t=>t.unitId);
            message='Resumed an older battle. Starting army sizes use the units currently on the board.';
        }
        return state;
    }
    const counts = () => Object.fromEntries(['p1','p2'].map(p=>[p,units().filter(u=>u.dataset.owner===p).length]));
    function note(text) { message=text; render(); return false; }
    function perform(fn, broadcast=true) { try { fn(); message=''; saveGame(!broadcast); } catch(e) { note(e.message); } }
    function record(text) { state.log.unshift(text); state.log=state.log.slice(0,15); }
    function active() { return find(state.activation?.unitId); }
    function requireTurn() {
        ensure();
        if(state.winner) throw Error('The battle is over. Start a new battle to play again.');
        if(state.stage!=='commands'||!biddingState.revealed) throw Error('Finish setup and bidding first.');
        if(!controls(getActivePlayerKey())) throw Error('Wait for your opponent’s turn.');
    }
    function requireActivation() {
        requireTurn(); const u=active(); if(!u) throw Error('Select a unit and activate it first.'); return u;
    }
    function apply(el,m) { el.style.left=`${m.x}px`; el.style.top=`${m.y}px`; el.dataset.angle=m.angle; el.style.transform=`rotate(${m.angle}deg)`; }
    function pick() { perform(()=>{
        if(state.stage!=='pick'||!controls(state.picker)) throw Error('Wait for the drafting player.');
        if(!selectedPiece?.classList.contains('unit')||selectedPiece.dataset.owner) throw Error('Select an undrafted unit in the centre.');
        pushUndo(); state.picked=selectedPiece.dataset.unitId; state.stage='terrain';
        record(`${label(state.picker)} chose ${selectedPiece.dataset.name}.`);
    }); }
    function terrainLegal(m) {
        const p=BattleRules.polygon(m), chosen=find(state.picked);
        return chosen && p.every(v=>v.x>0&&v.x<tableWidthPx&&v.y>DEPLOY_INCHES*SCALE&&v.y<tableHeightPx-DEPLOY_INCHES*SCALE)
            && BattleRules.overlap(p,BattleRules.polygon(model(chosen)))
            && !terrain().some(t=>BattleRules.touches(m,model(t)));
    }
    function placeTerrain(x,y,discard=false) { perform(()=>{
        if(state.stage!=='terrain'||!controls(state.picker)) throw Error('Choose a draft unit before placing its terrain.');
        const type=terrainDeck[0];
        if(!type) throw Error('The terrain deck is empty. Start a new standard battle.');
        const m={x:x-terrainDiameterPx/2,y:y-terrainDiameterPx/2,w:terrainDiameterPx,h:terrainDiameterPx,terrain:true,type};
        if(!discard&&type!=='x'&&!terrainLegal(m)) throw Error('Terrain must overlap the chosen unit and must not touch terrain, deployment zones, or the battlefield edge. Try another position or discard it.');
        pushUndo(); terrainDeck.shift();
        if(!discard&&type!=='x') createTerrainDOM(type,m.x,m.y,m.w,m.h,0);
        state.stage='deploy'; renderTerrainCard();
    }); }
    function deploy() { perform(()=>{
        if(state.stage!=='deploy'||!controls(state.picker)) throw Error('Finish the current draft step first.');
        const el=find(state.picked), m=model(el), points=BattleRules.polygon(m);
        const inside=points.every(p=>p.x>=0&&p.x<=tableWidthPx&&(state.picker==='p1'?p.y>=tableHeightPx-120&&p.y<=tableHeightPx:p.y>=0&&p.y<=120));
        if(!inside||units().some(v=>v!==el&&BattleRules.overlap(points,BattleRules.polygon(model(v))))) throw Error('Place the entire unit inside your 6-inch deployment zone, without overlapping any unit.');
        pushUndo(); el.dataset.owner=state.picker; state.starting[state.picker]++;
        state.picked=null; state.picker=other(state.picker); state.stage=units().some(u=>!u.dataset.owner)?'pick':'bidding';
        if(state.stage==='bidding') record('Deployment complete. Both players secretly bid for commands.');
    }); }
    function activate() { perform(()=>{
        requireTurn(); if(state.activation) throw Error('Finish the current activation first.');
        const el=selectedPiece, player=getActivePlayerKey();
        if(!el?.classList.contains('unit')||el.dataset.owner!==player) throw Error(`Select one of ${label(player)}’s units.`);
        if(state.used.includes(el.dataset.unitId)) throw Error('This unit has already activated this round.');
        const token=commandTokens.find(t=>t.player===player&&t.status==='tray');
        if(!token) throw Error('No commands remain. Pass to the next turn.');
        pushUndo(); token.status='unit'; token.unitId=el.dataset.unitId; state.used.push(el.dataset.unitId);
        state.activation={unitId:el.dataset.unitId,action:null,pivots:0,distance:0,direction:null,movePivoted:false,charged:false,freeStrike:false,closed:false};
        roundState=CommandTracker.activate(roundState,player,true); renderAllCommandTokens();
    }); }
    function chooseAction(action) { perform(()=>{
        const el=requireActivation(), a=state.activation;
        if(a.action) throw Error('This unit has already chosen its action.');
        if(action==='Move'&&BattleRules.enemies(model(el),context().units).length&&el.dataset.owner!==biddingState.master) throw Error('Only the Master Tactician can disengage.');
        if(action==='Shoot'&&!model(el).shoot) throw Error('This unit cannot shoot.');
        pushUndo(); a.action=action;
        if(action==='Rally') { strain(el,-1); a.closed=true; record(`${el.dataset.name} rallied: removed 1 strain.`); }
        if(action==='Extra Pivot') a.closed=true;
    }); }
    function move(inches,backwards) { perform(()=>{
        const el=requireActivation(), a=state.activation;
        if(a.action!=='Move'||a.closed) throw Error('Choose Move first, or finish this activation.');
        const wasHigh=BattleRules.inTerrain(model(el),context().terrain,['hills']);
        const result=BattleRules.move(model(el),Number(inches),backwards,context());
        pushUndo(); if(!a.distance) a.chargeHeight=wasHigh;
        apply(el,result.unit); Object.assign(a,{distance:result.distance,direction:result.direction,slowed:result.slowed,charged:result.charged});
        if(a.charged) {a.freeStrike=true; a.closed=true; record(`${el.dataset.name} charged. It may make one free Strike.`);}
        updateSelectionRanges();
    }); }
    function pivot(degrees) { perform(()=>{
        const el=requireActivation(), a=state.activation, next=BattleRules.pivot(model(el),Number(degrees),context());
        pushUndo(); apply(el,next); a.pivots++; if(a.action==='Move'&&a.distance>0&&!a.closed) a.movePivoted=true;
        updateSelectionRanges();
    }); }
    function strain(el,delta) {
        const value=Math.max(0,Number(el.dataset.wounds||0)+delta); el.dataset.wounds=value;
        const marker=el.querySelector('.wound-marker'); marker.textContent=value; marker.style.display=value?'flex':'none';
        if(value>=7) {
            const p=el.dataset.owner; state.routed[p]++; record(`${el.dataset.name} routed.`);
            commandTokens=commandTokens.filter(t=>t.unitId!==el.dataset.unitId); el.remove();
            if(state.routed[p]>=Math.ceil(state.starting[p]/2)) {state.winner=other(p);state.stage='finished';record(`${label(state.winner)} wins!`);}
            clearPieceSelection(); renderAllCommandTokens();
        }
    }
    function attack(id) { perform(()=>{
        const el=requireActivation(), a=state.activation, target=find(id), kind=a.freeStrike?'Strike':a.action;
        if(!target) throw Error('Choose an enemy target.');
        if(!['Shoot','Strike'].includes(kind)||a.closed&&!a.freeStrike) throw Error('Choose Shoot or Strike first.');
        const ctx=context(); if(a.freeStrike) ctx.chargeHeight=a.chargeHeight;
        const result=BattleRules.attack(model(el),model(target),kind,ctx);
        pushUndo(); a.closed=true; a.freeStrike=false;
        record(`${el.dataset.name} ${kind.toLowerCase()} → ${target.dataset.name}: ${result.pool} dice (height ${result.height>=0?'+':''}${result.height}, flank ${result.flank>=0?'+':''}${result.flank}), ${result.target}+; rolled ${result.rolls.join(', ')}${result.critical.length?`; critical dice ${result.critical.join(', ')}`:''}: ${result.strain} strain.`);
        renderDiceRoll([...result.rolls,...result.critical]); strain(target,result.strain);
    }); }
    function finish() { perform(()=>{
        requireActivation(); pushUndo(); state.activation=null;
        advanceEmpty();
    }); }
    function advanceEmpty() {
        for(let i=0;i<3 && state.stage==='commands' && !commandTokens.some(t=>t.player===getActivePlayerKey()&&t.status==='tray');i++) pass(true);
    }
    function pass(automatic=false) {
        if(!automatic) { try {requireTurn(); if(state.activation) throw Error('Finish this activation before passing.');} catch(e){return note(e.message);} pushUndo(); }
        roundState=CommandTracker.pass(roundState,getActivePlayerKey());
        if(biddingState.turnStep<2) biddingState.turnStep++;
        else {
            roundState=CommandTracker.next(roundState); biddingState.round=roundState.round; biddingState.revealed=false; biddingState.turnStep=0;
            commandTokens=[]; state.used=[]; state.activation=null; state.stage='bidding'; privateBids={}; revealSent=false;
            for(const p of ['p1','p2']) biddingState[p]={value:1,ready:false};
            record('Clean up: removed all command markers. Begin the next round’s bids.');
        }
        renderAllCommandTokens(); if(!automatic) {advanceEmpty();saveGame();}
    }
    function bid(p,value) { perform(()=>{
        if(state.stage!=='bidding'||!controls(p)||biddingState[p].ready) throw Error('You cannot set that bid now.');
        const n=Number(value), max=counts()[p];
        if(!Number.isInteger(n)||n<1||n>max) throw Error(`Bid a whole number from 1 to ${max}.`);
        privateBids[p]=n; biddingState[p]={value:n,ready:true};
        if(connected()) sendData({type:'GUIDED_BID_READY',player:p,round:biddingState.round});
    }); }
    function reveal() { perform(()=>{
        if(state.stage!=='bidding'||!biddingState.p1.ready||!biddingState.p2.ready) throw Error('Both players must set their bids first.');
        if(connected()) {
            const p=getLocalBidPlayerKey(); revealSent=true;
            sendData({type:'GUIDED_BID_REVEAL',player:p,value:privateBids[p]??biddingState[p].value,round:biddingState.round});
        } else beginRound({p1:privateBids.p1??biddingState.p1.value,p2:privateBids.p2??biddingState.p2.value});
    },false); }
    function beginRound(bids) {
        roundState=CommandTracker.start(roundState||CommandTracker.create({firstDraftPick:biddingState.firstDraftPick}),bids,counts());
        biddingState.revealed=true; biddingState.battleStarted=true; biddingState.master=roundState.master; biddingState.turnStep=0;
        state.stage='commands'; state.used=[]; state.activation=null;
        commandTokens=[];
        for(const p of ['p1','p2']) {biddingState[p]={value:bids[p],ready:true};for(let i=0;i<bids[p];i++) commandTokens.push({id:`cmd-${p}-${i}`,player:p,num:i+1,status:'tray'});}
        record(`Round ${biddingState.round}: bids ${bids.p1} / ${bids.p2}. ${label(roundState.master)} is Master Tactician.`);
        renderAllCommandTokens();
    }
    function incoming(data) {
        ensure();
        if(data.type==='GUIDED_BID_READY') {
            if(state.stage==='bidding'&&data.player===getOpponentPlayerKey()&&data.round===biddingState.round) {biddingState[data.player].ready=true;render();}
            return true;
        }
        if(data.type==='GUIDED_BID_REVEAL') {
            if(state.stage!=='bidding'||data.player!==getOpponentPlayerKey()||data.round!==biddingState.round||!biddingState[getLocalBidPlayerKey()].ready) return true;
            const p=getLocalBidPlayerKey(), own=privateBids[p]??biddingState[p].value;
            if(!revealSent) {revealSent=true;sendData({type:'GUIDED_BID_REVEAL',player:p,value:own,round:biddingState.round});}
            try {beginRound({[p]:own,[data.player]:data.value});saveGame(true);} catch(e){note(e.message);}
            return true;
        }
        // Positions and rules state travel together in committed board snapshots.
        return ['PIECE_DRAG_START','PIECE_DRAG_MOVE','PIECE_DRAG_END','PIECE_ROTATE_START','PIECE_ROTATE','PIECE_ROTATE_END','PASS_TURN','ROUND_RESET','BID_READY','REVEAL_BIDS'].includes(data.type);
    }
    function canDrag(el) {
        ensure();
        if(state.stage==='deploy'&&controls(state.picker)&&el?.dataset.unitId===state.picked) return true;
        return note(state.stage==='commands'?'Use the guided Move and Pivot controls to keep track of allowances.':'Select the required unit and follow the next-step panel.');
    }
    function rotate(el,delta) {
        ensure();
        if(state.stage==='deploy'&&controls(state.picker)&&el?.dataset.unitId===state.picked) {apply(el,{...model(el),angle:model(el).angle+delta});saveGame();}
        else note('Use the Pivot control during an activation. Deployment rotation is only available for the chosen unit.');
    }
    function render() {
        ensure(); const panel=document.getElementById('guided-play'); if(!panel) return;
        panel.replaceChildren();
        const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;panel.appendChild(el);return el;};
        const button=(name,fn,disabled=false,why='')=>{const b=text('button',name);b.type='button';b.className='btn-blue';b.disabled=disabled;b.title=why;b.onclick=fn;return b;};
        const input=(name,value,min,max)=>{const l=text('label',name),i=document.createElement('input');i.type='number';i.value=value;i.min=min;i.max=max;i.step='any';l.appendChild(i);return i;};
        text('h3',state.winner?`${label(state.winner)} wins`:'What to do next');
        if(message) {const e=text('p',message);e.className='guided-error';e.setAttribute('role','alert');}
        const player=state.stage==='commands'?getActivePlayerKey():state.picker;
        if(['pick','terrain','deploy'].includes(state.stage)) {
            text('p',`${label(player)} drafts · ${state.starting.p1+state.starting.p2}/12 units deployed.`);
            if(!controls(player)) text('p','Wait for your opponent. You can select units to inspect their stats and measure distances.');
            if(state.stage==='pick') {
                text('p','Select an undrafted unit, then choose it. You will place or discard the top terrain tile before deploying.');
                button('Choose selected unit',pick,!controls(player)||!selectedPiece?.classList.contains('unit')||Boolean(selectedPiece?.dataset.owner));
            } else if(state.stage==='terrain') {
                const el=find(state.picked); text('p',`Place ${getTerrainCardLabel(terrainDeck[0])} overlapping ${el?.dataset.name}. Drag the top terrain card to a legal position, or use the buttons below.`);
                button('Place over chosen unit',()=>{const m=model(el);placeTerrain(m.x+m.w/2,m.y+m.h/2);},!controls(player));
                button('Discard terrain tile',()=>placeTerrain(0,0,true),!controls(player));
            } else {
                text('p',`Drag ${find(state.picked)?.dataset.name} entirely into ${label(player)}’s ${player==='p1'?'bottom':'top'} 6-inch deployment zone. Rotate freely before confirming.`);
                button('Confirm deployment',deploy,!controls(player));
            }
        } else if(state.stage==='bidding') {
            text('p',`Round ${biddingState.round}. Secretly bid 1–your surviving unit count. Lower bid controls turn order; each bid gives that many commands.`);
            if(!connected()) text('p','Shared device: each player sets their bid privately, then hands over the device.');
            for(const p of ['p1','p2']) {
                if(biddingState[p].ready) text('p',`${label(p)}: bid set (hidden).`);
                else if(controls(p)) { const i=input(`${label(p)} bid (1–${counts()[p]})`,1,1,counts()[p]);button(`Set ${label(p)} bid`,()=>bid(p,i.value)); }
                else text('p',`${label(p)}: waiting for bid.`);
            }
            button('Reveal both bids',reveal,!biddingState.p1.ready||!biddingState.p2.ready);
        } else if(state.stage==='commands') {
            const remaining=commandTokens.filter(t=>t.player===player&&t.status==='tray').length;
            text('p',`Round ${biddingState.round} · ${label(player)} · ${['Master Tactician’s first turn','Other player’s turn','Master Tactician’s final turn'][biddingState.turnStep]}. ${remaining} commands left.`);
            if(!state.activation) {
                text('p','Select one of this player’s unactivated units and activate it, or pass. A unit can activate only once per round.');
                const eligible=selectedPiece?.classList.contains('unit')&&selectedPiece.dataset.owner===player&&!state.used.includes(selectedPiece.dataset.unitId);
                button('Activate selected unit',activate,!controls(player)||!eligible||remaining<1);
                button(biddingState.turnStep===2?'End round and clean up':'Pass turn',()=>pass(),!controls(player));
            } else {
                const el=active(), a=state.activation, m=el&&model(el); if(!m) return;
                text('p',`${el.dataset.name}: ${a.action||'choose one action'} · ${Math.max(0,m.mobility+(a.action==='Extra Pivot'?1:0)-a.pivots)} pivots left · ${a.distance.toFixed(2)}″ moved.`);
                if(!a.action) for(const action of ['Move','Shoot','Strike','Extra Pivot','Rally']) {
                    const contact=BattleRules.enemies(m,context().units).length;
                    const reason=action==='Move'&&contact&&player!==biddingState.master?'Only the Master Tactician can disengage.':action==='Shoot'&&(!m.shoot||contact)?'Shooting requires a Shoot stat and no enemy contact.':action==='Strike'&&!contact?'Strike requires contact.':'';
                    button(action,()=>chooseAction(action),!controls(player)||Boolean(reason),reason);
                }
                const degrees=input('Pivot angle (−90° to 90°)',45,-90,90);
                button('Make pivot',()=>pivot(degrees.value),!controls(player)||a.charged||a.pivots>=m.mobility+(a.action==='Extra Pivot'?1:0)||BattleRules.enemies(m,context().units).length>0);
                if(a.action==='Move'&&!a.closed) {
                    const distance=input('Move distance (inches)',1,0,m.pace);
                    text('p','Move in segments if needed. Forward contact is a charge only if you have not pivoted during this Move.');
                    button('Move forwards',()=>move(distance.value,false),!controls(player)||a.direction==='backwards');
                    button('Move backwards',()=>move(distance.value,true),!controls(player)||a.direction==='forwards');
                    button('Finish Move (then optional pivots)',()=>perform(()=>{requireActivation();a.closed=true;}),!controls(player));
                }
                if(a.freeStrike||(['Shoot','Strike'].includes(a.action)&&!a.closed)) {
                    text('p',a.freeStrike?'Charge complete: choose an enemy for the optional free Strike.':'Choose a legal enemy target. Dice, critical hits and strain resolve automatically.');
                    for(const target of units().filter(u=>u.dataset.owner!==player)) {
                        const reason=a.action==='Shoot'&&!a.freeStrike?BattleRules.shotReason(m,model(target),context().units,context().terrain):!BattleRules.touches(m,model(target))?'Not touching.':'';
                        button(`${target.dataset.name}${reason?` — ${reason}`:''}`,()=>attack(target.dataset.unitId),!controls(player)||Boolean(reason),reason);
                    }
                }
                button('Finish activation',finish,!controls(player));
            }
        }
        if(state.stage==='finished') text('p',`${state.routed[other(state.winner)]} enemy units routed — at least half their starting army. The battle ends immediately.`);
        text('small','Terrain rule: the outlined circular tile is the feature. Forest conceals and slows; hill elevates; mountain conceals and blocks movement; swamp blocks movement; field slows.');
        if(state.log.length) { const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Battle log';details.appendChild(summary);state.log.forEach(line=>{const p=document.createElement('p');p.textContent=line;details.appendChild(p);});panel.appendChild(details); }
        document.getElementById('bidding-turn-panel').hidden=true;
        document.getElementById('draft-notice-banner').style.display='none';
        document.getElementById('terrain-section').style.display=state.stage==='terrain'?'':'none';
        table.classList.add('guided-board');
        units().forEach(u=>{u.classList.toggle('guided-active',u.dataset.unitId===state.activation?.unitId);u.classList.toggle('guided-used',state.used.includes(u.dataset.unitId));u.classList.toggle('guided-picked',u.dataset.unitId===state.picked);u.dataset.armySkin=u.dataset.owner?(u.dataset.owner===state.darkPlayer?'dark':'light'):'undrafted';});
    }
    return {render,ensure,model,context,counts,note,pick,deploy,activate,chooseAction,move,pivot,attack,finish,pass,bid,reveal,placeTerrain,incoming,canDrag,rotate,
        reset(){state=null;privateBids={};revealSent=false;message='';},
        snapshot(){ensure();return JSON.parse(JSON.stringify(state));},
        restore(saved){state=saved?.version===1?saved:null;privateBids={};message='';},
        terrainDrop(pointer,type){if(terrainDeck[0]===type) placeTerrain(pointer.x,pointer.y);},
        terrainAllowed(){ensure();return state.stage==='terrain'&&controls(state.picker);}
    };
})();

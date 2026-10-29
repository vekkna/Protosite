// Run with Playwright on NODE_PATH and a local server at GUIDED_TEST_URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{
   const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
   if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
   fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',r=>r.abort());
 await page.goto(process.env.GUIDED_TEST_URL||`http://127.0.0.1:${server.address().port}`);
 await page.click('#landing-host-btn');
 assert.match(await page.locator('#guided-play').innerText(),/Choose selected unit/);
 // Play every draft pick, check that deployment is rejected until the unit is in its zone.
 for(let i=0;i<12;i++) {
   const draftState=await page.evaluate(()=>GuidedPlay.snapshot());
   assert.equal(draftState.stage,'pick',`Pick ${i}: ${await page.locator('#guided-play').innerText()}; errors: ${errors.join(';')}`);
   await page.evaluate(i=>{const pool=[...table.querySelectorAll('.unit')].filter(u=>!u.dataset.owner);if(i===0) terrainDeck[0]='field';selectPiece(i===0?pool[4]:pool[0]);},i);
   await page.getByRole('button',{name:'Choose selected unit',exact:true}).click();
   if(i===0) {
     await page.evaluate(()=>GuidedPlay.placeTerrain(0,0));assert.equal(await page.evaluate(()=>GuidedPlay.snapshot().stage),'terrain');
     assert.equal(await page.evaluate(()=>terrainDeck.length),12);
     await page.getByRole('button',{name:'Place over chosen unit',exact:true}).click();
     assert.equal(await page.evaluate(()=>table.querySelectorAll('.terrain').length),1);
   } else await page.getByRole('button',{name:'Discard terrain tile',exact:true}).click();
   if(i===0) {await page.getByRole('button',{name:'Confirm deployment',exact:true}).click();assert.match(await page.locator('#guided-play').innerText(),/entire unit inside/);}
   await page.evaluate(()=>{const g=GuidedPlay.snapshot(),el=findPieceById(g.picked),slot=g.starting[g.picker];el.style.left=`${30+slot*145}px`;el.style.top=g.picker==='p1'?'610px':'15px';el.dataset.angle=g.picker==='p1'?'0':'180';el.style.transform=`rotate(${el.dataset.angle}deg)`;});
   await page.getByRole('button',{name:'Confirm deployment',exact:true}).click();
 }
 assert.equal(await page.evaluate(()=>GuidedPlay.snapshot().stage),'bidding');
 assert.deepEqual(await page.evaluate(()=>GuidedPlay.counts()),{p1:6,p2:6});
 await page.getByLabel('Player 1 bid (1–6)').fill('2');
 await page.getByRole('button',{name:'Set Player 1 bid',exact:true}).click();
 const network=await page.evaluate(()=>JSON.parse(getBoardState({forNetwork:true})));
 assert.equal(network.biddingState.p1.value,undefined);assert.equal(network.biddingState.p2.value,undefined);
 await page.getByLabel('Player 2 bid (1–6)').fill('3');
 await page.getByRole('button',{name:'Set Player 2 bid',exact:true}).click();
 await page.getByRole('button',{name:'Reveal both bids',exact:true}).click();
 assert.equal(await page.evaluate(()=>biddingState.master),'p1');
 await page.evaluate(()=>selectPiece([...table.querySelectorAll('.unit')].find(u=>u.dataset.owner==='p1')));
 await page.getByRole('button',{name:'Activate selected unit',exact:true}).click();
 await page.getByRole('button',{name:'Move',exact:true}).click();
 await page.getByLabel('Move distance (inches)').fill('99');
 await page.getByRole('button',{name:'Move forwards',exact:true}).click();
 assert.match(await page.locator('#guided-play').innerText(),/inches left/);
 await page.getByLabel('Move distance (inches)').fill('1');
 await page.getByRole('button',{name:'Move forwards',exact:true}).click();
 assert.equal(await page.evaluate(()=>GuidedPlay.snapshot().activation.distance),1);
 await page.getByRole('button',{name:'Finish activation',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Activate selected unit',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Pass turn',exact:true}).click();
 assert.equal(await page.evaluate(()=>getActivePlayerKey()),'p2');
 await page.getByRole('button',{name:'Pass turn',exact:true}).click();
 await page.getByRole('button',{name:'End round and clean up',exact:true}).click();
 assert.equal(await page.evaluate(()=>biddingState.round),2);
 assert.equal(await page.evaluate(()=>commandTokens.length),0);
 await page.reload();
 await page.waitForFunction(()=>typeof GuidedPlay!=='undefined'&&GuidedPlay.snapshot().stage==='bidding');
 assert.equal(await page.evaluate(()=>biddingState.round),2);
 await page.evaluate(()=>{document.getElementById('landing-screen').style.display='none';document.getElementById('container').style.display='flex';fitTableToScreen();});
 await page.screenshot({path:'tmp/guided-browser.png',fullPage:true});
 // Two real pages exchanging the same messages used by PeerJS, without an external signalling server.
 const peerPage=await browser.newPage();peerPage.on('pageerror',e=>errors.push(e.message));
 await peerPage.route('https://**',r=>r.abort());await peerPage.goto(`http://127.0.0.1:${server.address().port}`);
 const board=await page.evaluate(()=>getBoardState());
 await page.evaluate(()=>{isHost=true;window.testMessages=[];conn={open:true,send:d=>window.testMessages.push(d)};});
 await peerPage.evaluate(board=>{isHost=false;restoreBoardState(board,true);window.testMessages=[];conn={open:true,send:d=>window.testMessages.push(d)};},board);
 async function deliver(from,to) {const messages=await from.evaluate(()=>window.testMessages.splice(0));for(const data of messages) await to.evaluate(d=>handleIncomingData(d),data);return messages;}
 await page.evaluate(()=>GuidedPlay.bid('p1',2));await deliver(page,peerPage);
 await peerPage.evaluate(()=>GuidedPlay.bid('p2',3));await deliver(peerPage,page);
 await page.evaluate(()=>GuidedPlay.reveal());await deliver(page,peerPage);await deliver(peerPage,page);
 assert.equal(await page.evaluate(()=>biddingState.master),'p1');assert.equal(await peerPage.evaluate(()=>biddingState.master),'p1');
 assert.equal(await page.evaluate(()=>GuidedPlay.snapshot().stage),'commands');assert.equal(await peerPage.evaluate(()=>GuidedPlay.snapshot().stage),'commands');
 await peerPage.evaluate(()=>GuidedPlay.pass());
 assert.equal(await peerPage.evaluate(()=>biddingState.turnStep),0,'opponent cannot pass the active player’s turn');
 await page.evaluate(()=>{selectPiece([...table.querySelectorAll('.unit')].find(u=>u.dataset.owner==='p1'));GuidedPlay.activate();});
 await deliver(page,peerPage);
 assert.deepEqual(await peerPage.evaluate(()=>GuidedPlay.snapshot().activation),await page.evaluate(()=>GuidedPlay.snapshot().activation));
 await peerPage.close();
 // Controlled combat fixture: one more rout wins, and no actions are allowed afterwards.
 await page.evaluate(()=>{
   conn=null; const b=JSON.parse(getBoardState());
   b.pieces=b.pieces.filter(p=>p.type==='unit'); const a=b.pieces.find(p=>p.owner==='p1'),v=b.pieces.find(p=>p.owner==='p2');
   for(const p of b.pieces){p.x=30+b.pieces.indexOf(p)*75;p.y=50;}
   a.x=300;a.y=400;a.angle=0;a.stats={Unit:'Test attacker',Melee:4,Speed:6,Drill:2,Def:5,Footprint:'SW'};
   v.x=300;v.y=400-getUnitSizePx({Footprint:'SW'}).height;v.angle=180;v.wounds=6;v.stats={Unit:'Test target',Melee:1,Speed:6,Drill:1,Def:3,Footprint:'SW'};
   b.guided.routed.p2=2;b.guided.activation={unitId:a.unitId,action:'Strike',pivots:0,distance:0,closed:false};
   restoreBoardState(JSON.stringify(b),true);const random=Math.random;Math.random=()=>.999;GuidedPlay.attack(v.unitId);Math.random=random;
 });
 assert.equal(await page.evaluate(()=>GuidedPlay.snapshot().winner),'p1');
 assert.match(await page.locator('#guided-play').innerText(),/Player 1 wins/i);
 const winBoard=await page.evaluate(()=>getBoardState());
 await page.evaluate(()=>{GuidedPlay.pass();GuidedPlay.move(1,false);});
 assert.equal(await page.evaluate(()=>getBoardState()),winBoard);
 assert.deepEqual(errors,[]);
 console.log('PASS: full draft, deployment checks, hidden bids, activations, movement limits, turns, cleanup, reload, two-peer reveal/sync/ownership, routing and victory lock; no browser errors.');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const server=spawn('python',[path.join(__dirname,'server.py'),'--no-browser'],{env:{...process.env,CARD_MAKER_PORT:'8767'},stdio:'pipe'});
process.on('exit',()=>server.kill());
(async()=>{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://unpkg.com/**',route=>route.fulfill({contentType:'text/javascript',body:route.request().url().includes('papaparse')?'window.Papa={parse(url,options){options.complete({data:[]})}};':'window.Peer=class {on(){return this;}destroy(){}};'}));
 await page.route('https://docs.google.com/**',route=>route.abort());
 await page.goto('http://127.0.0.1:8767/');
 await page.getByRole('button',{name:'Host New Game',exact:true}).click();
 if(await page.evaluate(()=>hasBattleStarted()||biddingState.revealed))throw Error('Draft test must run before the first reveal');
 if(!await page.locator('#unit-profile-details').getAttribute('open')&&await page.locator('#unit-profile-details').evaluate(el=>!el.open))throw Error('Draft profiles should start expanded');
 await page.evaluate(()=>{
  const unit=createUnitDOM('Light Cavalry','#666',120,120,0,0,null,false,null);
  unit.id='draft-profile-test-unit';
  document.getElementById('unit-profile-details').open=false;
 });
 await page.locator('#draft-profile-test-unit').hover();
 if(!await page.locator('#unit-profile-details').evaluate(el=>el.open))throw Error('Hover should open the profile during drafting');
 await page.waitForFunction(()=>{const img=document.querySelector('.stats-unit-artwork');return img&&img.complete&&img.naturalWidth>0;});
 if(!await page.locator('.stats-unit-artwork').isVisible())throw Error('Draft hover profile is hidden');
 await page.locator('#draft-profile-test-unit').click();
 await page.mouse.move(0,0);
 if(!await page.locator('#stats-content').innerText().then(text=>text.includes('Light Cavalry')))throw Error('Draft selection should retain the unit profile');
 if(await page.evaluate(()=>hasBattleStarted()||biddingState.revealed))throw Error('Inspecting draft profiles must not reveal bids');
 await page.evaluate(()=>{
  document.getElementById('landing-screen').style.display='none';
  document.getElementById('container').style.display='flex';
  document.querySelector('.battle-extras').open=true;
  updateStatsPanel({dataset:{name:'Light Cavalry',owner:'p2'},_unitStats:{Unit:'Light Cavalry',Speed:'14',Drill:'3',Melee:'4',Ranged:'-',Def:'3',Footprint:'SN'}});
 });
 await page.waitForFunction(()=>{const img=document.querySelector('.stats-unit-artwork');return img&&img.complete&&img.naturalWidth>0;});
 if(await page.locator('.stats-unit-card-image,.stats-view-switch').count())throw Error('Full-card view and selector should be removed');
 if(!await page.locator('.stats-unit-artwork').isVisible())throw Error('Unit artwork is not visible');
 if(!await page.locator('.stats-artwork-emblem').evaluate(el=>el.classList.contains('army-orange')))throw Error('Wrong army colour');
 await page.locator('#stats-panel').screenshot({path:path.join(__dirname,'test-output','protosite-unit-profile.png')});
 await page.locator('#stats-panel').screenshot({path:path.join(__dirname,'test-output','protosite-artwork-profile.png')});
 for(const name of await page.evaluate(()=>Object.keys(UnitArtwork.files))){
  const result=await page.evaluate(async name=>{const response=await fetch('images/'+encodeURIComponent(UnitArtwork.fileFor({Unit:name})));return response.ok;},name);
  if(!result)throw Error('Missing unit artwork: '+name);
 }
 await page.evaluate(()=>updateStatsPanel('Heavy Infantry'));
 await page.waitForFunction(()=>{const img=document.querySelector('.stats-unit-artwork');return img&&img.complete&&img.naturalWidth>0;});
 if(!await page.locator('.stats-artwork-emblem').evaluate(el=>el.classList.contains('army-blue')))throw Error('Unassigned unit should use blue');
 await page.evaluate(()=>localStorage.setItem('unit-profile-view','card'));
 await page.reload();
 await page.getByRole('button',{name:'Host New Game',exact:true}).click();
 await page.evaluate(()=>updateStatsPanel('Heavy Infantry'));
 if(await page.locator('.stats-unit-card-image,.stats-view-switch').count())throw Error('Old saved card preferences must not restore the removed view');
 if(errors.length)throw Error(errors.join('\n'));
 await browser.close();server.kill();console.log('PASS: draft hover and selection; artwork and live stats; full-card view removed; army colours; all 13 unit assets.');
})().catch(e=>{console.error(e);process.exit(1);});

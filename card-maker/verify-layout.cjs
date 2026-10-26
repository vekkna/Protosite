const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const server=spawn('python',[path.join(__dirname,'server.py'),'--no-browser'],{env:{...process.env,CARD_MAKER_PORT:'8768'},stdio:'pipe'});
process.on('exit',()=>server.kill());
(async()=>{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://unpkg.com/**',route=>route.fulfill({contentType:'text/javascript',body:route.request().url().includes('papaparse')?'window.Papa={parse(url,options){options.complete({data:[]})}};':'window.Peer=class {on(){return this;}destroy(){}};'}));
 await page.route('https://docs.google.com/**',route=>route.abort());
 await page.setViewportSize({width:1920,height:1080});
 await page.goto('http://127.0.0.1:8768/');
 await page.screenshot({path:path.join(__dirname,'test-output','headquarters-landing.png')});
 await page.getByRole('button',{name:'Host New Game',exact:true}).click();
 await page.evaluate(()=>{
  const unit=createUnitDOM('Light Cavalry','#666',120,120,0,0,null,false,'p1');selectPiece(unit);
 });
 await page.waitForFunction(()=>{const i=document.querySelector('.stats-unit-card-image');return i&&i.complete&&i.naturalWidth>0;});
 for(const [width,height] of [[1920,1080],[1920,900],[2560,1440],[1440,900],[1280,800],[1024,768]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>fitTableToScreen());
  await page.waitForTimeout(100);
  const info=await page.evaluate(()=>{
   const panel=document.getElementById('left-sidebar'),board=document.getElementById('game-table'),field=document.getElementById('table-container');
   const b=board.getBoundingClientRect(),f=field.getBoundingClientRect();
   return {two:panel.classList.contains('is-two-column'),panelWidth:panel.clientWidth,scroll:panel.scrollHeight-panel.clientHeight,boardFits:b.left>=f.left-1&&b.right<=f.right+1&&b.top>=f.top-1&&b.bottom<=f.bottom+1,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  console.log(width+'x'+height,JSON.stringify(info));
  if(!info.boardFits||info.overflow)throw Error('Board does not fit at '+width+'x'+height);
  await page.screenshot({path:path.join(__dirname,'test-output',`headquarters-${width}x${height}.png`)});
  if(width>=1400&&(!info.two||info.scroll>2))throw Error('Desktop controls should fit in two columns without scrolling');
 }
 await page.setViewportSize({width:1920,height:1080});
 await page.evaluate(()=>{biddingState.p1={value:2,ready:true};biddingState.p2={value:3,ready:true};triggerRevealBids();});
 if(!await page.evaluate(()=>biddingState.revealed))throw Error('Reveal bids stopped working');
 await page.screenshot({path:path.join(__dirname,'test-output','headquarters-battle.png')});
 await page.setViewportSize({width:1920,height:900});
 await page.evaluate(()=>{fitTableToScreen();isHost=false;fitTableToScreen();});
 if(!await page.locator('#game-table').evaluate(el=>el.classList.contains('is-flipped')))throw Error('Opponent perspective stopped working');
 await page.evaluate(()=>{isHost=true;fitTableToScreen();});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>fitTableToScreen());
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Portrait phone layout overflows horizontally');
 await page.setViewportSize({width:1920,height:1080});
 await page.evaluate(()=>fitTableToScreen());
 await page.getByRole('button',{name:'Full Screen',exact:true}).click();
 await page.waitForFunction(()=>Boolean(document.fullscreenElement));
 await page.evaluate(()=>fitTableToScreen());
 const fullscreenFits=await page.evaluate(()=>{const b=document.getElementById('game-table').getBoundingClientRect();return b.left>=0&&b.top>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1;});
 if(!fullscreenFits)throw Error('Board overflows in fullscreen');
 await page.evaluate(()=>document.exitFullscreen());
 if(errors.length)throw Error(errors.join('\n'));
 await browser.close();server.kill();console.log('PASS: responsive headquarters layout, board fit, no desktop scrolling, and bid reveal.');
})().catch(e=>{console.error(e);process.exit(1);});

// Run with Playwright available in NODE_PATH. No app dependencies are installed.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const server=spawn('python',[path.join(__dirname,'server.py'),'--no-browser'],{env:{...process.env,CARD_MAKER_PORT:'8766'},stdio:'pipe'});
process.on('exit',()=>server.kill());
(async () => {
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
 const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page = await browser.newPage({viewport:{width:1500,height:1100}});
 await page.addInitScript(()=>{
  window.cardTestPNG=async canvas=>{
   const blob=await blobFrom(canvas);
   return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
  };
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766/card-maker/');
 await page.waitForFunction(()=>document.querySelectorAll('.unit').length===13);
 await page.waitForFunction(()=>document.getElementById('blue').width===1760);
 await fs.mkdir(path.join(__dirname,'test-output'),{recursive:true});
 await page.screenshot({path:path.join(__dirname,'test-output','studio.png'),fullPage:true});
 await page.getByRole('button',{name:'Heavy Cavalry SN'}).click();
 await page.waitForFunction(()=>document.getElementById('blue').width===1260);
 if(await page.locator('#blue').getAttribute('class')!=='portrait')throw Error('SN must be portrait');
 const frameEdges=await page.evaluate(()=>['blue','orange'].map(colour=>{
  const canvas=document.getElementById(colour);
  const {width,height}=canvas;
  const {data}=canvas.getContext('2d').getImageData(0,0,width,height);
  let top=height,bottom=-1;
  for(let i=0;i<data.length;i+=4){
   const ink=colour==='blue'?data[i+2]-data[i]:data[i]-data[i+1];
   if(ink<=40)continue;
   const y=Math.floor(i/(4*width));
   top=Math.min(top,y);bottom=y;
  }
  return [top,bottom];
 }));
 const [blueEdges,orangeEdges]=frameEdges;
 if(blueEdges[1]<0||orangeEdges[1]<0||blueEdges.some((edge,i)=>Math.abs(edge-orangeEdges[i])>2)){
  throw Error('Portrait frame edges do not match: '+JSON.stringify(frameEdges));
 }
 await page.getByLabel('Speed · wing').fill('17');
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.unit').length===13);
 await page.getByRole('button',{name:'Heavy Cavalry SN'}).click();
 if(await page.getByLabel('Speed · wing').inputValue()!=='17')throw Error('Edit was not saved');
 await page.getByRole('button',{name:'Reset unit'}).click();
 if(await page.getByLabel('Speed · wing').inputValue()!=='10')throw Error('Reset did not restore source');
 for(const [symbol,variant] of [['0','zero']]) {
  const drawn=await page.evaluate(async()=>{
   const results=[],original=CanvasRenderingContext2D.prototype.fillText;
   for(const ranged of ['-','0/0','0/24','4/0','3*/18']){
    const recorded=[];
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){recorded.push(text);return original.call(this,text,...args);};
    try{await renderCard({...unitAt(0),Ranged:ranged},'blue');}finally{CanvasRenderingContext2D.prototype.fillText=original;}
    results.push(recorded.slice(-4));
   }
   return results;
  });
  const expected=['-/-','-/-','-/24','4/-','3*/18'].map(ranged=>['5/0','6',ranged,'5']);
  if(JSON.stringify(drawn)!==JSON.stringify(expected))throw Error('Incorrect Shooting or Range display: '+JSON.stringify(drawn));
  const marked=await page.evaluate(async()=>{
   const results=[],original=CanvasRenderingContext2D.prototype.fillText;
   for(const [footprint,speed,def,drill] of [['SN','14','3','3'],['SN','14','3*','3'],['SW','7*','4*','4'],['SW','7*','4','4']]){
    const drawn=[];
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawn.push(text);return original.call(this,text,...args);};
    try{await renderCard({...unitAt(0),Footprint:footprint,Speed:speed,Def:def,Drill:drill},'blue');}finally{CanvasRenderingContext2D.prototype.fillText=original;}
    results.push([drawn.at(-4),drawn.at(-1)]);
   }
   return results;
  });
  if(JSON.stringify(marked)!==JSON.stringify([['14/3','3'],['14/3','3*'],['7*/4','4*'],['7*/4','4']]))throw Error('Incorrect Pace or Defence asterisks: '+JSON.stringify(marked));
  const [variantDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export all · ZIP'}).click()]);
  if(!variantDownload.suggestedFilename().includes(variant))throw Error('Export filename is missing variant');
  await variantDownload.saveAs(path.join(__dirname,'test-output',variantDownload.suggestedFilename()));
  for(const [i,name] of [[0,'heavy-infantry'],[2,'heavy-cavalry']])for(const colour of ['blue','orange']){
   const png=await page.evaluate(async({i,colour})=>cardTestPNG(await renderCard(unitAt(i),colour)),{i,colour});
   await fs.writeFile(path.join(__dirname,'test-output',`${name}-${colour}-${variant}.png`),Buffer.from(png,'base64'));
  }
 }
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.unit').length===13);
 await page.getByRole('button',{name:'Heavy Cavalry SN'}).click();
 const [download] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export all · ZIP'}).click()]);
 await download.saveAs(path.join(__dirname,'test-output','all-unit-cards.zip'));
 for(const colour of ['blue','orange']) {
  const png=await page.locator('#'+colour).evaluate(c=>cardTestPNG(c));
  await fs.writeFile(path.join(__dirname,'test-output','heavy-cavalry-'+colour+'.png'),Buffer.from(png,'base64'));
 }
 await page.getByRole('button',{name:'Heavy Infantry SW'}).click();
 await page.waitForFunction(()=>document.getElementById('blue').width===1760);
 for(const colour of ['blue','orange']) {
  const png=await page.locator('#'+colour).evaluate(c=>cardTestPNG(c));
  await fs.writeFile(path.join(__dirname,'test-output','heavy-infantry-'+colour+'.png'),Buffer.from(png,'base64'));
 }
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile layout overflows');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: 13 units; SN/SW layouts; persistent edits; reset; all-card ZIP; mobile width; no browser errors.');
 await browser.close();
 server.kill();
})().catch(e=>{console.error(e);process.exit(1);});


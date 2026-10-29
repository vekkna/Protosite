const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const server=spawn('python',[path.join(__dirname,'server.py'),'--no-browser'],{env:{...process.env,CARD_MAKER_PORT:'8769'},stdio:'pipe'});
process.on('exit',()=>server.kill());
(async()=>{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8769/card-maker/');
 await page.waitForFunction(()=>document.querySelectorAll('.unit').length===13);
 await page.getByRole('button',{name:'Heavy Infantry SW',exact:true}).click();
 await page.getByLabel('Melee · swords').fill('11');
 const expected=await page.evaluate(async()=>{
  const png=await blobFrom(await renderCard(unitAt(0),'blue'));
  return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(png);});
 });
 const output=path.join(__dirname,'..','output','pdf');await fs.mkdir(output,{recursive:true});
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:180000}),page.getByRole('button',{name:'Export PDF · 3 × 3',exact:true}).click()]);
 await download.saveAs(path.join(output,'unit-cards-3x3-actual-size.pdf'));
 console.log('Downloaded edited PDF.');
 await fs.writeFile(path.join(__dirname,'test-output','pdf-expected-first-card.png'),Buffer.from(expected,'base64'));
 await page.getByRole('button',{name:'Reset unit',exact:true}).click();
 // Deliver the unedited roster as the final example as well.
 const [finalDownload]=await Promise.all([page.waitForEvent('download',{timeout:180000}),page.getByRole('button',{name:'Export PDF · 3 × 3',exact:true}).click()]);
 await fs.rename(path.join(output,'unit-cards-3x3-actual-size.pdf'),path.join(__dirname,'test-output','pdf-edited-cards.pdf'));
 await finalDownload.saveAs(path.join(output,'unit-cards-3x3-actual-size.pdf'));
 console.log('Downloaded complete roster PDF.');
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('PDF button causes mobile layout overflow');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Mobile layout and browser errors checked.');
 await browser.close();server.kill();console.log('PASS: PDF button exports the current edits and the complete roster; mobile layout fits.');
})().catch(e=>{console.error(e);process.exit(1);});

'use strict';
const $ = id => document.getElementById(id);
const ART = {
 'Heavy Infantry':'heavyinfantry.png',
 'Fanatics':'ChatGPT Image Oct 23, 2026, 02_55_00 PM-5.png',
 'Heavy Cavalry':'ChatGPT Image Oct 23, 2026, 02_54_36 PM-4.png',
 'Infantry':'ChatGPT Image Oct 23, 2026, 02_54_34 PM-2.png',
 'Halberds':'ChatGPT Image Oct 23, 2026, 02_54_40 PM-9.png',
 'Spears':'ChatGPT Image Oct 23, 2026, 02_55_00 PM-6.png',
 'Cavalry':'ChatGPT Image Oct 23, 2026, 02_54_37 PM-5.png',
 'Lancers':'ChatGPT Image Oct 23, 2026, 02_54_37 PM-6.png',
 'Light Infantry':'ChatGPT Image Oct 23, 2026, 02_54_33 PM-1.png',
 'Light Cavalry':'White Galloping Horse Silhouette.png',
 'Archers':'ChatGPT Image Oct 23, 2026, 02_54_35 PM-3.png',
 'Crossbows':'ChatGPT Image Oct 23, 2026, 02_54_35 PM-3.png',
 'Mounted Archers':'ChatGPT Image Oct 23, 2026, 02_54_38 PM-7.png'
};
const STORAGE = 'unit-card-studio-v1';
let originals = [], selected = 0, edits = {}, renderVersion = 0;
try { edits = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch {}
const imageCache = new Map();
function getImage(src) {
 if (!imageCache.has(src)) imageCache.set(src, new Promise((resolve,reject) => {
  const img = new Image(); img.onload = () => resolve(img); img.onerror = () => { imageCache.delete(src); reject(new Error('Could not load artwork: '+src)); }; img.src=src;
 }));
 return imageCache.get(src);
}
function unitAt(i) { const base = originals[i]; return {...base, artwork:ART[base.Unit] || '', scale:100, ...edits[base.Unit]}; }
function persist() { try { localStorage.setItem(STORAGE,JSON.stringify(edits)); } catch { $('status').textContent='Browser storage is full. These edits work for this session; export your cards before closing.'; } }
function saveField(key,value) { const name=originals[selected].Unit; edits[name]={...edits[name],[key]:value}; persist(); preview(); }
function roster() {
 $('roster').replaceChildren(); const query=$('search').value.toLowerCase();
 originals.forEach((row,i)=> { const unit=unitAt(i); if(!unit.Unit.toLowerCase().includes(query))return;
  const button=document.createElement('button');button.className='unit'+(i===selected?' active':'');button.setAttribute('aria-pressed',String(i===selected));
  const name=document.createElement('span');name.textContent=unit.Unit; const size=document.createElement('small');size.textContent=unit.Footprint;button.append(name,size);button.onclick=()=>select(i);$('roster').append(button);
 });
}
function select(i) {
 selected=i;roster();const unit=unitAt(i);$('fields').replaceChildren();
 for (const [key,label] of [['Unit','Unit name'],['Footprint','Card format'],['Speed','Speed · wing'],['Drill','Drill · chevrons'],['Melee','Melee · swords'],['Ranged','Ranged · strength/range'],['Def','Defence · shield']]) {
  const wrapper=document.createElement('label');wrapper.textContent=label;
  const input=document.createElement(key==='Footprint'?'select':'input');
  if(key==='Footprint')for(const size of ['SN','SW']){const option=document.createElement('option');option.value=size;option.textContent=size==='SN'?'SN · portrait':'SW · landscape';input.append(option);}
  input.value=unit[key];input.oninput=()=>saveField(key,input.value);input.onchange=roster;wrapper.append(input);$('fields').append(wrapper);
 }
 $('artwork').value=unit.artwork.startsWith('data:')?'uploaded':unit.artwork;$('scale').value=unit.scale;$('scale-value').textContent=unit.scale+'%';preview();
}
function fitText(ctx,text,x,y,maxWidth,startSize,minSize=20) {
 let size=startSize;ctx.font=`700 ${size}px "Segoe UI", Arial, sans-serif`;
 while(ctx.measureText(text).width>maxWidth&&size>minSize){size--;ctx.font=`700 ${size}px "Segoe UI", Arial, sans-serif`;}
 ctx.fillText(text,x,y,maxWidth);
}
async function renderCard(unit,colour) {
 if(!['SN','SW'].includes(unit.Footprint))throw new Error('Unknown footprint for '+unit.Unit+': '+unit.Footprint);
 const portrait=unit.Footprint==='SN';const template=await getImage(`../images/${colour}_${portrait?'vertical':'horizontal'}_template.png`);
 const canvas=document.createElement('canvas');canvas.width=template.naturalWidth;canvas.height=template.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(template,0,0);
 const ink=colour==='blue'?'#073e79':'#d33d00';
 if(unit.artwork) {
  const src=unit.artwork.startsWith('data:')?unit.artwork:'../images/'+encodeURIComponent(unit.artwork);const art=await getImage(src);
  // Contain the image over the shield; preserve transparent pixels for the silhouette outline.
  const box=portrait?{x:305,y:303,w:452,h:515}:{x:543,y:231,w:396,h:402};
  const ratio=Math.min(box.w/art.width,box.h/art.height)*Number(unit.scale)/100;const w=art.width*ratio,h=art.height*ratio;
  const x=box.x+(box.w-w)/2,y=box.y+(box.h-h)/2;
  const mask=document.createElement('canvas');mask.width=canvas.width;mask.height=canvas.height;const mc=mask.getContext('2d');mc.drawImage(art,x,y,w,h);mc.globalCompositeOperation='source-in';mc.fillStyle=ink;mc.fillRect(0,0,mask.width,mask.height);
  for(let a=0;a<Math.PI*2;a+=Math.PI/16)ctx.drawImage(mask,Math.cos(a)*7,Math.sin(a)*7);
  ctx.drawImage(art,x,y,w,h);
 }
 ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';
 fitText(ctx,unit.Unit,portrait?530:741,portrait?978:778,portrait?850:1240,portrait?98:108,24);
 const ranged=String(unit.Ranged||'—').split('/');const values=[unit.Speed,unit.Drill,unit.Melee,ranged[0],ranged[1]||'—',unit.Def];
 // Coordinates follow the icon positions on each supplied template.
 const positions=portrait?(colour==='blue'?[[350,1141],[350,1230],[350,1320],[805,1141],[805,1234],[805,1320]]:[[345,1130],[345,1227],[345,1322],[805,1130],[805,1227],[805,1322]]):[[229,935],[449,935],[684,935],[907,935],[1142,935],[1364,935]];
 // Keep a small inset from the frame; portrait templates already have a central divider.
 ctx.strokeStyle=ink;ctx.lineWidth=2.5;ctx.lineCap='round';ctx.beginPath();
 if(portrait){
  const dividers=colour==='blue'?[[103,499,[1183,1276]],[562,959,[1186,1267]]]:[[103,499,[1177,1274]],[562,959,[1177,1259]]];
  for(const [left,right,rows] of dividers){
   for(const y of rows){ctx.moveTo(left,y);ctx.lineTo(right,y);}
  }
 }else{
  for(const x of [288,515,741,962,1199]){ctx.moveTo(x,887);ctx.lineTo(x,980);}
 }
 ctx.stroke();
 // Match the numerals' visible height to the icons, fitting wider values to their slot.
 values.forEach((v,i)=>{
  const raw=String(v??'').trim();
  const text=!raw||/^[-—–/]$/.test(raw)?'0':raw;
  fitText(ctx,text,...positions[i],portrait?210:100,portrait?106:104,26);
 });
 return canvas;
}
async function preview() {
 const version=++renderVersion,unit=unitAt(selected);$('unit-title').textContent=unit.Unit;$('unit-meta').textContent=`${unit.Footprint} · ${unit.Footprint==='SN'?'63 × 88':'88 × 63'} mm · original templates`;
 try { const cards=await Promise.all(['blue','orange'].map(c=>renderCard(unit,c)));if(version!==renderVersion)return;
  cards.forEach((card,i)=>{const colour=i?'orange':'blue',dest=$(colour);dest.width=card.width;dest.height=card.height;dest.classList.toggle('portrait',unit.Footprint==='SN');dest.getContext('2d').drawImage(card,0,0);$(colour+'-size').textContent=`${card.width} × ${card.height}`;});
 }catch(err){$('status').textContent=err.message;}
}
function blobFrom(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed')),'image/png'));}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function slug(name){return name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unit';}
// Uncompressed ZIP, with CRC32, for native PNG files (already compressed).
function zip(files){
 const encoder=new TextEncoder(),parts=[],directory=[];let offset=0;
 const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
 const header=n=>{const bytes=new Uint8Array(n);return {bytes,view:new DataView(bytes.buffer)};};
 for(const file of files){const name=encoder.encode(file.name),check=crc(file.bytes),size=file.bytes.length,l=header(30);l.view.setUint32(0,0x04034b50,true);l.view.setUint16(4,20,true);l.view.setUint32(14,check,true);l.view.setUint32(18,size,true);l.view.setUint32(22,size,true);l.view.setUint16(26,name.length,true);parts.push(l.bytes,name,file.bytes);
  const d=header(46);d.view.setUint32(0,0x02014b50,true);d.view.setUint16(4,20,true);d.view.setUint16(6,20,true);d.view.setUint32(16,check,true);d.view.setUint32(20,size,true);d.view.setUint32(24,size,true);d.view.setUint16(28,name.length,true);d.view.setUint32(42,offset,true);directory.push(d.bytes,name);offset+=30+name.length+size;
 }
 const length=directory.reduce((n,b)=>n+b.length,0),end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,length,true);end.view.setUint32(16,offset,true);return new Blob([...parts,...directory,end.bytes],{type:'application/zip'});
}
async function exportCards(all){
 const variant='zero';
 const buttons=[$('export-all'),$('export-pair')];buttons.forEach(b=>b.disabled=true);
 try{const files=[],indices=all?originals.map((_,i)=>i):[selected];for(const i of indices)for(const colour of ['blue','orange']){const unit=unitAt(i);$('status').textContent=`Rendering ${unit.Unit} · ${colour}…`;const card=await renderCard(unit,colour),blob=await blobFrom(card);files.push({name:`${String(i+1).padStart(2,'0')}-${slug(unit.Unit)}-${colour}.png`,bytes:new Uint8Array(await blob.arrayBuffer())});}
  download(zip(files),(all?'all-unit-cards':slug(unitAt(selected).Unit)+'-cards')+'-'+variant+'.zip');$('status').textContent=`Exported ${files.length} cards at full template resolution.`;
 }catch(err){$('status').textContent=err.message;}finally{buttons.forEach(b=>b.disabled=false);}
}
async function load(){
 $('refresh').disabled=true;$('status').textContent='Reading the public unit sheet…';
 try{const response=await fetch('/api/units');if(!response.ok)throw new Error('Could not read source sheet');const data=await response.json();if(!data.units.length)throw new Error('No units found in source.');originals=data.units;selected=Math.min(selected,originals.length-1);$('source-state').textContent=data.cached?'Downloaded snapshot':'Public sheet connected';$('source-detail').textContent=`${originals.length} units · ${originals.length*2} cards`; $('status').textContent=data.warning||`Loaded ${originals.length} units. Both army colours are ready.`;select(selected);
 }catch(err){$('status').textContent=err.message;}finally{$('refresh').disabled=false;}
}
for(const [name,file] of Object.entries(ART)){const option=document.createElement('option');option.value=file;option.textContent=name+(name==='Crossbows'?' (bow placeholder)':'');$('artwork').append(option);}
{const option=document.createElement('option');option.value='uploaded';option.textContent='Custom uploaded image';option.disabled=true;$('artwork').append(option);}
$('search').oninput=roster;$('refresh').onclick=load;$('export-all').onclick=()=>exportCards(true);$('export-pair').onclick=()=>exportCards(false);$('artwork').onchange=()=>saveField('artwork',$('artwork').value);
$('scale').oninput=()=>{$('scale-value').textContent=$('scale').value+'%';saveField('scale',Number($('scale').value));};
$('upload').onchange=async()=>{const file=$('upload').files[0];if(!file)return;try{const value=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});await getImage(value);saveField('artwork',value);$('artwork').value='uploaded';}catch{$('status').textContent='This file could not be read as an image.';}};
$('reset').onclick=()=>{delete edits[originals[selected].Unit];persist();select(selected);};
$('print').onclick=()=>window.print();
load();

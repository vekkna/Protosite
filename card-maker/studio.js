'use strict';
const $ = id => document.getElementById(id);
const ART = UnitArtwork.files;
const STORAGE = 'unit-card-studio-v1';
let originals = [], selected = 0, edits = {}, renderVersion = 0;
let previewFrame = null;
try { edits = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch {}
const imageCache = new Map();
const statIconCache = new Map();
async function getStatIcon(src,ink) {
 const key=src+ink;
 if(!statIconCache.has(key))statIconCache.set(key,(async()=>{
  const image=await getImage(src);
  const source=document.createElement('canvas');source.width=image.width;source.height=image.height;
  const sc=source.getContext('2d');sc.drawImage(image,0,0);
  const pixels=sc.getImageData(0,0,source.width,source.height).data;
  let left=source.width,top=source.height,right=-1,bottom=-1;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(pixels[(y*source.width+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left)throw new Error('Empty stat icon: '+src);
  const icon=document.createElement('canvas');icon.width=right-left+1;icon.height=bottom-top+1;
  const ctx=icon.getContext('2d');ctx.drawImage(source,left,top,icon.width,icon.height,0,0,icon.width,icon.height);
  ctx.globalCompositeOperation='source-in';ctx.fillStyle=ink;ctx.fillRect(0,0,icon.width,icon.height);
  return icon;
 })());
 return statIconCache.get(key);
}
function getImage(src) {
 if (!imageCache.has(src)) imageCache.set(src, new Promise((resolve,reject) => {
  const img = new Image(); img.onload = () => resolve(img); img.onerror = () => { imageCache.delete(src); reject(new Error('Could not load artwork: '+src)); }; img.src=src;
 }));
 return imageCache.get(src);
}
function unitAt(i) { const base = originals[i]; return {...base, artwork:UnitArtwork.fileFor(base), scale:100, ...edits[base.Unit]}; }
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
 for (const [key,label] of [['Unit','Unit name'],['Footprint','Card format'],['Speed','Speed · wing'],['Drill','Drill · after move'],['Melee','Melee · swords'],['Ranged','Ranged · strength/range'],['Def','Defence · shield']]) {
  const wrapper=document.createElement('label');wrapper.textContent=label;
  const input=document.createElement(key==='Footprint'?'select':'input');
  if(key==='Footprint')for(const size of ['SN','SW']){const option=document.createElement('option');option.value=size;option.textContent=size==='SN'?'SN · portrait':'SW · landscape';input.append(option);}
  input.value=unit[key];input.oninput=()=>saveField(key,input.value);input.onchange=roster;wrapper.append(input);$('fields').append(wrapper);
 }
 if(unit.artwork&&!unit.artwork.startsWith('data:')&&![...$('artwork').options].some(option=>option.value===unit.artwork)){
  const option=document.createElement('option');option.value=unit.artwork;option.textContent='From sheet: '+unit.artwork;$('artwork').append(option);
 }
 $('artwork').value=unit.artwork.startsWith('data:')?'uploaded':unit.artwork;$('scale').value=unit.scale;$('scale-value').textContent=unit.scale+'%';preview();
}
function fitText(ctx,text,x,y,maxWidth,startSize,minSize=20) {
 let size=startSize;ctx.font=`700 ${size}px "Segoe UI", Arial, sans-serif`;
 while(ctx.measureText(text).width>maxWidth&&size>minSize){size--;ctx.font=`700 ${size}px "Segoe UI", Arial, sans-serif`;}
 ctx.fillText(text,x,y,maxWidth);
}
async function renderCard(unit,colour,version) {
 if(!['SN','SW'].includes(unit.Footprint))throw new Error('Unknown footprint for '+unit.Unit+': '+unit.Footprint);
 const portrait=unit.Footprint==='SN';
 const ink=colour==='blue'?'#073e79':'#d33d00';
 const src=unit.artwork?.startsWith('data:')?unit.artwork:'../images/'+encodeURIComponent(unit.artwork);
 const iconSources=['../images/move-icon.png','../images/strike-icon.png','../icons/shoot.svg','../images/defence-icon.png'];
 const [template,art,icons]=await Promise.all([
  getImage(`assets/templates/${colour}_${portrait?'vertical':'horizontal'}_template.png`),
  unit.artwork ? getImage(src) : null,
  Promise.all(iconSources.map(file=>getStatIcon(file,ink)))
 ]);
 if(version!==undefined && version!==renderVersion)return null;
 const canvas=document.createElement('canvas');canvas.width=portrait?1260:1760;canvas.height=portrait?1760:1260;
 const designWidth=portrait?1061:1482,designHeight=portrait?1482:1061;
 const ctx=canvas.getContext('2d');
 let heightScale=canvas.height/designHeight;
 if(portrait&&colour==='blue'){
  // Match the visible blue frame to the orange frame in the 1760 px templates.
  const blueTop=11,blueBottom=1684,orangeTop=13,orangeBottom=1741;
  const frameScale=(orangeBottom-orangeTop)/(blueBottom-blueTop);
  ctx.translate(0,orangeTop-blueTop*frameScale);
  heightScale*=frameScale;
 }
 ctx.scale(canvas.width/designWidth,heightScale);
 ctx.drawImage(template,0,0,designWidth,designHeight);
 if(art) {
  // Contain the image over the shield; preserve transparent pixels for the silhouette outline.
  const box=portrait?{x:305,y:303,w:452,h:515}:{x:543,y:231,w:396,h:402};
  const ratio=Math.min(box.w/art.width,box.h/art.height)*Number(unit.scale)/100;const w=art.width*ratio,h=art.height*ratio;
  const x=box.x+(box.w-w)/2,y=box.y+(box.h-h)/2+UnitArtwork.offsetY(unit);
  // Keep the original pixel grid and a transparent border for interpolation at the edges.
  const left=Math.floor(x)-2,top=Math.floor(y)-2;
  const mask=document.createElement('canvas');
  mask.width=Math.ceil(x+w)-left+2;
  mask.height=Math.ceil(y+h)-top+2;
  const mc=mask.getContext('2d');
  mc.drawImage(art,x-left,y-top,w,h);
  mc.globalCompositeOperation='source-in';mc.fillStyle=ink;mc.fillRect(0,0,mask.width,mask.height);
  for(let a=0;a<Math.PI*2;a+=Math.PI/16)ctx.drawImage(mask,left+Math.cos(a)*7,top+Math.sin(a)*7);
  ctx.drawImage(art,x,y,w,h);
 }
 ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';
 fitText(ctx,unit.Unit,portrait?530:741,portrait?(colour==='blue'?950:990):778,portrait?850:1240,portrait?112:128,24);
 const stat=v=>{const raw=String(v??'').trim();return !raw||/^[-—–/]$/.test(raw)?'0':raw;};
 const rangedStat=v=>{const value=stat(v);return value==='0'?'-':value;};
 const [shoot,range]=String(unit.Ranged||'').split('/');
 const values=[`${stat(unit.Speed)}/${stat(unit.Drill)}`,stat(unit.Melee),`${rangedStat(shoot)}/${rangedStat(range)}`,stat(unit.Def)];
 // Equal cells and a fixed gap from the visible icon edge to left-aligned text.
 const bounds=portrait?(colour==='blue'?{left:92,right:968,top:1032,bottom:1327}:{left:96,right:964,top:1077,bottom:1372}):{left:78,right:1404,top:880,bottom:989};
 const columns=portrait?2:4,rows=portrait?2:1;
 const cellWidth=(bounds.right-bounds.left)/columns,cellHeight=(bounds.bottom-bounds.top)/rows;
 ctx.strokeStyle=ink;ctx.lineWidth=2.5;ctx.lineCap='round';ctx.beginPath();
 if(!portrait){
  for(let col=1;col<columns;col++){const x=bounds.left+col*cellWidth;ctx.moveTo(x,bounds.top+8);ctx.lineTo(x,bounds.bottom-8);}
 }
 ctx.stroke();
 ctx.textAlign='left';
 values.forEach((v,i)=>{
  const col=portrait?i%2:i,row=portrait?Math.floor(i/2):0;
  const left=bounds.left+col*cellWidth,cy=bounds.top+(row+.5)*cellHeight;
  const gap=portrait?24:18,iconWidth=88,iconHeight=portrait?76:86;
  const icon=icons[i];
  const scale=Math.min(iconWidth/icon.width,iconHeight/icon.height),w=icon.width*scale,h=icon.height*scale;
  const raw=String(v??'').trim();
  const text=!raw||/^[-—–/]$/.test(raw)?'0':raw;
  // Align the actual glyph edge (including the bearing of characters such as 1).
  const maxWidth=cellWidth-24-w-gap;
  let fontSize=portrait?106:104;ctx.font=`700 ${fontSize}px "Segoe UI", Arial, sans-serif`;
  while(ctx.measureText(text).width>maxWidth&&fontSize>26){fontSize--;ctx.font=`700 ${fontSize}px "Segoe UI", Arial, sans-serif`;}
  const metrics=ctx.measureText(text);
  const textWidth=(metrics.actualBoundingBoxLeft||0)+metrics.actualBoundingBoxRight;
  const alignedIconRight=left+(cellWidth-(w+gap+textWidth))/2+w;
  const x=alignedIconRight+gap;
  ctx.drawImage(icon,alignedIconRight-w,cy-h/2,w,h);
  ctx.fillText(text,x+(metrics.actualBoundingBoxLeft||0),cy+(metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2);
 });
 return canvas;
}
function preview() {
 renderVersion++;
 if(previewFrame!==null)return;
 previewFrame=requestAnimationFrame(drawPreview);
}
async function drawPreview() {
 previewFrame=null;
 const version=renderVersion,unit=unitAt(selected);$('unit-title').textContent=unit.Unit;$('unit-meta').textContent=`${unit.Footprint} · ${unit.Footprint==='SN'?'63 × 88':'88 × 63'} mm · 508 dpi`;
 try { const cards=await Promise.all(['blue','orange'].map(c=>renderCard(unit,c,version)));if(version!==renderVersion)return;
  cards.forEach((card,i)=>{const colour=i?'orange':'blue',dest=$(colour);dest.width=card.width;dest.height=card.height;dest.classList.toggle('portrait',unit.Footprint==='SN');dest.getContext('2d').drawImage(card,0,0);$(colour+'-size').textContent=`${card.width} × ${card.height}`;});
 }catch(err){if(version===renderVersion)$('status').textContent=err.message;}
}
const crcTable=Uint32Array.from({length:256},(_,value)=>{
 for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);
 return value;
});
function crc32(bytes){
 let crc=0xffffffff;
 for(let i=0;i<bytes.length;i++)crc=(crc>>>8)^crcTable[(crc^bytes[i])&255];
 return (crc^0xffffffff)>>>0;
}
async function blobFrom(canvas){
 const png=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed')),'image/png'));
 const bytes=new Uint8Array(await png.arrayBuffer()),parts=[png.slice(0,8)];
 // PNG pHYs: exactly 20,000 pixels/metre (508 dpi), or 20 pixels/mm.
 const physical=new Uint8Array(21),view=new DataView(physical.buffer);view.setUint32(0,9);physical.set([112,72,89,115],4);view.setUint32(8,20000);view.setUint32(12,20000);physical[16]=1;view.setUint32(17,crc32(physical.slice(4,17)));
 let offset=8;
 const chunks=new DataView(bytes.buffer);
 while(offset<bytes.length){
  const end=offset+12+chunks.getUint32(offset);
  const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(type!=='pHYs')parts.push(png.slice(offset,end));
  if(type==='IHDR')parts.push(physical);
  offset=end;
 }
 return new Blob(parts,{type:'image/png'});
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function slug(name){return name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unit';}
// Uncompressed ZIP, with CRC32, for native PNG files (already compressed).
function zip(files){
 const encoder=new TextEncoder(),parts=[],directory=[];let offset=0;
 const header=n=>{const bytes=new Uint8Array(n);return {bytes,view:new DataView(bytes.buffer)};};
 for(const file of files){const name=encoder.encode(file.name),check=crc32(file.bytes),size=file.bytes.length,l=header(30);l.view.setUint32(0,0x04034b50,true);l.view.setUint16(4,20,true);l.view.setUint32(14,check,true);l.view.setUint32(18,size,true);l.view.setUint32(22,size,true);l.view.setUint16(26,name.length,true);parts.push(l.bytes,name,file.bytes);
  const d=header(46);d.view.setUint32(0,0x02014b50,true);d.view.setUint16(4,20,true);d.view.setUint16(6,20,true);d.view.setUint32(16,check,true);d.view.setUint32(20,size,true);d.view.setUint32(24,size,true);d.view.setUint16(28,name.length,true);d.view.setUint32(42,offset,true);directory.push(d.bytes,name);offset+=30+name.length+size;
 }
 const length=directory.reduce((n,b)=>n+b.length,0),end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,length,true);end.view.setUint32(16,offset,true);return new Blob([...parts,...directory,end.bytes],{type:'application/zip'});
}
async function exportCards(all,format='zip'){
 const variant='zero';
 const buttons=[$('export-all'),$('export-pair'),$('export-pdf')];buttons.forEach(b=>b.disabled=true);
 try{const files=[],indices=all?originals.map((_,i)=>i):[selected];for(const i of indices)for(const colour of ['blue','orange']){const unit=unitAt(i);$('status').textContent=`Rendering ${unit.Unit} · ${colour}…`;const card=await renderCard(unit,colour),blob=await blobFrom(card);files.push({name:`${String(i+1).padStart(2,'0')}-${slug(unit.Unit)}-${colour}.png`,bytes:new Uint8Array(await blob.arrayBuffer())});}
  const archive=zip(files);
  if(format==='pdf'){
   $('status').textContent='Laying out actual-size cards in a 3 × 3 grid…';
   const response=await fetch('/api/export-pdf',{method:'POST',headers:{'Content-Type':'application/zip'},body:archive});
   if(!response.ok){const error=await response.json();throw new Error(error.error||'PDF export failed');}
   download(await response.blob(),'unit-cards-3x3-actual-size.pdf');
   $('status').textContent=`Exported ${files.length} cards to A4 PDF. Print at Actual size / 100%, with automatic page orientation.`;
  }else{
   download(archive,(all?'all-unit-cards':slug(unitAt(selected).Unit)+'-cards')+'-'+variant+'.zip');$('status').textContent=`Exported ${files.length} cards at full template resolution.`;
  }
 }catch(err){$('status').textContent=err.message;}finally{buttons.forEach(b=>b.disabled=false);}
}
async function load(){
 $('refresh').disabled=true;$('status').textContent='Reading the public unit sheet…';
 try{const response=await fetch('/api/units');if(!response.ok)throw new Error('Could not read source sheet');const data=await response.json();if(!data.units.length)throw new Error('No units found in source.');originals=data.units;selected=Math.min(selected,originals.length-1);$('source-state').textContent=data.cached?'Downloaded snapshot':'Public sheet connected';$('source-detail').textContent=`${originals.length} units · ${originals.length*2} cards`; $('status').textContent=data.warning||`Loaded ${originals.length} units. Both army colours are ready.`;select(selected);
 }catch(err){$('status').textContent=err.message;}finally{$('refresh').disabled=false;}
}
for(const [name,file] of Object.entries(ART)){const option=document.createElement('option');option.value=file;option.textContent=name;$('artwork').append(option);}
{const option=document.createElement('option');option.value='uploaded';option.textContent='Custom uploaded image';option.disabled=true;$('artwork').append(option);}
$('search').oninput=roster;$('refresh').onclick=load;$('export-all').onclick=()=>exportCards(true);$('export-pair').onclick=()=>exportCards(false);$('artwork').onchange=()=>saveField('artwork',$('artwork').value);
$('scale').oninput=()=>{$('scale-value').textContent=$('scale').value+'%';saveField('scale',Number($('scale').value));};
$('upload').onchange=async()=>{const file=$('upload').files[0];if(!file)return;try{const value=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});await getImage(value);saveField('artwork',value);$('artwork').value='uploaded';}catch{$('status').textContent='This file could not be read as an image.';}};
$('reset').onclick=()=>{delete edits[originals[selected].Unit];persist();select(selected);};
$('print').onclick=()=>window.print();
$('export-pdf').onclick=()=>exportCards(true,'pdf');
load();

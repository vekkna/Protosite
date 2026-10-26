'use strict';
const $ = id => document.getElementById(id);
const ART = UnitArtwork.files;
const STORAGE = 'unit-card-studio-v1';
let originals = [], selected = 0, edits = {}, renderVersion = 0;
try { edits = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch {}
const imageCache = new Map();
const statIconCache = new Map();
async function getStatIcon(name,ink) {
 const key=name+ink;
 if(!statIconCache.has(key))statIconCache.set(key,(async()=>{
  const image=await getImage('../images/'+name+'-icon.png');
  const source=document.createElement('canvas');source.width=image.width;source.height=image.height;
  const sc=source.getContext('2d');sc.drawImage(image,0,0);
  const pixels=sc.getImageData(0,0,source.width,source.height).data;
  let left=source.width,top=source.height,right=-1,bottom=-1;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(pixels[(y*source.width+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left)throw new Error('Empty stat icon: '+name);
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
 for (const [key,label] of [['Unit','Unit name'],['Footprint','Card format'],['Speed','Speed · wing'],['Drill','Drill · chevrons'],['Melee','Melee · swords'],['Ranged','Ranged · strength/range'],['Def','Defence · shield']]) {
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
async function renderCard(unit,colour) {
 if(!['SN','SW'].includes(unit.Footprint))throw new Error('Unknown footprint for '+unit.Unit+': '+unit.Footprint);
 const portrait=unit.Footprint==='SN';const template=await getImage(`assets/templates/${colour}_${portrait?'vertical':'horizontal'}_template.png`);
 const canvas=document.createElement('canvas');canvas.width=portrait?1260:1760;canvas.height=portrait?1760:1260;
 const designWidth=portrait?1061:1482,designHeight=portrait?1482:1061;
 const ctx=canvas.getContext('2d');ctx.scale(canvas.width/designWidth,canvas.height/designHeight);ctx.drawImage(template,0,0,designWidth,designHeight);
 const ink=colour==='blue'?'#073e79':'#d33d00';
 if(unit.artwork) {
  const src=unit.artwork.startsWith('data:')?unit.artwork:'../images/'+encodeURIComponent(unit.artwork);const art=await getImage(src);
  // Contain the image over the shield; preserve transparent pixels for the silhouette outline.
  const box=portrait?{x:305,y:303,w:452,h:515}:{x:543,y:231,w:396,h:402};
  const ratio=Math.min(box.w/art.width,box.h/art.height)*Number(unit.scale)/100;const w=art.width*ratio,h=art.height*ratio;
  const x=box.x+(box.w-w)/2,y=box.y+(box.h-h)/2+UnitArtwork.offsetY(unit);
  const mask=document.createElement('canvas');mask.width=canvas.width;mask.height=canvas.height;const mc=mask.getContext('2d');mc.drawImage(art,x,y,w,h);mc.globalCompositeOperation='source-in';mc.fillStyle=ink;mc.fillRect(0,0,mask.width,mask.height);
  for(let a=0;a<Math.PI*2;a+=Math.PI/16)ctx.drawImage(mask,Math.cos(a)*7,Math.sin(a)*7);
  ctx.drawImage(art,x,y,w,h);
 }
 ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';
 fitText(ctx,unit.Unit,portrait?530:741,portrait?(colour==='blue'?950:990):778,portrait?850:1240,portrait?112:128,24);
 const ranged=String(unit.Ranged||'—').split('/');const values=[unit.Speed,unit.Drill,unit.Melee,ranged[0],ranged[1]||'—',unit.Def];
 // Equal cells and a fixed gap from the visible icon edge to left-aligned text.
 const bounds=portrait?(colour==='blue'?{left:92,right:968,top:1032,bottom:1327}:{left:96,right:964,top:1077,bottom:1372}):{left:78,right:1404,top:880,bottom:989};
 const columns=portrait?2:6,rows=portrait?3:1;
 const cellWidth=(bounds.right-bounds.left)/columns,cellHeight=(bounds.bottom-bounds.top)/rows;
 const iconNames=['move','mobility','strike','shoot','range','defence'];
 const icons=await Promise.all(iconNames.map(name=>getStatIcon(name,ink)));
 ctx.strokeStyle=ink;ctx.lineWidth=2.5;ctx.lineCap='round';ctx.beginPath();
 if(!portrait){
  for(let col=1;col<columns;col++){const x=bounds.left+col*cellWidth;ctx.moveTo(x,bounds.top+8);ctx.lineTo(x,bounds.bottom-8);}
 }
 ctx.stroke();
 ctx.textAlign='left';
 values.forEach((v,i)=>{
  const col=portrait?Math.floor(i/3):i,row=portrait?i%3:0;
  const left=bounds.left+col*cellWidth,cy=bounds.top+(row+.5)*cellHeight;
  const iconRight=left+(portrait?170:100),gap=portrait?24:18,iconWidth=88,iconHeight=portrait?76:86;
  const icon=icons[i];
  const scale=Math.min(iconWidth/icon.width,iconHeight/icon.height),w=icon.width*scale,h=icon.height*scale;
  ctx.drawImage(icon,iconRight-w,cy-h/2,w,h);
  const raw=String(v??'').trim();
  const text=!raw||/^[-—–/]$/.test(raw)?'0':raw;
  // Align the actual glyph edge (including the bearing of characters such as 1).
  const x=iconRight+gap,maxWidth=left+cellWidth-12-x;
  let fontSize=portrait?106:104;ctx.font=`700 ${fontSize}px "Segoe UI", Arial, sans-serif`;
  while(ctx.measureText(text).width>maxWidth&&fontSize>26){fontSize--;ctx.font=`700 ${fontSize}px "Segoe UI", Arial, sans-serif`;}
  const metrics=ctx.measureText(text);
  ctx.fillText(text,x+(metrics.actualBoundingBoxLeft||0),cy+(metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2);
 });
 return canvas;
}
async function preview() {
 const version=++renderVersion,unit=unitAt(selected);$('unit-title').textContent=unit.Unit;$('unit-meta').textContent=`${unit.Footprint} · ${unit.Footprint==='SN'?'63 × 88':'88 × 63'} mm · 508 dpi`;
 try { const cards=await Promise.all(['blue','orange'].map(c=>renderCard(unit,c)));if(version!==renderVersion)return;
  cards.forEach((card,i)=>{const colour=i?'orange':'blue',dest=$(colour);dest.width=card.width;dest.height=card.height;dest.classList.toggle('portrait',unit.Footprint==='SN');dest.getContext('2d').drawImage(card,0,0);$(colour+'-size').textContent=`${card.width} × ${card.height}`;});
 }catch(err){$('status').textContent=err.message;}
}
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
async function blobFrom(canvas){
 const png=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed')),'image/png'));
 const bytes=new Uint8Array(await png.arrayBuffer()),parts=[bytes.slice(0,8)];
 // PNG pHYs: exactly 20,000 pixels/metre (508 dpi), or 20 pixels/mm.
 const physical=new Uint8Array(21),view=new DataView(physical.buffer);view.setUint32(0,9);physical.set([112,72,89,115],4);view.setUint32(8,20000);view.setUint32(12,20000);physical[16]=1;view.setUint32(17,crc32(physical.slice(4,17)));
 let offset=8;
 while(offset<bytes.length){const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0),type=String.fromCharCode(...bytes.slice(offset+4,offset+8));if(type!=='pHYs')parts.push(bytes.slice(offset,offset+12+length));if(type==='IHDR')parts.push(physical);offset+=12+length;}
 return new Blob(parts,{type:'image/png'});
}
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
for(const [name,file] of Object.entries(ART)){const option=document.createElement('option');option.value=file;option.textContent=name;$('artwork').append(option);}
{const option=document.createElement('option');option.value='uploaded';option.textContent='Custom uploaded image';option.disabled=true;$('artwork').append(option);}
$('search').oninput=roster;$('refresh').onclick=load;$('export-all').onclick=()=>exportCards(true);$('export-pair').onclick=()=>exportCards(false);$('artwork').onchange=()=>saveField('artwork',$('artwork').value);
$('scale').oninput=()=>{$('scale-value').textContent=$('scale').value+'%';saveField('scale',Number($('scale').value));};
$('upload').onchange=async()=>{const file=$('upload').files[0];if(!file)return;try{const value=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});await getImage(value);saveField('artwork',value);$('artwork').value='uploaded';}catch{$('status').textContent='This file could not be read as an image.';}};
$('reset').onclick=()=>{delete edits[originals[selected].Unit];persist();select(selected);};
$('print').onclick=()=>window.print();
load();

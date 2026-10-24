#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { removeBackground } from '@imgly/background-removal-node';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_FILE = join(ROOT, 'data', 'catalog.json');
const TEMPLATE_FILE = join(ROOT, 'public', 'assets', 'img', 'plantilla.jpg');

const env = await readEnv();
const IK_KEY = env.IMAGEKIT_PRIVATE_KEY || '';
const IK_ENDPOINT = 'https://upload.imagekit.io/api/v1/files/upload';
const IK_FOLDER = env.IMAGEKIT_FOLDER || '/Latiendadealex';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function main(){
  const cat = JSON.parse(await readFile(CATALOG_FILE,'utf8'));
  const p = cat.products||cat;
  const prod = p.find(x=>x.name && x.name.includes('SPK 30BL2'));
  if(!prod){ console.log('no'); return; }
  const q = [prod.brand, prod.name].filter(Boolean).join(' ');
  const imgs = await ddg(q);
  let buf=null;
  for(const c of imgs.slice(0,4)){
    try{
      const r = await fetch(c.url,{headers:{'User-Agent':UA}});
      if(!r.ok) continue;
      const ab = await r.arrayBuffer();
      if(ab.byteLength<3000) continue;
      buf = Buffer.from(ab);
      break;
    }catch{}
  }
  if(!buf) throw new Error('no img');
  const nog = await removeBg(buf);
  const comp = await compose(nog);
  const url = await upload(comp, prod.id);
  prod.image = url;
  await atomic(cat);
  console.log('ok', url);
}

async function ddg(q){
  const p = await fetch('https://duckduckgo.com/?q='+encodeURIComponent(q)+'&iax=images&ia=images',{headers:{'User-Agent':UA}}).then(r=>r.text());
  const m = p.match(/vqd=["\']?([\d-]+)["\']?/);
  if(!m) return [];
  const j = await fetch('https://duckduckgo.com/i.js?l=es&q='+encodeURIComponent(q)+'&vqd='+m[1]+'&f=,,,,,',{headers:{'User-Agent':UA,'Referer':'https://duckduckgo.com/'}}).then(r=>r.json()).catch(()=>({}));
  return (j.results||[]).map(x=>({url:x.image})).filter(x=>x.url);
}
async function removeBg(buf){
  try{
    const res = await removeBackground(new Blob([buf],{type:'image/jpeg'}));
    return Buffer.from(await res.arrayBuffer());
  }catch{
    const d = sharp(buf).ensureAlpha();
    const {data,info}=await d.raw().toBuffer({resolveWithObject:true});
    const r = await removeBackground(new Blob([data],{type:`image/x-rgba8; width=${info.width}; height=${info.height}`}));
    return Buffer.from(await r.arrayBuffer());
  }
}
async function compose(png){
  const t = await sharp(TEMPLATE_FILE).png().toBuffer();
  const {width:tw,height:th}=await sharp(t).metadata();
  const {width:sw,height:sh}=await sharp(png).metadata();
  const sc = Math.min((tw*0.72)/sw,(th*0.43)/sh);
  const rs = await sharp(png).resize(Math.round(sw*sc),Math.round(sh*sc)).png().toBuffer();
  const x=Math.round((tw-Math.round(sw*sc))/2), y=Math.round(th*0.49-Math.round(sh*sc)/2);
  return sharp(t).composite([{input:rs,left:x,top:y}]).webp({quality:82}).toBuffer();
}
async function upload(buf,id){
  const form=new FormData();
  const fn=`producto-${id}-${Date.now()}.webp`;
  form.set('file', new Blob([buf],{type:'image/webp'}), fn);
  form.set('fileName',fn); form.set('folder',IK_FOLDER); form.set('useUniqueFileName','true');
  const auth=Buffer.from(IK_KEY+':').toString('base64');
  const r=await fetch(IK_ENDPOINT,{method:'POST',headers:{Authorization:'Basic '+auth},body:form});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.url) throw new Error(j.message||'ik');
  return j.url;
}
async function atomic(cat){ const tmp=CATALOG_FILE+'.tmp'; await writeFile(tmp,JSON.stringify(cat,null,1)); await rename(tmp,CATALOG_FILE); }
async function readEnv(){ try{ const t=await readFile(join(ROOT,'.env'),'utf8'); const env={}; for(const l of t.split(/\r?\n/)){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,''); } return env; }catch{return{}} }
main().catch(e=>{console.error(e.message);process.exit(1);});

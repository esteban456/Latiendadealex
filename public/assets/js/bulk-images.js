(async function(){
  const $ = s => document.querySelector(s);
  async function request(path, opts={}){
    const r=await fetch(path,{credentials:'same-origin',...opts});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||'error');
    return d;
  }
  async function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function loadQueue(){
    let q=[];
    try{const r=await fetch('/fetch-queue.json',{cache:'no-store'}); if(r.ok){const d=await r.json(); q=Array.isArray(d.queue)?d.queue.slice():[];}}catch{}
    if(!q.length){
      const all=await request('/api/admin/products?limit=1000');
      q=(all.products||[]).filter(p=>{const img=String(p.image||''); if(!img)return true; if(img.startsWith('/assets/img/productos-webp/'))return false; if(/^https?:\/\//i.test(img))return false; return true;});
    }
    window._bulk=q;
    $('#bulk-total').textContent=q.length;
    $('#bulk-done').textContent=0; $('#bulk-fail').textContent=0;
    const tbody=document.getElementById('bulk-rows');
    tbody.innerHTML=q.map((p,i)=>`<tr data-idx="${i}"><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.brand||'')}</td><td class="status">Pendiente</td></tr>`).join('');
    $('#bulk-status').textContent=q.length?'Lista':'Vacía';
  }
  window.addEventListener('click',async e=>{
    if(e.target.id==='bulk-fetch-images'){await loadQueue();}
    if(e.target.id==='bulk-run'){await run();}
  });
  async function run(){
    const q=window._bulk||[]; if(!q.length)return;
    $('#bulk-run').disabled=true;
    let done=0,fail=0; const csrf=''; // server uses same session
    for(let i=0;i<q.length;i++){
      const p=q[i];
      const row=document.querySelector(`#bulk-rows tr[data-idx="${i}"] .status`);
      try{
        row.textContent='Buscando';
        const page=await fetch('https://duckduckgo.com/?q='+encodeURIComponent((p.brand||'')+' '+p.name)+'&iax=images&ia=images',{headers:{'User-Agent':'Mozilla/5.0'}}).then(r=>r.text());
        const m=page.match(/vqd=["\']?([\d-]+)["\']?/);
        if(!m) throw new Error('vqd');
        const j=await fetch('https://duckduckgo.com/i.js?l=es&q='+encodeURIComponent((p.brand||'')+' '+p.name)+'&vqd='+m[1]+'&f=,,,,,',{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://duckduckgo.com/'}}).then(r=>r.json());
        const cands=(j.results||[]).map(x=>({url:x.image})).filter(x=>x.url).slice(0,6);
        if(!cands.length) throw new Error('sin res');
        row.textContent='Descargando';
        let blob=null,last;
        for(const c of cands){try{const r=await fetch(c.url,{headers:{'User-Agent':'Mozilla/5.0'}}); if(r.ok){const buf=await r.arrayBuffer(); if(buf.byteLength>5000){blob=new Blob([buf],{type:r.headers.get('content-type')||'image/jpeg'}); break;}}}catch(e){last=e}}
        if(!blob) throw new Error('no desc');
        row.textContent='Procesando';
        const tr=await fetch('/assets/img/plantilla.jpg',{cache:'force-cache'});
        if(!tr.ok) throw new Error('plantilla');
        const tb=await createImageBitmap(await tr.blob()); const pb=await createImageBitmap(blob);
        const canvas=document.createElement('canvas'); canvas.width=tb.width; canvas.height=tb.height;
        const ctx=canvas.getContext('2d'); ctx.drawImage(tb,0,0);
        const s=Math.min((canvas.width*0.72)/pb.width,(canvas.height*0.43)/pb.height);
        const pw=pb.width*s,ph=pb.height*s;
        ctx.drawImage(pb,(canvas.width-pw)/2,canvas.height*0.49-ph/2,pw,ph);
        pb.close(); tb.close();
        const dataUrl=canvas.toDataURL('image/webp',0.82);
        const up=await request('/api/admin/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataUrl})});
        await request('/api/admin/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p,id:p.id,image:up.image})});
        row.textContent='OK'; done++;
      }catch(e){row.textContent='Err'; fail++;}
      $('#bulk-done').textContent=done; $('#bulk-fail').textContent=fail;
      $('#bulk-status').textContent='Procesados '+(done+fail)+'/'+q.length;
    }
    $('#bulk-run').disabled=false;
  }
})();

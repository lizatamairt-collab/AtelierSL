/* ══════════════════════════════════════════════════════════
   DATA & CONFIG
══════════════════════════════════════════════════════════ */
const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3000/api'
  : 'https://api.example.com/api';
const GOLD = '#879b78', TERRA = '#b77948';

const NAV=[
  {id:'dashboard',label:'Tableau de bord',icon:'📊'},
  {id:'produits', label:'Produits',        icon:'👗'},
  {id:'commandes',label:'Commandes',       icon:'📦'},
  {id:'clients',  label:'Clients',         icon:'👥'},
  {id:'utilisateurs',label:'Utilisateurs / Rôles',icon:'🔑'},
  {id:'categories',label:'Catégories',     icon:'🏷'},
  {id:'promos',   label:'Codes promo',     icon:'🎟'},
  {id:'avis',     label:'Modération avis', icon:'⭐'},
  {id:'messages', label:'Messages contact',icon:'📩'},
  {id:'newsletter',label:'Newsletter',     icon:'📧'},
  /* stock nav removed */
  {id:'stats',    label:'Statistiques',    icon:'📈'},
  {id:'visiteurs',label:'Visiteurs',       icon:'👀'},
  {id:'journaux', label:'Journal admin',   icon:'🗒'},
  {id:'notifications',label:'Notifications',icon:'🔔'},
  {id:'parametres',label:'Paramètres',     icon:'⚙️'},
];
const TITLES={dashboard:'Tableau de bord',produits:'Gestion des produits',commandes:'Gestion des commandes',clients:'Gestion des clients',utilisateurs:'Utilisateurs & Rôles',categories:'Catégories',promos:'Codes promotionnels',avis:'Modération des avis',messages:'Messages de contact',newsletter:'Abonnés newsletter',stats:'Statistiques',visiteurs:'Visiteurs du site',journaux:'Journal d\'administration',notifications:'Notifications',parametres:'Paramètres du site'};
const STATUS={livree:{pill:'success',label:'Livrée'},expediee:{pill:'info',label:'Expédiée'},confirmee:{pill:'warning',label:'Confirmée'},en_attente:{pill:'neutral',label:'En attente'},annulee:{pill:'danger',label:'Annulée'},remboursee:{pill:'danger',label:'Remboursée'},en_preparation:{pill:'info',label:'En préparation'}};

let state={theme:'light',page:'dashboard',token:null,user:null};

/* ══════════════════════════════════════════════════════════
   API HELPER
══════════════════════════════════════════════════════════ */
async function api(path, opts={}){
  const h={'Content-Type':'application/json'};
  if(state.token) h['Authorization']=`Bearer ${state.token}`;
  const res=await fetch(`${API}${path}`,{headers:h,...opts});
  return res;
}

/* ══════════════════════════════════════════════════════════
   HELPERS UI
══════════════════════════════════════════════════════════ */
function pill(type,label){return `<span class="pill pill-${type}">${label}</span>`;}
function statusPill(s){const st=STATUS[s]||{pill:'neutral',label:s};return pill(st.pill,st.label);}
function stars(n){let h='<div class="stars">';for(let i=1;i<=5;i++)h+=`<span class="${i<=n?'on':'off'}">★</span>`;return h+'</div>';}
function fmt(n){return Number(n||0).toLocaleString('fr-DZ');}
function kpiCard(label,value,sub,icon,color,linkPage){
  const attrs=linkPage?`onclick="navigate('${linkPage}')" title="Voir : ${label}"`:'';
  const style=`border-top:3px solid ${color}${linkPage?';cursor:pointer;transition:transform .15s' : ''}`;
  return `<div class="kpi-card" style="${style}" ${attrs}
    ${linkPage?`onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'"`:''}>
    <div class="kpi-inner"><div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div><div class="kpi-icon">${icon}</div></div></div>`;
}
function kabyleOrnamentSVG(w=202,color=GOLD,opacity=1){
  const pts=[20,48,76,104,132,160,188,216].filter(x=>x<w-10);
  const d=pts.map(x=>`<polygon points="${x},3 ${x+11},13 ${x},23 ${x-11},13" fill="none" stroke="${color}" stroke-width="1.2"/>
    <polygon points="${x},7 ${x+6},13 ${x},19 ${x-6},13" fill="${color}" fill-opacity="0.42"/>`).join('');
  return `<svg viewBox="0 0 ${w} 26" width="${w}" height="26" style="opacity:${opacity}">
    <line x1="0" y1="2" x2="${w}" y2="2" stroke="${color}" stroke-width="0.8"/>
    ${d}<line x1="0" y1="24" x2="${w}" y2="24" stroke="${color}" stroke-width="0.8"/>
  </svg>`;
}

/* ══════════════════════════════════════════════════════════
   SVG CHARTS (inchangés)
══════════════════════════════════════════════════════════ */
function makeAreaChart(data,vKey,lKey,color,h=170,fmtTick){
  const W=560,H=h,PL=42,PR=10,PT=10,PB=26,iW=W-PL-PR,iH=H-PT-PB;
  const vals=data.map(d=>d[vKey]),max=Math.max(...vals)||1;
  const rx=(i)=>PL+(i/(data.length-1))*iW;
  const ry=(v)=>PT+iH-(v/max)*iH;
  const pts=data.map((d,i)=>({x:rx(i),y:ry(d[vKey]),l:d[lKey]}));
  const lp=pts.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ap=`${lp} L${pts[pts.length-1].x.toFixed(1)},${(PT+iH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PT+iH).toFixed(1)} Z`;
  const gid='g'+Math.random().toString(36).slice(2,8);
  const ticks=[0,0.5,1].map(f=>({y:PT+iH*(1-f),v:max*f}));
  const ticksSVG=ticks.map(t=>`<line x1="${PL}" y1="${t.y.toFixed(1)}" x2="${W-PR}" y2="${t.y.toFixed(1)}" stroke="var(--border)" stroke-width="0.7" stroke-dasharray="4,3"/>
    <text x="${PL-4}" y="${(t.y+3.5).toFixed(1)}" text-anchor="end" font-size="8.5" fill="var(--text-muted)">${fmtTick?fmtTick(t.v):(t.v/1000).toFixed(0)+'k'}</text>`).join('');
  const dotsSVG=pts.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${color}" stroke="white" stroke-width="1.5"/>
    <text x="${p.x.toFixed(1)}" y="${H-5}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${p.l}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/><stop offset="100%" stop-color="${color}" stop-opacity="0.01"/>
    </linearGradient></defs>${ticksSVG}
    <path d="${ap}" fill="url(#${gid})"/>
    <path d="${lp}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${dotsSVG}</svg>`;
}
function makeBarChart(data,vKey,lKey,color,h=145){
  const W=560,H=h,PL=10,PR=10,PT=10,PB=24,iW=W-PL-PR,iH=H-PT-PB;
  const max=Math.max(...data.map(d=>d[vKey]))||1;
  const gap=iW/data.length,bw=gap*0.55;
  const ticks=[0,0.5,1].map(f=>`<line x1="${PL}" y1="${(PT+iH*(1-f)).toFixed(1)}" x2="${W-PR}" y2="${(PT+iH*(1-f)).toFixed(1)}" stroke="var(--border)" stroke-width="0.7" stroke-dasharray="4,3"/>`).join('');
  const bars=data.map((d,i)=>{const bh=(d[vKey]/max)*iH,x=PL+gap*i+gap*0.225,y=PT+iH-bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="3" fill-opacity="0.85"/>
    <text x="${(x+bw/2).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${d[lKey]}</text>`;}).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${ticks}${bars}</svg>`;
}
function makeDonut(data,size=140){
  const cx=size/2,cy=size/2,r=size*0.36,ri=size*0.22;
  const total=data.reduce((s,d)=>s+d.v,0);let angle=-Math.PI/2,slices='';
  data.forEach(d=>{
    const sweep=(d.v/total)*2*Math.PI,end=angle+sweep;
    const x1=(cx+r*Math.cos(angle)).toFixed(2),y1=(cy+r*Math.sin(angle)).toFixed(2);
    const x2=(cx+r*Math.cos(end)).toFixed(2),y2=(cy+r*Math.sin(end)).toFixed(2);
    const ix1=(cx+ri*Math.cos(angle)).toFixed(2),iy1=(cy+ri*Math.sin(angle)).toFixed(2);
    const ix2=(cx+ri*Math.cos(end)).toFixed(2),iy2=(cy+ri*Math.sin(end)).toFixed(2);
    const lg=sweep>Math.PI?1:0;
    slices+=`<path d="M${ix1},${iy1} L${x1},${y1} A${r},${r} 0 ${lg},1 ${x2},${y2} L${ix2},${iy2} A${ri},${ri} 0 ${lg},0 ${ix1},${iy1} Z" fill="${d.c}" fill-opacity="0.9"/>`;
    angle=end;});
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${slices}</svg>`;
}

/* ══════════════════════════════════════════════════════════
   PAGE RENDERERS
══════════════════════════════════════════════════════════ */
async function renderDashboard(){
  document.getElementById('page-dashboard').innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    const [rResume,rCmds]=await Promise.all([
      api('/statistiques/resume'),
      api('/commandes?limite=5&ordre=DESC')
    ]);
    const dR=await rResume.json();
    const dC=await rCmds.json();
    const r=dR.resume||{};
    const cmds=(dC.commandes||[]).slice(0,5);
    const v=dR.variations||{};
    const deltaCA=v.chiffre_affaires!=null?(v.chiffre_affaires>0?`↑ +${v.chiffre_affaires}%`:`↓ ${v.chiffre_affaires}%`):'—';
    const deltaCmd=v.nb_commandes!=null?(v.nb_commandes>0?`↑ +${v.nb_commandes}%`:`↓ ${v.nb_commandes}%`):'—';
    const deltaCli=v.nouveaux_clients!=null?(v.nouveaux_clients>0?`↑ +${v.nouveaux_clients}%`:`↓ ${v.nouveaux_clients}%`):'—';
    const rows=cmds.map((o,i)=>{
      const photoBadge=(o.nb_articles>1)?`<span style="position:absolute;bottom:-4px;right:-4px;background:var(--terra,#a0522d);color:#fff;font-size:9px;font-weight:700;border-radius:8px;padding:1px 4px;line-height:1.4;border:1px solid var(--bg,#fff)">+${o.nb_articles-1}</span>`:'';
      return `<tr class="${i%2?'alt':''}" style="cursor:pointer" onclick="voirCommande('${o.id}')" title="Voir le détail de la commande">
      <td><span style="position:relative;display:inline-block"><img src="${o.image_url||'https://placehold.co/40x40/f1e9dc/8a7256?text=%E2%80%94'}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"/>${photoBadge}</span></td>
      <td class="mono">${o.numero||o.id?.slice(0,8)}</td>
      <td class="fw6">${o.utilisateur_prenom||''} ${o.utilisateur_nom||''}</td>
      <td class="fw6">${fmt(o.total)} DA</td>
      <td>${statusPill(o.statut)}</td>
      <td style="color:var(--text-muted);font-size:12px">${new Date(o.created_at).toLocaleDateString('fr-DZ')}</td>
    </tr>`;}).join('');
    document.getElementById('page-dashboard').innerHTML=`
      <div class="grid-4">
        ${kpiCard("CA (30 jours)",fmt(r.chiffre_affaires||0)+' DA',deltaCA+" vs période préc.","💰",GOLD,"stats")}
        ${kpiCard("Commandes",r.nb_commandes||0,deltaCmd+" — "+( r.nb_annulations||0)+" annulation(s)","📦",TERRA,"commandes")}
        ${kpiCard("Clients total",r.total_clients||0,deltaCli+" nouveaux","👥","#6B8E6B","clients")}
        ${kpiCard("Produits actifs",r.total_produits_actifs||0,"Confectionnés sur commande","👗","#8B6B3D","produits")}
      </div>
      <div class="table-wrap">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <div class="card-title" style="margin:0">Dernières commandes</div>
          <button class="btn btn-outline btn-sm" onclick="navigate('commandes')">Voir toutes les commandes →</button>
        </div>
        <table><thead><tr><th>Photo</th><th>N° Commande</th><th>Client</th><th>Total</th><th>Statut</th><th>Date</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">Aucune commande</td></tr>'}</tbody></table>
      </div>`;
  }catch(e){document.getElementById('page-dashboard').innerHTML=`<div style="padding:40px;text-align:center;color:var(--text-muted)">Impossible de charger le tableau de bord (vérifiez que l'API est démarrée)</div>`;}
}

async function renderProduits(search=''){
  const el=document.getElementById('page-produits');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    let url=`/produits?limite=50`;
    if(search) url+=`&recherche=${encodeURIComponent(search)}`;
    const r=await api(url);
    const d=await r.json();
    const prods=d.produits||d.data||[];
    const rows=prods.map((p,i)=>`<tr class="${i%2?'alt':''}">
      <td><div style="display:flex;align-items:center;gap:10px">
        ${p.image_principale
          ?`<img src="${escHtml(p.image_principale)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid var(--border)" onerror="this.replaceWith(Object.assign(document.createElement('div'),{style:'width:38px;height:38px;border-radius:8px;background:rgba(201,168,76,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0',innerHTML:'👗'}))"/>`
          :'<div style="width:38px;height:38px;border-radius:8px;background:rgba(201,168,76,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">👗</div>'}
        <div><div class="fw6" style="font-size:13px">${p.nom}</div>${p.featured?'<span style="font-size:10px;color:'+GOLD+';font-weight:600">★ En vedette</span>':''}</div>
      </div></td>
      <td style="color:var(--text-muted);font-size:12px">${p.categorie_nom||p.categorie||'—'}</td>
      <td><div class="fw6">${fmt(p.prix)} DA</div>${p.prix_solde?`<div style="font-size:11px;color:${TERRA}">${fmt(p.prix_solde)} DA</div>`:''}${p.prix_eur?`<div style="font-size:11px;color:var(--text-muted)">🇫🇷 ${Number(p.prix_solde_eur||p.prix_eur).toFixed(2)} €</div>`:''}</td>
      <td>${p.type_produit==='stock'
            ?`<span class="pill ${(+p.stock_total>0)?'pill-success':'pill-danger'}" style="font-size:11px">${(+p.stock_total>0)?(+p.stock_total)+' en stock':'Rupture'}</span>`
            :'<span class="pill pill-neutral" style="font-size:11px">Sur mesure</span>'}</td>
      <td style="color:${GOLD};font-weight:600">★ ${p.note_moyenne||0}</td>
      <td>${pill(p.actif?'success':'neutral',p.actif?'Actif':'Inactif')}</td>
      <td>
        <button class="action-btn ab-edit" onclick="openProduitModal('${p.slug||''}','${p.id}')">✏️</button>
        <button class="action-btn ab-del" onclick="deleteProduit('${p.id}','${p.nom?.replace(/'/g,"\\'")}')" style="margin-left:4px">🗑</button>
      </td>
    </tr>`).join('');
    el.innerHTML=`
      <div class="page-row">
        <div class="search-wrap"><span class="search-icon">🔍</span>
          <input class="search-input" placeholder="Rechercher un produit…" value="${search}" oninput="debouncedSearch('produits',this,renderProduits)" id="prodSearch"/>
        </div>
        <button class="btn btn-terra" onclick="openProduitModal()">+ Nouveau produit</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Produit</th><th>Catégorie</th><th>Prix</th><th>Stock</th><th>Note</th><th>Statut</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Aucun produit trouvé</td></tr>'}</tbody>
      </table></div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement des produits</div>';}
}

async function renderCommandes(filter='tous'){
  const el=document.getElementById('page-commandes');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    let url='/commandes?limite=50&ordre=DESC';
    if(filter!=='tous') url+=`&statut=${filter}`;
    const r=await api(url);
    const d=await r.json();
    if(!r.ok){
      el.innerHTML=`<div style="padding:40px;text-align:center;color:#c0392b">
        Erreur API (${r.status}) : ${d.message||'Erreur inconnue'}
        ${d.errors?'<br><small>'+JSON.stringify(d.errors)+'</small>':''}
      </div>`;
      return;
    }
    const orders=d.commandes||[];
    const tabs=['tous','en_attente','confirmee','en_preparation','expediee','livree','annulee'];
    const rAll=await api('/commandes?limite=1');
    const dAll=await rAll.json();
    const tabsHTML=tabs.map(f=>{
      const lbl=f==='tous'?'Toutes':(STATUS[f]||{label:f}).label;
      const cnt=f==='tous'?dAll.pagination?.total||orders.length:'?';
      return `<button class="ftab${filter===f?' active':''}" onclick="renderCommandes('${f}')">${lbl}${f==='tous'?' ('+cnt+')':''}</button>`;
    }).join('');
    const rows=orders.map((o,i)=>{
      let action='';
      if(o.statut==='en_attente') action=`<button class="btn btn-outline btn-sm" onclick="updateOrder('${o.id}','confirmee')">Confirmer</button>`;
      else if(o.statut==='confirmee') action=`<button class="btn btn-terra btn-sm" onclick="updateOrder('${o.id}','en_preparation')">Préparer</button>`;
      else if(o.statut==='en_preparation') action=`<button class="btn btn-terra btn-sm" onclick="updateOrder('${o.id}','expediee')">Expédier</button>`;
      else if(o.statut==='expediee') action=`<button class="btn btn-gold btn-sm" onclick="updateOrder('${o.id}','livree')">Livrée ✓</button>`;
      // Event date badge
      const hasEvent=o.date_evenement_min!=null;
      const daysLeft=hasEvent?Math.ceil((new Date(o.date_evenement_min)-new Date())/(1000*60*60*24)):null;
      const eventBadge=hasEvent?(daysLeft!=null&&daysLeft<=14&&daysLeft>=0
        ?`<span class="event-date-badge urgent-badge" style="margin-left:6px">⚡ ${daysLeft}j</span>`
        :`<span class="event-date-badge" style="margin-left:6px">📅 ${new Date(o.date_evenement_min).toLocaleDateString('fr-DZ')}</span>`):'';
      const photoBadge=(o.nb_articles>1)?`<span style="position:absolute;bottom:-4px;right:-4px;background:var(--terra,#a0522d);color:#fff;font-size:9px;font-weight:700;border-radius:8px;padding:1px 4px;line-height:1.4;border:1px solid var(--bg,#fff)">+${o.nb_articles-1}</span>`:'';
      return `<tr class="${i%2?'alt':''}" style="cursor:pointer" onclick="voirCommande('${o.id}')">
        <td><span style="position:relative;display:inline-block"><img src="${o.image_url||'https://placehold.co/40x40/f1e9dc/8a7256?text=%E2%80%94'}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"/>${photoBadge}</span></td>
        <td class="mono" style="font-size:11px">${o.numero||o.id?.slice(0,8)}${eventBadge}${o.devise_affichee==='EUR'?' 🇫🇷':''}</td>
        <td class="fw6">${o.utilisateur_prenom||''} ${o.utilisateur_nom||''}</td>
        <td style="text-align:center;color:var(--text-muted)">${o.nb_articles||'—'}</td>
        <td class="fw6">${fmt(o.total)} DA${(o.devise_affichee==='EUR'&&o.total_devise_affichee)?`<div style="font-size:11px;font-weight:400;color:var(--text-muted)">🇫🇷 ~${Number(o.total_devise_affichee).toFixed(2)} €</div>`:''}</td>
        <td>${statusPill(o.statut)}</td>
        <td style="color:var(--text-muted);font-size:12px">${new Date(o.created_at).toLocaleDateString('fr-DZ')}</td>
        <td>${action}</td>
      </tr>`;}).join('');
    el.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div class="filter-tabs" style="margin-bottom:0">${tabsHTML}</div>
        <button class="btn-export" onclick="exportCSV('commandes')">⬇ Export CSV</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>N° Commande</th><th>Client</th><th>Articles</th><th>Total</th><th>Statut</th><th>Date</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">Aucune commande</td></tr>'}</tbody>
      </table></div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement des commandes</div>';}
}

async function renderClients(search=''){
  const el=document.getElementById('page-clients');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    let url='/utilisateurs?role=client&limite=50';
    if(search) url+=`&recherche=${encodeURIComponent(search)}`;
    const r=await api(url);
    const d=await r.json();
    const clients=d.utilisateurs||[];
    const rows=clients.map((c,i)=>`<tr class="${i%2?'alt':''}">
      <td><div class="fw6">${c.prenom||''} ${c.nom||''}</div><div style="font-size:11px;color:var(--text-muted)">${c.email||''}</div></td>
      <td style="color:var(--text-muted)">${c.telephone||'—'}</td>
      <td style="text-align:center;font-weight:600">${c.nb_commandes||0}</td>
      <td>${c.email_verifie?pill('success','Vérifié'):pill('neutral','Non vérifié')}</td>
      <td style="color:var(--text-muted);font-size:12px">${new Date(c.created_at).toLocaleDateString('fr-DZ')}</td>
      <td>
        <button class="action-btn ab-edit" onclick="voirClient('${c.id}')">👁</button>
        <button class="action-btn ab-del" onclick="deleteClient('${c.id}','${(c.prenom||'').replace(/'/g,"\\'")} ${(c.nom||'').replace(/'/g,"\\'")}')">🗑</button>
      </td>
    </tr>`).join('');
    el.innerHTML=`
      <div class="page-row">
        <div class="search-wrap"><span class="search-icon">🔍</span>
          <input class="search-input" placeholder="Nom, email…" value="${search}" oninput="debouncedSearch('clients',this,renderClients)" id="clientSearch"/>
        </div>
        <span style="font-size:13px;color:var(--text-muted)">${clients.length} client(s)</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Client</th><th>Téléphone</th><th>Commandes</th><th>Email</th><th>Inscrit le</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">Aucun client</td></tr>'}</tbody>
      </table></div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement des clients</div>';}
}

async function renderCategories(){
  const el=document.getElementById('page-categories');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    const r=await api('/categories?actif=all');
    const d=await r.json();
    const cats=d.categories||[];
    const rows=cats.map((c,i)=>`<tr class="${i%2?'alt':''}">
      <td><div class="fw6">${c.parent_nom?'↳ ':''}<span style="${c.parent_nom?'color:var(--text-muted)':''}"></span>${c.nom}</div></td>
      <td style="color:var(--text-muted);font-size:12px">${c.parent_nom||'—'}</td>
      <td style="font-family:monospace;font-size:11px;color:var(--text-muted)">${c.slug}</td>
      <td style="text-align:center">${c.nb_produits||0}</td>
      <td>${pill(c.active?'success':'neutral',c.active?'Active':'Inactive')}</td>
      <td>
        <button class="action-btn ab-edit" onclick="openEditCatModal('${c.id}','${c.nom.replace(/'/g,"\\'")}','${c.parent_id||''}','${c.active}')">✏️</button>
        <button class="action-btn ab-del" onclick="deleteCat('${c.id}','${c.nom.replace(/'/g,"\\'")}')">🗑</button>
      </td>
    </tr>`).join('');
    el.innerHTML=`
      <div class="page-row">
        <span style="font-size:13px;color:var(--text-muted)">${cats.length} catégorie(s)</span>
        <button class="btn btn-terra" onclick="openCatModal()">+ Nouvelle catégorie</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Parente</th><th>Slug</th><th>Produits</th><th>Statut</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">Aucune catégorie</td></tr>'}</tbody>
      </table></div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement</div>';}
}

async function renderPromos(){
  const el=document.getElementById('page-promos');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    const r=await api('/codes-promo?limite=50');
    const d=await r.json();
    const promos=d.codes_promo||[];
    const TYPE_LABEL={pourcentage:'%',montant_fixe:'DA fixe',livraison_gratuite:'Livraison'};
    const rows=promos.map((p,i)=>`<tr class="${i%2?'alt':''}">
      <td><div class="fw6" style="font-family:monospace;font-size:13px">${p.code}</div></td>
      <td style="font-size:12px;color:var(--text-muted)">${TYPE_LABEL[p.type_remise]||p.type_remise}</td>
      <td class="fw6">${p.type_remise==='livraison_gratuite'?'—':fmt(p.valeur)+(p.type_remise==='pourcentage'?'%':' DA')}</td>
      <td style="color:var(--text-muted)">${p.montant_minimum?fmt(p.montant_minimum)+' DA':'—'}</td>
      <td style="text-align:center">${p.utilisations_count||0}${p.utilisations_max?' / '+p.utilisations_max:''}</td>
      <td style="color:var(--text-muted);font-size:12px">${p.expire_le?new Date(p.expire_le).toLocaleDateString('fr-DZ'):'—'}</td>
      <td>${pill(p.statut_effectif==='valide'?'success':p.statut_effectif==='inactif'?'neutral':'danger',p.statut_effectif==='valide'?'Valide':p.statut_effectif==='expire'?'Expiré':p.statut_effectif==='epuise'?'Épuisé':'Inactif')}</td>
      <td>
        <button class="action-btn ab-edit" onclick="togglePromo('${p.id}',${!p.actif})" title="${p.actif?'Désactiver':'Activer'}">${p.actif?'⏸':'▶'}</button>
        <button class="action-btn ab-del" onclick="deletePromo('${p.id}','${p.code}')">🗑</button>
      </td>
    </tr>`).join('');
    el.innerHTML=`
      <div class="page-row">
        <span style="font-size:13px;color:var(--text-muted)">${promos.length} code(s)</span>
        <button class="btn btn-terra" onclick="openPromoModal()">+ Nouveau code</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Type</th><th>Valeur</th><th>Minimum</th><th>Utilisations</th><th>Expiration</th><th>Statut</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">Aucun code promo</td></tr>'}</tbody>
      </table></div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement</div>';}
}

async function renderAvis(filter='tous'){
  const el=document.getElementById('page-avis');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    let url='/avis?limite=50';
    if(filter==='en_attente') url+='&approuve=false';
    else if(filter==='approuves') url+='&approuve=true';
    const r=await api(url);
    const d=await r.json();
    const avis=d.avis||[];
    const tabs=['tous','en_attente','approuves'];
    const tabsHTML=tabs.map(f=>`<button class="ftab${filter===f?' active':''}" onclick="renderAvis('${f}')">${f==='tous'?'Tous':f==='en_attente'?'En attente':'Approuvés'}</button>`).join('');
    const rows=avis.map((a,i)=>`<tr class="${i%2?'alt':''}">
      <td>
        <div class="fw6">${a.auteur_prenom||''} ${(a.auteur_nom||'').charAt(0)}.</div>
        <div style="font-size:11px;color:var(--text-muted)">${a.produit_nom||''}</div>
      </td>
      <td style="color:${GOLD};font-weight:600">★ ${a.note}/5</td>
      <td style="max-width:300px;font-size:12px">${(a.commentaire||'').slice(0,120)}${(a.commentaire||'').length>120?'…':''}</td>
      <td>${a.verifie?pill('success','Achat vérifié'):pill('neutral','Non vérifié')}</td>
      <td>${statusPill(a.approuve?'livree':'en_attente').replace('Livrée','Approuvé').replace('En attente','En attente')}</td>
      <td style="color:var(--text-muted);font-size:12px">${new Date(a.created_at).toLocaleDateString('fr-DZ')}</td>
      <td style="white-space:nowrap">
        ${!a.approuve?`<button class="btn btn-gold btn-sm" onclick="approuverAvis('${a.id}')">✓ Approuver</button> `:''}
        <button class="action-btn ab-del" onclick="rejeterAvis('${a.id}')">🗑</button>
      </td>
    </tr>`).join('');
    el.innerHTML=`
      <div class="filter-tabs">${tabsHTML}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Auteur</th><th>Note</th><th>Commentaire</th><th>Achat</th><th>Statut</th><th>Date</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Aucun avis</td></tr>'}</tbody>
      </table></div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement</div>';}
}

async function renderStats(){
  const el=document.getElementById('page-stats');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    const [rR,rV,rP,rC]=await Promise.all([
      api('/statistiques/resume'),
      api('/statistiques/ventes?grouper=mois'),
      api('/statistiques/produits?limite=5'),
      api('/statistiques/commandes')
    ]);
    const dR=await rR.json(); const r=dR.resume||{};
    const dV=await rV.json(); const ventes=dV.ventes||[];
    const dP=await rP.json(); const topP=dP.top_produits||[];
    const dC=await rC.json(); const parSt=dC.par_statut||[];

    const chartData=ventes.slice(-6).map(v=>({m:new Date(v.periode).toLocaleDateString('fr-DZ',{month:'short'}),ca:parseFloat(v.chiffre_affaires||0),cmd:v.nb_commandes||0}));
    const topHTML=topP.map((p,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:16px;font-weight:700;color:var(--accent);min-width:20px">${i+1}</div>
      <div style="flex:1"><div class="fw6" style="font-size:13px">${p.produit_nom}</div>
      <div style="font-size:11px;color:var(--text-muted)">${p.quantite_vendue||0} vendus · ${fmt(p.chiffre_affaires||0)} DA</div></div>
    </div>`).join('');
    const catPie=dC.par_paiement?.slice(0,4).map((p,i)=>({n:p.methode,v:p.nb_commandes||1,c:[GOLD,TERRA,'#5f7350','#c9a988'][i]})) || [{n:'—',v:1,c:GOLD}];
    const catLegend=catPie.map(c=>`<div class="legend-item"><div style="display:flex;align-items:center;gap:7px"><div class="legend-dot" style="background:${c.c}"></div><span class="legend-label">${c.n}</span></div><span class="legend-val">${c.v}</span></div>`).join('');

    el.innerHTML=`
      <div class="grid-4" style="grid-template-columns:repeat(3,1fr)">
        ${kpiCard("CA (30 jours)",fmt(r.chiffre_affaires||0)+' DA',"Commandes non annulées","📈",GOLD)}
        ${kpiCard("Taux annulation",(r.taux_annulation||0)+'%',(r.nb_annulations||0)+' commande(s) annulée(s)',"🎯",TERRA)}
        ${kpiCard("Panier moyen",fmt(r.panier_moyen||0)+' DA',(r.nb_commandes||0)+" commandes","🛒","#6B8E6B")}
      </div>
      <div class="grid-2-1">
        <div class="card"><div class="card-title">Chiffre d'affaires mensuel</div>${chartData.length>1?makeAreaChart(chartData,'ca','m',GOLD,170,v=>(v/1000).toFixed(0)+'k'):'<p style="color:var(--text-muted);font-size:13px;padding:20px">Données insuffisantes</p>'}</div>
        <div class="card"><div class="card-title">Top produits</div>${topHTML||'<p style="color:var(--text-muted);font-size:13px">Aucun produit vendu</p>'}</div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-title">Commandes par statut</div>
          <table style="width:100%;font-size:13px"><thead><tr><th style="text-align:left">Statut</th><th style="text-align:right">Nb</th><th style="text-align:right">Montant</th></tr></thead>
          <tbody>${parSt.map(s=>`<tr><td>${statusPill(s.statut)}</td><td style="text-align:right">${s.nb_commandes}</td><td style="text-align:right;font-weight:600">${fmt(s.total_montant)} DA</td></tr>`).join('')}</tbody></table>
        </div>
        <div class="card"><div class="card-title">Méthodes de paiement</div>
          <div style="display:flex;justify-content:center;margin-bottom:14px">${makeDonut(catPie,130)}</div>${catLegend}
        </div>
      </div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement des statistiques</div>';}
}

/* ══════════════════════════════════════════════════════════
   VISITEURS (rubrique dédiée)
══════════════════════════════════════════════════════════ */
const VIS_PAGES={accueil:'Accueil',catalogue:'Catalogue',produit:'Fiche produit',panier:'Panier',checkout:'Commande',compte:'Mon compte',connexion:'Connexion',contact:'Contact',apropos:'À propos',galerie:'Lookbook'};
let visFiltre={mois:'',page:1};

function visMoisLong(m){const t=new Date(m+'-01T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'});return t.charAt(0).toUpperCase()+t.slice(1);}
function visMoisCourt(m){return new Date(m+'-01T12:00:00').toLocaleDateString('fr-FR',{month:'short',year:'2-digit'});}

async function renderVisiteurs(){
  const el=document.getElementById('page-visiteurs');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  visFiltre={mois:'',page:1};
  try{
    const r=await api('/visites/stats?mois=12');
    if(!r.ok) throw new Error('stats');
    const d=await r.json();
    const serie=(d.par_mois||[]).map(x=>({m:visMoisCourt(x.mois),v:x.visiteurs}));
    const lignes=(d.par_mois||[]).slice().reverse().map(x=>`<tr style="cursor:pointer" onclick="visFiltrerMois('${x.mois}')" title="Voir les visites de ce mois"><td>${visMoisLong(x.mois)}</td><td style="text-align:right;font-weight:600">${fmt(x.visiteurs)}</td></tr>`).join('');
    const app=(d.appareils_ce_mois||[]).map(a=>`<span class="pill pill-neutral" style="margin-right:6px">${escHtml(a.appareil)} : ${a.visiteurs}</span>`).join('');
    el.innerHTML=`
      <div class="grid-4" style="grid-template-columns:repeat(4,1fr)">
        ${kpiCard("Aujourd'hui",fmt(d.aujourdhui||0),"Visiteurs uniques du jour","👀",GOLD)}
        ${kpiCard("Ce mois",fmt(d.ce_mois||0),"Mois dernier : "+fmt(d.mois_precedent||0),"📅",TERRA)}
        ${kpiCard("Total",fmt(d.total||0),"Depuis le début du suivi","🌍","#6B8E6B")}
        ${kpiCard("Appareil principal",(d.appareils_ce_mois&&d.appareils_ce_mois[0]?d.appareils_ce_mois[0].appareil:'—'),"Ce mois-ci","📱",GOLD)}
      </div>
      <div class="grid-2-1">
        <div class="card"><div class="card-title">Visiteurs par mois</div>
          ${serie.some(x=>x.v>0)?makeBarChart(serie,'v','m',GOLD,170):'<p style="color:var(--text-muted);font-size:13px;padding:20px">Aucune visite enregistrée pour le moment.</p>'}
          <div style="margin-top:10px">${app}</div>
        </div>
        <div class="card"><div class="card-title">Détail par mois</div>
          <div style="max-height:260px;overflow:auto"><table style="width:100%;font-size:13px"><thead><tr><th style="text-align:left">Mois</th><th style="text-align:right">Visiteurs</th></tr></thead><tbody>${lignes}</tbody></table></div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:8px">Un visiteur est compté une fois par jour. Cliquez sur un mois pour voir ses visites.</p>
        </div>
      </div>
      <div class="card" id="visListe" style="margin-top:16px"></div>`;
    chargerListeVisites();
  }catch(e){
    el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Impossible de charger les visiteurs. Vérifiez la connexion au serveur.</div>';
  }
}

function visFiltrerMois(m){visFiltre={mois:m||'',page:1};chargerListeVisites();}
function visPage(n){visFiltre.page=n;chargerListeVisites();}

async function chargerListeVisites(){
  const box=document.getElementById('visListe');
  if(!box) return;
  box.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    const q=new URLSearchParams({page:visFiltre.page,limite:30});
    if(visFiltre.mois) q.set('mois',visFiltre.mois);
    const r=await api('/visites?'+q.toString());
    if(!r.ok) throw new Error('liste');
    const d=await r.json();
    const lignes=(d.visites||[]).map(v=>{
      const dt=new Date(String(v.created_at).replace(' ','T'));
      return `<tr>
        <td>${isNaN(dt)?escHtml(v.jour):dt.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
        <td>${escHtml(VIS_PAGES[v.page]||v.page||'—')}</td>
        <td>${escHtml(v.appareil||'—')}</td>
        <td>${v.source?escHtml(v.source):'<span style="color:var(--text-muted)">Accès direct</span>'}</td>
      </tr>`;}).join('');
    const titre=visFiltre.mois?('Visites — '+visMoisLong(visFiltre.mois)):'Dernières visites';
    const retirer=visFiltre.mois?`<button class="btn btn-outline btn-sm" onclick="visFiltrerMois('')">Voir toutes les visites</button>`:'';
    const pager=d.pages>1?`<div style="display:flex;gap:10px;align-items:center;justify-content:center;margin-top:14px">
        <button class="btn btn-outline btn-sm" ${d.page<=1?'disabled':''} onclick="visPage(${d.page-1})">← Précédent</button>
        <span style="font-size:12px;color:var(--text-muted)">Page ${d.page} / ${d.pages}</span>
        <button class="btn btn-outline btn-sm" ${d.page>=d.pages?'disabled':''} onclick="visPage(${d.page+1})">Suivant →</button>
      </div>`:'';
    box.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div class="card-title" style="margin:0">${titre} <span style="font-weight:400;color:var(--text-muted);font-size:12px">(${fmt(d.total)})</span></div>${retirer}
      </div>
      ${lignes?`<div style="overflow:auto"><table style="width:100%;font-size:13px"><thead><tr><th style="text-align:left">Date et heure</th><th style="text-align:left">Page d'arrivée</th><th style="text-align:left">Appareil</th><th style="text-align:left">Provenance</th></tr></thead><tbody>${lignes}</tbody></table></div>`:'<p style="color:var(--text-muted);font-size:13px;padding:10px 0">Aucune visite.</p>'}
      ${pager}`;
  }catch(e){
    box.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-muted)">Impossible de charger la liste des visites.</div>';
  }
}

/* ══════════════════════════════════════════════════════════
   ACTIONS
══════════════════════════════════════════════════════════ */

async function voirCommande(id){
  try{
    const r=await api('/commandes/'+id);
    const d=await r.json();
    const o=d.commande||d;
    const lignes=(o.lignes||[]);
    window.__lignesMesures=window.__lignesMesures||{};
    const lignesHTML=lignes.map(function(l){
      var dateEvt=l.date_evenement?('<span class="event-date-badge">\uD83D\uDCC5 '+new Date(l.date_evenement).toLocaleDateString('fr-DZ')+'</span>'):'';
      var daysLeft=l.date_evenement?Math.ceil((new Date(l.date_evenement)-new Date())/(1000*60*60*24)):null;
      var urgentBadge=(daysLeft!=null&&daysLeft<=14&&daysLeft>=0)?('<span class="event-date-badge urgent-badge">\u26A1 '+daysLeft+'j restants</span>'):'';
      var mesuresLink='';
      if(l.mesures&&Object.keys(l.mesures).length){
        window.__lignesMesures[l.id]=l.mesures;
        mesuresLink='<br><a onclick="voirMesuresLigne(\''+l.id+'\',\''+o.id+'\',\''+escHtml(l.produit_nom||'').replace(/'/g,"\\'")+'\')" style="cursor:pointer;color:var(--accent,#C9A84C);font-size:11px;text-decoration:underline;white-space:nowrap">📏 mesures</a>';
      }
      return '<tr>'
        +'<td><img src="'+(l.image_url||'https://placehold.co/40x40/f1e9dc/8a7256?text=%E2%80%94')+'" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"/></td>'
        +'<td>'+escHtml(l.produit_nom||'')+'</td>'
        +'<td style="text-align:center">'+(l.produit_taille||'—')+mesuresLink+'</td>'
        +'<td style="text-align:center">'+(l.produit_couleur||'—')+'</td>'
        +'<td style="text-align:center">'+l.quantite+'</td>'
        +'<td style="text-align:right">'+fmt(l.prix_unitaire)+' DA</td>'
        +'<td>'+dateEvt+' '+urgentBadge+'</td>'
        +'</tr>';
    }).join('');
    // Adresse de livraison + infos wilaya/mode de livraison, saisies par le
    // client au checkout et conservées dans adresse_snapshot (JSON).
    let snap=o.adresse_snapshot||{};
    if(typeof snap==='string'){ try{snap=JSON.parse(snap);}catch(_){snap={};} }
    const telephone=o.invite_telephone||o.utilisateur_telephone||snap.telephone||'';
    const wilayaNom=snap.wilaya_code?(NOMS_WILAYAS_DZ[snap.wilaya_code]||('Wilaya '+snap.wilaya_code)):'';
    const modeLivraison=snap.type_livraison==='stopdesk'?'Stop Desk (retrait en agence)':(snap.wilaya_code?'Livraison à domicile':'');
    const adresseLigne1=[snap.rue,snap.complement].filter(Boolean).join(', ');
    const adresseLigne2=[snap.ville,wilayaNom,snap.pays].filter(Boolean).join(', ');
    const methodePaiementLabel={a_la_livraison:'Paiement à la livraison',a_convenir_france:'À convenir (client France)'}[o.methode_paiement]||o.methode_paiement||'—';
    const codePromoTxt=o.code_promo_code?(' ('+escHtml(o.code_promo_code)+')'):'';

    showModal('Commande '+escHtml(o.numero||''),
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">'
      +'<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Client</div><div class="fw6">'+(o.utilisateur_prenom||'')+' '+(o.utilisateur_nom||'')+'</div><div style="font-size:12px;color:var(--text-muted)">'+(o.utilisateur_email||'')+'</div>'+(telephone?'<div style="font-size:12px;color:var(--text-muted)">📞 '+escHtml(telephone)+'</div>':'')+'</div>'
      +'<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Statut</div>'+statusPill(o.statut)+'</div>'
      +'<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Adresse de livraison</div><div style="font-size:13px">'+(adresseLigne1?escHtml(adresseLigne1)+'<br>':'')+escHtml(adresseLigne2)+'</div>'+(modeLivraison?'<div style="font-size:12px;color:var(--accent,#C9A84C);margin-top:2px">🚚 '+modeLivraison+'</div>':'')+'</div>'
      +'<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Paiement</div><div style="font-size:13px">'+escHtml(methodePaiementLabel)+'</div></div>'
      +'<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Date commande</div><div>'+new Date(o.created_at).toLocaleDateString('fr-DZ')+'</div></div>'
      +'<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Total</div><div class="fw6" style="font-size:18px">'+fmt(o.total)+' DA</div>'+(o.devise_affichee==='EUR'?'<div style="font-size:12px;color:var(--text-muted)">🇫🇷 Client France'+(o.total_devise_affichee?' — ~'+Number(o.total_devise_affichee).toFixed(2)+' € indicatif':'')+' · à recontacter pour le règlement</div>':'')+'</div>'
      +'</div>'
      +'<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);background:var(--bg-alt,#f7f7f7);border-radius:8px;padding:10px 14px;margin-bottom:16px">'
      +'<div>Sous-total : <strong style="color:var(--text)">'+fmt(o.sous_total)+' DA</strong></div>'
      +(o.remise>0?'<div>Remise'+codePromoTxt+' : <strong style="color:var(--text)">-'+fmt(o.remise)+' DA</strong></div>':'')
      +'<div>Livraison : <strong style="color:var(--text)">'+(o.frais_livraison>0?fmt(o.frais_livraison)+' DA':'Gratuite')+'</strong></div>'
      +'</div>'
      +(o.note_client?('<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Note du client</div><div style="font-size:13px;background:var(--bg-alt,#f7f7f7);border-radius:8px;padding:10px 14px;white-space:pre-wrap">'+escHtml(o.note_client)+'</div></div>'):'')
      +'<table style="width:100%;border-collapse:collapse;font-size:13px">'
      +'<thead><tr style="border-bottom:1px solid var(--border)">'
      +'<th style="width:48px"></th>'
      +'<th style="text-align:left;padding:6px 4px">Produit</th>'
      +'<th style="text-align:center">Taille</th>'
      +'<th style="text-align:center">Couleur</th>'
      +'<th style="text-align:center">Qté</th>'
      +'<th style="text-align:right">Prix</th>'
      +'<th>📅 Événement</th>'
      +'</tr></thead>'
      +'<tbody>'+lignesHTML+'</tbody>'
      +'</table>'
      +'<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">'
      +(o.statut==='en_attente'?'<button class="btn btn-terra btn-sm" onclick="updateOrder(\''+o.id+'\',\'confirmee\');hideModal()">Confirmer</button>':'')
      +(o.statut==='confirmee'?'<button class="btn btn-terra btn-sm" onclick="updateOrder(\''+o.id+'\',\'en_preparation\');hideModal()">Préparer</button>':'')
      +(o.statut==='en_preparation'?'<button class="btn btn-terra btn-sm" onclick="updateOrder(\''+o.id+'\',\'expediee\');hideModal()">Expédier</button>':'')
      +(o.statut==='expediee'?'<button class="btn btn-gold btn-sm" onclick="updateOrder(\''+o.id+'\',\'livree\');hideModal()">Livrée ✓</button>':'')
      +'<button class="btn btn-ghost btn-sm" onclick="hideModal()">Fermer</button>'
      +'</div>'
    );
  }catch(e){toast('Erreur lors du chargement de la commande');}
}

async function updateOrder(id,newStatus){
  try{
    const r=await api(`/commandes/${id}/statut`,{method:'PATCH',body:JSON.stringify({statut:newStatus})});
    const d=await r.json();
    if(r.ok){toast('✓ Statut mis à jour → '+newStatus);renderCommandes();}
    else toast(d.message||'Erreur lors de la mise à jour');
  }catch(e){toast('Erreur réseau');}
}
// DELETE /api/produits/:id?force=true → suppression physique en base
//   (voir produits.controller.js : sans ?force=true, le backend ne fait
//   qu'une désactivation douce actif=0. Ici on veut une vraie suppression.)
async function deleteProduit(id,nom){
  if(!confirm(`Supprimer définitivement le produit "${nom}" ?\nCette action est irréversible : le produit, ses variantes, ses images et ses avis seront supprimés de la base de données.`))return;
  try{
    const r=await api(`/produits/${id}?force=true`,{method:'DELETE'});
    if(r.ok){toast('Produit supprimé définitivement');renderProduits();}
    else{let msg='Erreur';try{const d=await r.json();msg=d.message||msg;}catch(_){}toast(msg);}
  }catch(e){toast('Erreur réseau');}
}
async function voirClient(id){
  try{
    const r=await api(`/utilisateurs/${id}`);
    const d=await r.json();
    const u=d.utilisateur||{};
    showModal('Détail client',`
      <div style="display:flex;flex-direction:column;gap:10px;font-size:14px">
        <div><strong>${u.prenom||''} ${u.nom||''}</strong> — ${u.email||''}</div>
        <div style="color:var(--text-muted)">${u.telephone||'Pas de téléphone'}</div>
        <div style="display:flex;gap:24px;margin-top:8px">
          <div><div style="font-size:11px;color:var(--text-muted)">Commandes</div><div style="font-size:20px;font-weight:700;color:var(--accent)">${u.nb_commandes||0}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Total dépensé</div><div style="font-size:20px;font-weight:700;color:var(--accent)">${fmt(u.total_depense||0)} DA</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Avis</div><div style="font-size:20px;font-weight:700;color:var(--accent)">${u.nb_avis||0}</div></div>
        </div>
        <div style="color:var(--text-muted);font-size:12px">Inscrit le ${u.created_at?new Date(u.created_at).toLocaleDateString('fr-DZ'):'—'}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;gap:8px">
        <button class="btn btn-ghost" onclick="hideModal()">Fermer</button>
        <button class="btn btn-terra" onclick="deleteClient('${u.id}','${(u.prenom||'').replace(/'/g,"\\'")} ${(u.nom||'').replace(/'/g,"\\'")}');hideModal()">Supprimer</button>
      </div>`);
  }catch(e){toast('Erreur lors du chargement');}
}
async function deleteClient(id,nom){
  if(!confirm(`Supprimer le compte de "${nom}" ? Cette action est irréversible.`))return;
  try{
    const r=await api(`/utilisateurs/${id}`,{method:'DELETE'});
    const d=await r.json();
    if(r.ok){toast('✓ Compte supprimé');renderClients();}
    else toast(d.message||'Erreur');
  }catch(e){toast('Erreur réseau');}
}
async function deleteCat(id,nom){
  if(!confirm(`Supprimer la catégorie "${nom}" ?`))return;
  try{
    const r=await api(`/categories/${id}`,{method:'DELETE'});
    const d=await r.json();
    if(r.ok){toast('✓ Catégorie supprimée');renderCategories();}
    else toast(d.message||'Erreur');
  }catch(e){toast('Erreur réseau');}
}
async function togglePromo(id,actif){
  try{
    const r=await api(`/codes-promo/${id}`,{method:'PATCH',body:JSON.stringify({actif})});
    if(r.ok){toast(actif?'✓ Code activé':'Code désactivé');renderPromos();}
    else{const d=await r.json();toast(d.message||'Erreur');}
  }catch(e){toast('Erreur réseau');}
}
async function deletePromo(id,code){
  if(!confirm(`Supprimer le code "${code}" ?`))return;
  try{
    const r=await api(`/codes-promo/${id}`,{method:'DELETE'});
    if(r.ok){toast('✓ Code supprimé');renderPromos();}
    else{const d=await r.json();toast(d.message||'Erreur');}
  }catch(e){toast('Erreur réseau');}
}
async function approuverAvis(id){
  try{
    const r=await api(`/avis/${id}/approuver`,{method:'PATCH',body:JSON.stringify({approuve:true})});
    if(r.ok){toast('✓ Avis approuvé et publié');renderAvis();}
    else{const d=await r.json();toast(d.message||'Erreur');}
  }catch(e){toast('Erreur réseau');}
}
async function rejeterAvis(id){
  if(!confirm('Supprimer cet avis ?'))return;
  try{
    const r=await api(`/avis/${id}`,{method:'DELETE'});
    if(r.ok){toast('Avis supprimé');renderAvis();}
    else{const d=await r.json();toast(d.message||'Erreur');}
  }catch(e){toast('Erreur réseau');}
}

/* ══════════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════════ */
function showModal(title,body){
  document.getElementById('modalTitle').textContent=title;
  document.getElementById('modalBody').innerHTML=body;
  document.getElementById('modalOverlay').classList.add('open');
}
function hideModal(){document.getElementById('modalOverlay').classList.remove('open');}
function closeModal(e){if(e.target===document.getElementById('modalOverlay'))hideModal();}

// ✅ CORRIGÉ : signature (slug, id).
//   - slug : utilisé pour le GET /api/produits/:slug (la seule route de détail exposée par le backend)
//   - id   : UUID utilisé pour le PUT /api/produits/:id lors de la sauvegarde
//   L'ancien code passait uniquement l'UUID et l'utilisait dans le GET /api/produits/:slug,
//   ce qui produisait un 404 systématique et une modale d'édition toujours vide.
/* Calcule et affiche en direct le prix France (EUR) = prix DA × % / 100 */
function updateEurPreview(){
  const el=document.getElementById('eurPreview');
  if(!el) return;
  const prix=+document.getElementById('m-prix')?.value||0;
  const solde=+document.getElementById('m-solde')?.value||0;
  const pct=+document.getElementById('m-pourcentage-eur')?.value||0;
  if(!pct||pct<=0||!prix){ el.textContent=''; return; }
  const prixEur=(prix*pct/100).toFixed(2);
  let txt=`= ${prixEur} € en France`;
  if(solde>0){
    const soldeEur=(solde*pct/100).toFixed(2);
    txt=`= ${prixEur} € (normal) · ${soldeEur} € (promo) en France`;
  }
  el.textContent=txt;
}

let prodImages=[];

/* Noms des wilayas (affichage uniquement — voir tarifsLivraison.js côté serveur pour les tarifs) */
const NOMS_WILAYAS_DZ={
  '01':'Adrar','02':'Chlef','03':'Laghouat','04':'Oum El Bouaghi','05':'Batna',
  '06':'Béjaïa','07':'Biskra','08':'Béchar','09':'Blida','10':'Bouira',
  '11':'Tamanrasset','12':'Tébessa','13':'Tlemcen','14':'Tiaret','15':'Tizi Ouzou',
  '16':'Alger','17':'Djelfa','18':'Jijel','19':'Sétif','20':'Saïda',
  '21':'Skikda','22':'Sidi Bel Abbès','23':'Annaba','24':'Guelma','25':'Constantine',
  '26':'Médéa','27':'Mostaganem','28':"M'Sila",'29':'Mascara','30':'Ouargla',
  '31':'Oran','32':'El Bayadh','33':'Illizi','34':'Bordj Bou Arreridj','35':'Boumerdès',
  '36':'El Tarf','37':'Tindouf','38':'Tissemsilt','39':'El Oued','40':'Khenchela',
  '41':'Souk Ahras','42':'Tipaza','43':'Mila','44':'Aïn Defla','45':'Naâma',
  '46':'Aïn Témouchent','47':'Ghardaïa','48':'Relizane','49':'Timimoun','50':'Bordj Badji Mokhtar',
  '51':'Ouled Djellal','52':'Béni Abbès','53':'In Salah','54':'In Guezzam','55':'Touggourt',
  '56':'Djanet','57':"El M'Ghair",'58':'El Menia',
};

/* ── Mesures personnalisées par produit (sur mesure) ──
   Liste éditable par l'admin, propre à chaque produit — remplace les champs
   que le client doit remplir quand il choisit "Mes propres mesures" sur la
   fiche produit. Si l'admin ne personnalise rien, cette liste par défaut
   (identique à l'ancien comportement, fixe pour tous les produits) est
   utilisée automatiquement. */
const MESURES_PERSO_DEFAUT=[
  {label:'Tour de poitrine',essentiel:true},
  {label:'Tour de taille',essentiel:true},
  {label:'Tour de hanche',essentiel:true},
  {label:'Épaule'},
  {label:'Épaule à épaule'},
  {label:'Tour du bras'},
  {label:'Encolure avant'},
  {label:'Encolure arrière'},
  {label:'Épaule à taille'},
  {label:'Taille au sol'},
  {label:'Manche'},
  {label:'Longueur',essentiel:true},
  {label:'Tour de genoux'},
  {label:'Taille aux genoux'},
  {label:'Genoux au sol'},
];
let mesuresPersoData=[]; // liste en cours d'édition dans la modale produit

function renderMesuresPersoList(){
  const el=document.getElementById('mesuresPersoList');
  if(!el) return;
  el.innerHTML=mesuresPersoData.map((c,i)=>`
    <div class="mesure-perso-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <input class="form-input" style="flex:1" placeholder="Nom de la mesure (ex : Tour de poitrine)" value="${escHtml(c.label||'')}" oninput="majMesurePerso(${i},'label',this.value)"/>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);white-space:nowrap;cursor:pointer">
        <input type="checkbox" ${c.essentiel?'checked':''} onchange="majMesurePerso(${i},'essentiel',this.checked)"/> Obligatoire
      </label>
      <button type="button" class="action-btn ab-delete" title="Retirer ce champ" onclick="retirerMesurePerso(${i})">🗑️</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text-muted)">Aucun champ — le client verra la liste par défaut.</div>';
}
function ajouterMesurePerso(){
  mesuresPersoData.push({label:'',essentiel:false});
  renderMesuresPersoList();
}
function retirerMesurePerso(i){
  mesuresPersoData.splice(i,1);
  renderMesuresPersoList();
}
function majMesurePerso(i,champ,val){
  if(!mesuresPersoData[i]) return;
  mesuresPersoData[i][champ]=val;
}
function reinitialiserMesuresPerso(){
  mesuresPersoData=MESURES_PERSO_DEFAUT.map(c=>({...c}));
  renderMesuresPersoList();
}
function openProduitModal(slug=null,id=null){
  prodImages=[];
  quickCouleursSelected.clear();
  mesuresPersoData=[];
  window.__currentEditProduitId=id||null;
  let catOptions='<option value="">— Aucune catégorie —</option>';
  api('/categories?actif=all').then(r=>r.json()).then(d=>{
    (d.categories||[]).forEach(c=>{
      const el=document.getElementById('m-cat');
      if(el) el.innerHTML+='<option value="'+c.id+'">'+escHtml(c.nom)+'</option>';
    });
  }).catch(()=>{});
  showModal(id?'Modifier le produit':'Nouveau produit',`
    <div class="form-group"><label class="form-label">Nom du produit</label>
      <input class="form-input" id="m-nom" placeholder="Ex: Robe kabyle brodée"/></div>
    <div class="form-group"><label class="form-label">Description</label>
      <textarea class="form-input" id="m-desc" rows="4" placeholder="Description complète visible sur la fiche produit…" style="resize:vertical"></textarea></div>
    <div class="form-group"><label class="form-label">Prix (DA)</label>
      <input class="form-input" id="m-prix" type="number" min="0" placeholder="Prix normal du produit" oninput="updateEurPreview()"/></div>
    <div style="margin-bottom:10px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text)">
        <input type="checkbox" id="m-en-promo" onchange="onPromoToggle()"/> Ce produit est en promotion</label>
    </div>
    <div class="form-group" id="soldeBlock" style="display:none">
      <label class="form-label">Prix promo (DA)</label>
      <input class="form-input" id="m-solde" type="number" min="0" placeholder="Prix réduit, inférieur au prix normal" oninput="updateEurPreview()"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Le prix normal ci-dessus sera affiché barré, et ce prix promo sera le prix mis en avant.</div>
    </div>
    <div class="form-group">
      <label class="form-label">🇫🇷 Prix France — % du prix Algérie (DA)</label>
      <input class="form-input" id="m-pourcentage-eur" type="number" min="0.01" step="0.01" placeholder="Ex : 0.45" oninput="updateEurPreview()"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Le prix affiché en euros à vos clients de France = Prix Algérie (DA) × ce %. Laissez vide si ce produit n'est pas encore vendu en France.</div>
      <div id="eurPreview" style="font-size:13px;font-weight:600;margin-top:6px;color:var(--text)"></div>
    </div>
    <div class="form-group"><label class="form-label">Catégorie</label>
      <select class="form-select" id="m-cat"><option value="">— Aucune catégorie —</option></select></div>

    <div class="form-group">
      <label class="form-label">Type de produit</label>
      <div class="type-toggle" id="typeToggle">
        <label id="tt-sur_mesure" class="active">
          <span class="tt-title"><input type="radio" name="m-type" value="sur_mesure" checked onchange="onTypeProduitChange()"/>Sur mesure</span>
          Confectionné à la commande, pas de stock, taille/couleur au choix du client.
        </label>
        <label id="tt-stock">
          <span class="tt-title"><input type="radio" name="m-type" value="stock" onchange="onTypeProduitChange()"/>En stock</span>
          Stock réel par variante (taille × couleur), décrémenté à la commande.
        </label>
      </div>
    </div>

    <div class="form-group" id="mesuresPersoBlock" style="display:none">
      <label class="form-label">Mesures à demander au client (« Mes propres mesures »)</label>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
        Définissez ici les mesures spécifiques à ce produit (ex : une écharpe n'a pas besoin des mêmes mesures qu'une robe). Coche « Obligatoire » pour les mesures indispensables à la confection.
      </div>
      <div id="mesuresPersoList"></div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn btn-outline btn-sm" type="button" onclick="ajouterMesurePerso()">+ Ajouter une mesure</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="reinitialiserMesuresPerso()">↺ Réinitialiser à la liste par défaut</button>
      </div>
    </div>

    <div class="form-group" id="variantesBlock" style="display:none">
      <label class="form-label">Variantes (taille · couleur · stock · supplément prix)</label>

      <div class="quick-couleurs-box">
        <div class="quick-couleurs-title">🎨 Ajout rapide — couleurs disponibles pour une taille</div>
        <div class="quick-couleurs-hint">Choisissez une taille, cochez les couleurs disponibles pour cette taille et indiquez le nombre de robes disponibles pour chaque couleur, puis ajoutez : une ligne de variante sera créée par couleur avec son propre stock.</div>
        <div class="quick-couleurs-grid" id="quickCouleursGrid"></div>
        <div class="quick-couleurs-row">
          <select id="qc-taille"><option value="">— Taille —</option>${TAILLES_STD.map(function(t){return '<option value="'+t+'">'+t+'</option>';}).join('')}</select>
          <input id="qc-supp" type="number" min="0" step="50" placeholder="+Prix (optionnel, appliqué à toutes)" value="0" style="width:220px"/>
          <button class="btn btn-terra btn-sm" type="button" onclick="ajouterCouleursRapides()">+ Ajouter ces couleurs pour cette taille</button>
        </div>
      </div>

      <div id="variantes-list"></div>
      <button class="btn btn-outline btn-sm" type="button" onclick="ajouterVarianteRow()">+ Ajouter une variante manuelle</button>
    </div>

    <div class="form-group">
      <label class="form-label">Images du produit</label>
      <div id="img-preview-grid" class="img-preview-grid" style="display:none"></div>
      <div class="img-upload-zone" id="imgDropZone" onclick="document.getElementById('imgFileInput').click()" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleImgDrop(event)">
        <div style="font-size:22px;margin-bottom:6px">🖼</div>
        <div style="font-size:13px;color:var(--text-muted)">Glissez des images ici ou cliquez pour choisir</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">JPG, PNG, WebP · max 5 Mo</div>
      </div>
      <input type="file" id="imgFileInput" accept="image/*" multiple style="display:none" onchange="handleImgSelect(event)"/>
      <div class="form-group" style="margin-top:8px"><label class="form-label">Ou saisir une URL Cloudinary / externe</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="m-img-url" placeholder="https://res.cloudinary.com/…"/>
          <button class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="ajouterImageUrl()">Ajouter</button>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:20px;margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text)">
        <input type="checkbox" id="m-actif" checked/> Produit actif</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text)">
        <input type="checkbox" id="m-feat"/> En vedette</label>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="hideModal()">Annuler</button>
      <button class="btn btn-terra" id="btnSaveProduit" onclick="saveProduit('${id||''}')">Enregistrer</button>
    </div>`);
  if(slug){
    api(`/produits/${encodeURIComponent(slug)}`).then(r=>r.json()).then(d=>{
      const p=d.produit||d;
      document.getElementById('m-nom').value=p.nom||'';
      document.getElementById('m-prix').value=p.prix||'';
      document.getElementById('m-solde').value=p.prix_solde||'';
      document.getElementById('m-en-promo').checked=!!(p.prix_solde!=null&&p.prix_solde!=='');
      onPromoToggle();
      document.getElementById('m-pourcentage-eur').value=p.pourcentage_eur||'';
      updateEurPreview();
      document.getElementById('m-desc').value=p.description||'';
      document.getElementById('m-actif').checked=!!p.actif;
      document.getElementById('m-feat').checked=!!p.featured;
      // Type de produit + variantes
      const type=p.type_produit==='stock'?'stock':'sur_mesure';
      const radio=document.querySelector('input[name="m-type"][value="'+type+'"]');
      if(radio){radio.checked=true;}
      onTypeProduitChange();
      if(type==='stock') chargerVariantesModal(p.variantes||[]);
      // Mesures personnalisées (uniquement pertinent pour "sur_mesure") :
      // on reprend celles déjà enregistrées pour ce produit, ou à défaut
      // la liste par défaut, pour que l'admin parte de quelque chose de
      // cohérent plutôt que d'un formulaire vide.
      if(type==='sur_mesure'){
        mesuresPersoData=(p.champs_mesures&&p.champs_mesures.length)
          ? p.champs_mesures.map(c=>({label:c.label,essentiel:!!c.essentiel}))
          : MESURES_PERSO_DEFAUT.map(c=>({...c}));
        renderMesuresPersoList();
      }
      // Load categorie
      setTimeout(function(){
        const sel=document.getElementById('m-cat');
        if(sel&&p.categorie_id){sel.value=p.categorie_id;}
      },200);
      // Load existing images
      if(p.images&&Array.isArray(p.images)){
        prodImages=p.images.map(img=>typeof img==='string'?{url:img,principale:false}:img);
        if(prodImages.length) prodImages[0].principale=true;
        renderImgPreview();
      } else if(p.image_url){
        prodImages=[{url:p.image_url,principale:true}];
        renderImgPreview();
      }
    }).catch(()=>{toast('Impossible de charger le produit');});
  } else {
    onTypeProduitChange();
  }
}
function onPromoToggle(){
  const checked=document.getElementById('m-en-promo').checked;
  const block=document.getElementById('soldeBlock');
  if(block) block.style.display=checked?'block':'none';
  if(!checked){
    const solde=document.getElementById('m-solde');
    if(solde) solde.value='';
  }
}
function onTypeProduitChange(){
  const type=(document.querySelector('input[name="m-type"]:checked')||{}).value||'sur_mesure';
  document.getElementById('tt-sur_mesure').classList.toggle('active',type==='sur_mesure');
  document.getElementById('tt-stock').classList.toggle('active',type==='stock');
  const block=document.getElementById('variantesBlock');
  if(block){
    block.style.display=type==='stock'?'block':'none';
    if(type==='stock'){
      renderQuickCouleursGrid();
      if(!document.getElementById('variantes-list').children.length){
        chargerVariantesModal();
      }
    }
  }
  const mesuresBlock=document.getElementById('mesuresPersoBlock');
  if(mesuresBlock){
    mesuresBlock.style.display=type==='sur_mesure'?'block':'none';
    if(type==='sur_mesure' && !mesuresPersoData.length){
      mesuresPersoData=MESURES_PERSO_DEFAUT.map(c=>({...c}));
      renderMesuresPersoList();
    }
  }
}
function handleImgSelect(e){
  const files=Array.from(e.target.files||[]);
  files.forEach(f=>{
    if(f.size>5*1024*1024){toast('Image trop lourde (max 5 Mo)');return;}
    const reader=new FileReader();
    reader.onload=ev=>{
      prodImages.push({url:ev.target.result,principale:prodImages.length===0,file:f});
      renderImgPreview();
    };
    reader.readAsDataURL(f);
  });
}
function handleImgDrop(e){
  e.preventDefault();document.getElementById('imgDropZone').classList.remove('drag-over');
  const files=Array.from(e.dataTransfer.files||[]).filter(f=>f.type.startsWith('image/'));
  const fakeEvt={target:{files}};handleImgSelect(fakeEvt);
}
function ajouterImageUrl(){
  const url=document.getElementById('m-img-url').value.trim();
  if(!url){toast('URL vide');return;}
  prodImages.push({url,principale:prodImages.length===0});
  document.getElementById('m-img-url').value='';
  renderImgPreview();
}
function renderImgPreview(){
  const grid=document.getElementById('img-preview-grid');
  if(!grid)return;
  if(prodImages.length===0){grid.style.display='none';return;}
  grid.style.display='grid';
  grid.innerHTML=prodImages.map((img,i)=>`
    <div class="img-thumb">
      <img src="${escHtml(img.url)}" onerror="this.style.opacity='.3'" loading="lazy"/>
      ${img.principale?'<span class="img-thumb-main">Principale</span>':''}
      <button class="img-thumb-del" onclick="removeImg(${i})">✕</button>
      ${!img.principale?`<button style="position:absolute;bottom:4px;left:4px;background:rgba(26,11,5,.6);border:none;border-radius:4px;font-size:9px;color:#fff;padding:2px 4px;cursor:pointer" onclick="setMainImg(${i})">★</button>`:''}
    </div>`).join('');
}
function removeImg(i){prodImages.splice(i,1);if(prodImages.length)prodImages[0].principale=true;renderImgPreview();}
function setMainImg(i){prodImages.forEach((img,j)=>img.principale=j===i);renderImgPreview();}
async function saveProduit(id){
  const nom=document.getElementById('m-nom').value.trim();
  if(!nom){toast('Le nom est requis');return;}
  const btnSave=document.getElementById('btnSaveProduit');
  if(btnSave){
    if(btnSave.disabled) return; // déjà en cours d'envoi — ignore les clics/doubles-clics suivants
    btnSave.disabled=true;
    btnSave.textContent='Enregistrement…';
  }
  // On n'envoie dans le JSON que les images déjà en ligne (URL saisie manuellement).
  // Les fichiers locaux (prodImages[i].file) seront uploadés séparément après coup.
  const imageUrls=prodImages.filter(img=>!img.file&&img.url).map(img=>img.url);
  const filesToUpload=prodImages.filter(img=>img.file);
  const prixSolde=+document.getElementById('m-solde').value||null;
  const catVal=document.getElementById('m-cat')?.value||null;
  const imagesPayload=imageUrls.map((url,i)=>({url,alt:nom,ordre:i,principale:i===0}));
  const type_produit=(document.querySelector('input[name="m-type"]:checked')||{}).value||'sur_mesure';
  let variantes=[];
  if(type_produit==='stock'){
    variantes=Array.from(document.querySelectorAll('#variantes-list .variante-row')).map(row=>({
      taille:row.querySelector('.v-taille')?.value||null,
      couleur:row.querySelector('.v-couleur')?.value.trim()||null,
      couleur_hex:row.querySelector('.v-hex')?.value||null,
      stock:+row.querySelector('.v-stock')?.value||0,
      prix_supplement:+row.querySelector('.v-supp')?.value||0,
      mesures:lireMesuresRow(row),
    })).filter(v=>v.taille||v.couleur);
    if(!variantes.length){toast('Ajoutez au moins une variante (taille/couleur) pour un produit en stock');if(btnSave){btnSave.disabled=false;btnSave.textContent='Enregistrer';}return;}
  }
  const pourcentageEurVal=document.getElementById('m-pourcentage-eur')?.value;
  const pourcentageEur=(pourcentageEurVal!==undefined&&pourcentageEurVal!=='')?+pourcentageEurVal:null;
  const data={nom,prix:+document.getElementById('m-prix').value||0,pourcentage_eur:pourcentageEur,description:document.getElementById('m-desc').value,actif:document.getElementById('m-actif').checked,featured:document.getElementById('m-feat').checked,
    categorie_id:catVal,images:imagesPayload,type_produit,variantes};
  // Mesures personnalisées : uniquement pertinent pour un produit "sur
  // mesure". On envoie explicitement un tableau vide si l'admin a tout
  // supprimé, pour que le serveur revienne à la grille par défaut.
  if(type_produit==='sur_mesure'){
    data.champs_mesures=mesuresPersoData.filter(c=>(c.label||'').trim());
  }
  // On n'envoie prix_solde que si le produit est réellement en promo (valeur positive).
  // Sinon on omet complètement la clé : certains backends valident "prix_solde doit être
  // un nombre positif" dès que la clé est présente, même avec la valeur null, ce qui
  // bloquait l'enregistrement des produits sans promotion.
  if(prixSolde!=null && prixSolde>0){
    data.prix_solde=prixSolde;
  }
  try{
    const url=id?`/produits/${id}`:`/produits`;
    const r=await api(url,{method:id?'PUT':'POST',body:JSON.stringify(data)});
    const d=await r.json();
    if(!r.ok){
      const detail=Array.isArray(d.erreurs)&&d.erreurs.length?(': '+d.erreurs.map(e=>e.message).join(' | ')):'';
      toast((d.message||'Erreur')+detail);
      if(btnSave){btnSave.disabled=false;btnSave.textContent='Enregistrer';}
      return;
    }

    // ID du produit (nouveau ou existant) pour uploader les images locales
    const produitId=id||d.produit?.id;

    // Si on modifie un produit existant de type "stock", synchroniser les
    // variantes une par une (l'endpoint PUT /produits/:id ne les gère pas).
    if(id&&type_produit==='stock'&&produitId){
      for(const row of Array.from(document.querySelectorAll('#variantes-list .variante-row'))){
        const varianteId=row.dataset.varianteId;
        const payload={
          taille:row.querySelector('.v-taille')?.value||null,
          couleur:row.querySelector('.v-couleur')?.value.trim()||null,
          couleur_hex:row.querySelector('.v-hex')?.value||null,
          stock:+row.querySelector('.v-stock')?.value||0,
          prix_supplement:+row.querySelector('.v-supp')?.value||0,
          mesures:lireMesuresRow(row),
        };
        if(!payload.taille&&!payload.couleur) continue;
        try{
          if(varianteId){
            await api(`/produits/${produitId}/variantes/${varianteId}`,{method:'PUT',body:JSON.stringify(payload)});
          } else {
            const rv=await api(`/produits/${produitId}/variantes`,{method:'POST',body:JSON.stringify(payload)});
            const dv=await rv.json().catch(()=>({}));
            if(dv.variante?.id) row.dataset.varianteId=dv.variante.id;
          }
        }catch(e){/* on continue même si une variante échoue */}
      }
    }

    if(produitId&&filesToUpload.length){
      toast('Upload des images…');
      for(let i=0;i<filesToUpload.length;i++){
        const img=filesToUpload[i];
        const fd=new FormData();
        fd.append('image',img.file);
        fd.append('principale',img.principale?'1':'0');
        fd.append('ordre',String(i));
        try{
          const h={};
          if(state.token) h['Authorization']=`Bearer ${state.token}`;
          const ru=await fetch(`${API}/produits/${produitId}/images`,{method:'POST',headers:h,body:fd});
          const dd=await ru.json().catch(()=>({}));
          if(!ru.ok){toast(dd.message||`Échec upload image ${i+1}`);}
        }catch(e){toast(`Erreur réseau upload image ${i+1}`);}
      }
    }

    hideModal();renderProduits();toast('✓ Produit enregistré');
  }catch(e){toast('Erreur réseau');if(btnSave){btnSave.disabled=false;btnSave.textContent='Enregistrer';}}
}

async function openCatModal(){
  const rC=await api('/categories?actif=all').catch(()=>({json:()=>({categories:[]})}));
  const dC=await rC.json();
  const cats=(dC.categories||[]).filter(c=>!c.parent_id);
  showModal('Nouvelle catégorie',`
    <div class="form-group"><label class="form-label">Nom</label>
      <input class="form-input" id="c-nom" placeholder="Ex: Robes de cérémonie"/></div>
    <div class="form-group"><label class="form-label">Catégorie parente</label>
      <select class="form-select" id="c-parent">
        <option value="">— Catégorie principale —</option>
        ${cats.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
      </select></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="hideModal()">Annuler</button>
      <button class="btn btn-terra" onclick="saveCat()">Créer</button>
    </div>`);
}
async function saveCat(){
  const nom=document.getElementById('c-nom').value.trim();
  if(!nom){toast('Le nom est requis');return;}
  const parent_id=document.getElementById('c-parent').value||null;
  try{
    const r=await api('/categories',{method:'POST',body:JSON.stringify({nom,parent_id,active:true})});
    const d=await r.json();
    if(r.ok){hideModal();renderCategories();toast('✓ Catégorie créée');}
    else toast(d.message||'Erreur');
  }catch(e){toast('Erreur réseau');}
}
function openEditCatModal(id,nom,parentId,active){
  showModal('Modifier la catégorie',`
    <div class="form-group"><label class="form-label">Nom</label>
      <input class="form-input" id="ce-nom" value="${nom}"/></div>
    <div style="display:flex;gap:20px;margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text)">
        <input type="checkbox" id="ce-active" ${active==='true'?'checked':''}/> Active</label>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="hideModal()">Annuler</button>
      <button class="btn btn-terra" onclick="updateCat('${id}')">Enregistrer</button>
    </div>`);
}
async function updateCat(id){
  const nom=document.getElementById('ce-nom').value.trim();
  const active=document.getElementById('ce-active').checked;
  try{
    const r=await api(`/categories/${id}`,{method:'PUT',body:JSON.stringify({nom,active})});
    const d=await r.json();
    if(r.ok){hideModal();renderCategories();toast('✓ Catégorie mise à jour');}
    else toast(d.message||'Erreur');
  }catch(e){toast('Erreur réseau');}
}

function openPromoModal(){
  showModal('Nouveau code promo',`
    <div class="form-group"><label class="form-label">Code promo</label>
      <input class="form-input" id="pr-code" placeholder="KABYLE20" maxlength="50" oninput="this.value=cleanPromoCode(this.value)"/><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Lettres, chiffres, tirets (-) et underscores (_) uniquement.</div></div>
    <div class="form-group"><label class="form-label">Type de remise</label>
      <select class="form-select" id="pr-type" onchange="togglePromoVal()">
        <option value="pourcentage">Pourcentage (%)</option>
        <option value="montant_fixe">Montant fixe (DA)</option>
        <option value="livraison_gratuite">Livraison gratuite</option>
      </select></div>
    <div class="form-grid-2">
      <div class="form-group" id="pr-val-wrap"><label class="form-label" id="pr-val-lbl">Valeur (%)</label>
        <input class="form-input" id="pr-val" type="number" placeholder="20"/></div>
      <div class="form-group"><label class="form-label">Montant minimum (DA)</label>
        <input class="form-input" id="pr-min" type="number" placeholder="5000"/></div>
    </div>
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label">Max utilisations</label>
        <input class="form-input" id="pr-max" type="number" placeholder="Illimité"/></div>
      <div class="form-group"><label class="form-label">Date d'expiration</label>
        <input class="form-input" id="pr-exp" type="date"/></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="hideModal()">Annuler</button>
      <button class="btn btn-terra" onclick="savePromo()">Créer le code</button>
    </div>`);
}
function togglePromoVal(){
  const t=document.getElementById('pr-type').value;
  const wrap=document.getElementById('pr-val-wrap');
  const lbl=document.getElementById('pr-val-lbl');
  if(t==='livraison_gratuite'){wrap.style.display='none';}
  else{wrap.style.display='';lbl.textContent=t==='pourcentage'?'Valeur (%)':'Valeur (DA)';}
}
function cleanPromoCode(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,'-').replace(/[^A-Z0-9_-]/g,'');
}
function msgErreurApi(d){
  if(d&&Array.isArray(d.erreurs)&&d.erreurs.length) return d.erreurs.map(e=>e.message).join(' · ');
  return (d&&d.message)||'Erreur';
}
async function savePromo(){
  const code=cleanPromoCode(document.getElementById('pr-code').value);
  document.getElementById('pr-code').value=code;
  if(code.length<2){toast('Le code doit contenir au moins 2 caractères (lettres, chiffres, - ou _).');return;}
  const type_remise=document.getElementById('pr-type').value;
  let valeur=1;
  if(type_remise!=='livraison_gratuite'){
    valeur=parseFloat(document.getElementById('pr-val').value);
    if(!(valeur>0)){toast(type_remise==='pourcentage'?'Indiquez un pourcentage supérieur à 0.':'Indiquez un montant supérieur à 0.');return;}
    if(type_remise==='pourcentage'&&valeur>100){toast('Un pourcentage ne peut pas dépasser 100.');return;}
  }
  const minRaw=document.getElementById('pr-min').value;
  const maxRaw=document.getElementById('pr-max').value;
  const montant_minimum=minRaw!==''?parseFloat(minRaw):null;
  if(montant_minimum!==null&&!(montant_minimum>=0)){toast('Le montant minimum doit être un nombre positif.');return;}
  const utilisations_max=maxRaw!==''?parseInt(maxRaw,10):null;
  if(utilisations_max!==null&&!(utilisations_max>=1)){toast('Le nombre maximum d\'utilisations doit être au moins 1 (laissez vide pour illimité).');return;}
  const data={
    code,type_remise,valeur,
    montant_minimum:montant_minimum||null,
    utilisations_max,
    expire_le:document.getElementById('pr-exp').value||null,
    actif:true
  };
  try{
    const r=await api('/codes-promo',{method:'POST',body:JSON.stringify(data)});
    const d=await r.json().catch(()=>({}));
    if(r.ok){hideModal();renderPromos();toast('✓ Code promo créé');}
    else toast(msgErreurApi(d));
  }catch(e){toast('Erreur réseau');}
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION & THEME
══════════════════════════════════════════════════════════ */
function navigate(pageId,pushHistory=true){
  state.page=pageId;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+pageId).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===pageId));
  document.getElementById('topbarTitle').textContent=TITLES[pageId]||pageId;
  const renderers={dashboard:renderDashboard,produits:renderProduits,commandes:renderCommandes,clients:renderClients,utilisateurs:renderUtilisateurs,categories:renderCategories,promos:renderPromos,avis:renderAvis,messages:renderMessages,newsletter:renderNewsletter,stats:renderStats,visiteurs:renderVisiteurs,journaux:renderJournaux,notifications:renderNotifications,parametres:renderParametres};
  if(renderers[pageId]) renderers[pageId]();
  if(pushHistory && location.hash!=='#'+pageId){
    history.pushState({page:pageId},'','#'+pageId);
  }
  closeSidebar();
}
function toggleSidebar(){
  const sb=document.querySelector('.sidebar');
  const ov=document.getElementById('sidebarOverlay');
  const burger=document.getElementById('sbBurger');
  if(!sb) return;
  const opening=!sb.classList.contains('open');
  sb.classList.toggle('open',opening);
  if(ov) ov.classList.toggle('open',opening);
  if(burger) burger.classList.toggle('open',opening);
  document.body.classList.toggle('sidebar-locked',opening);
}
function closeSidebar(){
  const sb=document.querySelector('.sidebar');
  const ov=document.getElementById('sidebarOverlay');
  const burger=document.getElementById('sbBurger');
  if(sb) sb.classList.remove('open');
  if(ov) ov.classList.remove('open');
  if(burger) burger.classList.remove('open');
  document.body.classList.remove('sidebar-locked');
}
window.addEventListener('resize',()=>{ if(window.innerWidth>960) closeSidebar(); });
window.addEventListener('popstate',e=>{
  const pageId=(e.state&&e.state.page)||(location.hash?location.hash.slice(1):'dashboard');
  if(document.getElementById('admin').style.display!=='none' && document.getElementById('page-'+pageId)){
    navigate(pageId,false);
  }
});
function toggleTheme(){
  state.theme=state.theme==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme',state.theme);
  document.getElementById('btnTheme').textContent=state.theme==='light'?'🌙':'☀️';
}

/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
let toastTimer=null;
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),3000);
}

/* ══════════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════════ */
async function doLogin(){
  const email=document.getElementById('inp-email').value.trim().toLowerCase();
  const pw=document.getElementById('inp-pw').value;
  const errEl=document.getElementById('login-err');
  const btn=document.getElementById('btn-login');
  errEl.textContent='';

  btn.textContent='Connexion…';btn.disabled=true;
  try{
    const r=await fetch(`${API}/auth/connexion`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,mot_de_passe:pw})});
    const d=await r.json();
    if(r.ok&&d.access_token){
      if(!['admin','moderateur'].includes(d.utilisateur?.role)){
        errEl.textContent='Accès réservé aux administrateurs.';
        btn.textContent='Se connecter →';btn.disabled=false;return;
      }
      loginSuccess(d.access_token,d.utilisateur);
    }else{
      errEl.textContent=d.message||'Email ou mot de passe incorrect.';
      btn.textContent='Se connecter →';btn.disabled=false;
    }
  }catch{
    errEl.textContent='Impossible de contacter le serveur. Vérifiez votre connexion réseau.';
    btn.textContent='Se connecter →';btn.disabled=false;
  }
}
function loginSuccess(tok,user){
  state.token=tok;state.user=user;
  document.getElementById('login').style.display='none';
  document.getElementById('admin').style.display='block';
  document.getElementById('sbName').textContent=(user.prenom||'')+' '+(user.nom||'');
  document.getElementById('sbRole').textContent=user.role||'admin';
  document.getElementById('sbAvatar').textContent=((user.prenom||'A')[0]+((user.nom||'D')[0])).toUpperCase();
  const dot=document.getElementById('statusDot');
  const txt=document.getElementById('statusTxt');
  dot.classList.remove('demo');
  txt.textContent='API connectée';
  const startPage=(state.initialHash&&document.getElementById('page-'+state.initialHash))?state.initialHash:'dashboard';
  history.replaceState({page:startPage},'','#'+startPage);
  navigate(startPage,false);
  // Check notification badge after short delay
  setTimeout(()=>{
    api('/notifications?limite=1&non_lues=true').then(r=>r.json()).then(d=>{
      const count=d.non_lues||0;
      const badge=document.getElementById('notifBadge');
      if(count>0){badge.textContent=count>9?'9+':count;badge.style.display='flex';}
    }).catch(()=>{
      // Demo: show 2 notifications
      const badge=document.getElementById('notifBadge');
      badge.textContent='2';badge.style.display='flex';
    });
  },1000);
}
function logout(){
  state.token=null;state.user=null;
  document.getElementById('admin').style.display='none';
  document.getElementById('login').style.display='flex';
  document.getElementById('login-err').textContent='';
  document.getElementById('inp-email').value='';
  document.getElementById('inp-pw').value='';
  document.getElementById('btn-login').textContent='Se connecter →';
  document.getElementById('btn-login').disabled=false;
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════
   MESSAGES CONTACT
══════════════════════════════════════════════════════════ */
async function renderMessages(filtre=''){
  const el=document.getElementById('page-messages');
  el.innerHTML='<div class="loading-msg">Chargement des messages…</div>';
  try{
    const params=new URLSearchParams({limite:50,page:1});
    if(filtre==='non_lu')params.set('lu','false');
    if(filtre==='lu')params.set('lu','true');
    const r=await api(`/contact/messages?${params}`);
    const d=await r.json();
    if(!r.ok)throw new Error(d.message);
    const msgs=d.messages||[];
    const filtresHTML=`<div style="display:flex;gap:8px;margin-bottom:18px">
      ${['','non_lu','lu'].map(f=>`<button class="ftab${filtre===f?' active':''}" onclick="renderMessages('${f}')">${f===''?'Tous':f==='non_lu'?'Non lus':'Lus'}</button>`).join('')}
    </div>`;
    if(msgs.length===0){el.innerHTML=filtresHTML+'<p style="color:var(--text-muted)">Aucun message.</p>';return;}
    const rows=msgs.map(m=>`
      <tr style="${!m.lu?'font-weight:600':''}">
        <td>${m.prenom} ${m.nom}<div class="client-contact">${m.email}</div></td>
        <td><span class="pill pill-neutral">${m.sujet}</span></td>
        <td style="max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(m.message)}</td>
        <td>${new Date(m.created_at).toLocaleDateString('fr-FR')}</td>
        <td>${m.email_envoye?'<span class="pill pill-success">✓</span>':'<span class="pill pill-danger">✗</span>'}</td>
        <td>
          ${!m.lu?`<button class="btn-icon" title="Marquer lu" onclick="majMessage('${m.id}',{lu:true})">👁</button>`:''}
          ${!m.repondu?`<button class="btn-icon" title="Marquer répondu" onclick="majMessage('${m.id}',{repondu:true})">✅</button>`:'<span style="color:var(--text-muted);font-size:12px">Répondu</span>'}
        </td>
      </tr>`).join('');
    el.innerHTML=filtresHTML+`
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Contact</th><th>Sujet</th><th>Message</th><th>Date</th><th>Email envoyé</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }catch(e){el.innerHTML=`<p style="color:var(--danger)">${e.message||'Erreur de chargement.'}</p>`;}
}
async function majMessage(id,payload){
  const r=await api(`/contact/messages/${id}`,{method:'PATCH',body:JSON.stringify(payload)});
  if(r.ok)renderMessages();
  else toast('Erreur lors de la mise à jour.');
}

/* ══════════════════════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════════════════════ */
async function renderNotifications(){
  const el=document.getElementById('page-notifications');
  el.innerHTML='<div class="loading-msg">Chargement des notifications…</div>';
  try{
    const r=await api('/notifications?limite=50');
    const d=await r.json();
    const notifs=d.notifications||[];
    const NOTIF_ICONS={'stock_bas':'⚠️','nouvelle_commande':'📦','nouvel_avis':'⭐','commande_livree':'✅','paiement_recu':'💰','paiement_echoue':'❌','compte_cree':'👤','autre':'🔔'};
    const nonLues=notifs.filter(n=>!n.lue).length;
    const markAll=notifs.some(n=>!n.lue)?`<button class="btn btn-outline btn-sm" onclick="marquerToutesLues()">Tout marquer comme lu</button>`:'';
    const rows=notifs.length===0?'<p style="color:var(--text-muted);margin-top:20px">Aucune notification.</p>':
      notifs.map(n=>`
        <div class="notif-item ${!n.lue?'unread':''}">
          <div class="notif-icon">${(n.type==='autre'&&/^Nouveau visiteur/.test(n.titre||''))?'👀':(NOTIF_ICONS[n.type]||'🔔')}</div>
          <div style="flex:1;min-width:0">
            <div class="notif-title">${escHtml(n.titre)}</div>
            ${n.contenu?`<div class="notif-body">${escHtml(n.contenu)}</div>`:''}
            <div class="notif-time">${new Date(n.created_at).toLocaleString('fr-FR')}</div>
          </div>
          ${!n.lue?`<button class="btn-icon" title="Marquer lu" onclick="marquerLue('${n.id}')">👁</button>`:'<span style="font-size:11px;color:var(--text-muted)">Lu</span>'}
        </div>`).join('');
    el.innerHTML=`
      <div class="page-row">
        <div><span class="fw6">${nonLues}</span> non lue(s)</div>
        ${markAll}
      </div>${rows}`;
    // Update badge
    const badge=document.getElementById('notifBadge');
    if(nonLues>0){badge.textContent=nonLues>9?'9+':nonLues;badge.style.display='flex';}
    else badge.style.display='none';
  }catch(e){
    el.innerHTML='<div style="padding:20px;color:var(--text-muted)">Impossible de charger les notifications. Vérifiez la connexion au serveur.</div>';
  }
}
async function marquerLue(id){
  const r=await api(`/notifications/${id}/lue`,{method:'PATCH'});
  if(r.ok)renderNotifications(); else toast('Erreur lors de la mise à jour');
}
async function marquerToutesLues(){
  const r=await api('/notifications/lire-tout',{method:'PATCH'});
  if(r.ok)renderNotifications(); else toast('Erreur lors de la mise à jour');
}

/* ══════════════════════════════════════════════════════════
   UTILISATEURS & RÔLES
══════════════════════════════════════════════════════════ */
async function renderUtilisateurs(search=''){
  const el=document.getElementById('page-utilisateurs');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    let url='/utilisateurs?limite=100';
    if(search) url+=`&recherche=${encodeURIComponent(search)}`;
    const r=await api(url);
    const d=await r.json();
    const users=d.utilisateurs||[];
    function roleHtml(role){return role==='admin'?`<span class="role-admin">admin</span>`:role==='moderateur'?`<span class="role-moderateur">modérateur</span>`:`<span class="role-client">client</span>`;}
    const rows=users.map((u,i)=>`<tr class="${i%2?'alt':''}">
      <td><div class="fw6">${escHtml(u.prenom||'')} ${escHtml(u.nom||'')}</div><div style="font-size:11px;color:var(--text-muted)">${escHtml(u.email||'')}</div></td>
      <td>${roleHtml(u.role)}</td>
      <td>${pill(u.email_verifie?'success':'neutral',u.email_verifie?'Vérifié':'Non vérifié')}</td>
      <td style="color:var(--text-muted);font-size:12px">${new Date(u.created_at).toLocaleDateString('fr-DZ')}</td>
      <td style="white-space:nowrap">
        <select class="form-select" style="padding:4px 8px;font-size:12px;width:auto" onchange="changerRole('${u.id}',this.value,'${escHtml(u.prenom||'')} ${escHtml(u.nom||'')}')">
          <option value="client" ${u.role==='client'?'selected':''}>client</option>
          <option value="moderateur" ${u.role==='moderateur'?'selected':''}>modérateur</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>admin</option>
        </select>
      </td>
    </tr>`).join('');
    el.innerHTML=`
      <div class="page-row">
        <div class="search-wrap"><span class="search-icon">🔍</span>
          <input class="search-input" placeholder="Nom, email…" value="${search}" oninput="debouncedSearch('utilisateurs',this,renderUtilisateurs)" id="userSearch"/>
        </div>
        <span style="font-size:13px;color:var(--text-muted)">${users.length} utilisateur(s)</span>
      </div>
      <div class="api-note"><div>⚠️ <span class="api-note-title">Action sensible</span> — Les changements de rôle sont irréversibles depuis cette interface. Toute modification est journalisée.</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Utilisateur</th><th>Rôle actuel</th><th>Email</th><th>Inscrit le</th><th>Changer le rôle</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:30px">Aucun utilisateur</td></tr>'}</tbody>
      </table></div>`;
  }catch(e){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Erreur lors du chargement</div>';}
}
async function changerRole(id,newRole,nom){
  if(!confirm(`Changer le rôle de "${nom}" vers "${newRole}" ?`))return;
  try{
    const r=await api(`/utilisateurs/${id}`,{method:'PATCH',body:JSON.stringify({role:newRole})});
    const d=await r.json();
    if(r.ok){toast(`✓ Rôle de ${nom} → ${newRole}`);renderUtilisateurs();}
    else toast(d.message||'Erreur');
  }catch(e){toast('Mode démo — action simulée');}
}

/* ══════════════════════════════════════════════════════════
   STOCK & HISTORIQUE — page retirée (produits confectionnés
   sur commande, plus de gestion de stock par variante).
   Voir migration_produits_sur_commande.sql
══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   JOURNAL ADMIN (AUDIT LOG)
══════════════════════════════════════════════════════════ */
async function renderJournaux(filtre=''){
  const el=document.getElementById('page-journaux');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    let url='/journaux-admin?limite=50';
    if(filtre) url+=`&entite=${encodeURIComponent(filtre)}`;
    const r=await api(url);
    const d=await r.json();
    const journaux=d.journaux||[];
    if(journaux.length===0) throw new Error('empty');
    renderJournauxHTML(el,journaux,filtre);
  }catch(e){
    el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Impossible de charger le journal. Vérifiez la connexion au serveur.</div>';
  }
}
function renderJournauxHTML(el,journaux,filtre){
  const entites=[...new Set(journaux.map(j=>j.entite).filter(Boolean))];
  const filtresHTML=`<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center">
    <button class="ftab${!filtre?' active':''}" onclick="renderJournaux('')">Tout</button>
    ${entites.map(e=>`<button class="ftab${filtre===e?' active':''}" onclick="renderJournaux('${e}')">${e}</button>`).join('')}
    <button class="btn-export" style="margin-left:auto" onclick="exportCSV('journaux')">⬇ Export CSV</button>
  </div>`;
  const rows=journaux.map(j=>`<div class="journal-row">
    <span class="journal-action">${escHtml(j.action||'—')}</span>
    <div style="flex:1">
      <div style="font-size:12px;color:var(--text);margin-bottom:2px"><strong>${escHtml(j.admin_email||'Système')}</strong>${j.entite?` · ${escHtml(j.entite)} #${(j.entite_id||'').slice(0,8)}`:''}</div>
      ${j.details?`<div class="journal-detail" style="font-family:monospace;font-size:11px">${escHtml(j.details).slice(0,120)}</div>`:''}
      ${j.ip_address?`<div style="font-size:10px;color:var(--text-muted)">IP: ${escHtml(j.ip_address)}</div>`:''}
    </div>
    <div class="journal-time">${new Date(j.created_at).toLocaleString('fr-FR')}</div>
  </div>`).join('');
  el.innerHTML=filtresHTML+rows;
}

/* ══════════════════════════════════════════════════════════
   PARAMÈTRES DU SITE
══════════════════════════════════════════════════════════ */
let paramsData={};
/* Grille par défaut (secours hors-ligne uniquement — la vraie source de
   vérité est nodejs/src/utils/tarifsLivraison.js côté serveur). */
const TARIFS_LIVRAISON_DEFAUT=[
  {code:'01',nom:'Adrar',zone:4,delai:5,domicile:1050,stopdesk:850},
  {code:'02',nom:'Chlef',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'03',nom:'Laghouat',zone:3,delai:2,domicile:950,stopdesk:750},
  {code:'04',nom:'Oum El Bouaghi',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'05',nom:'Batna',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'06',nom:'Béjaïa',zone:1,delai:1,domicile:700,stopdesk:550},
  {code:'07',nom:'Biskra',zone:3,delai:1,domicile:950,stopdesk:750},
  {code:'08',nom:'Béchar',zone:4,delai:4,domicile:1050,stopdesk:850},
  {code:'09',nom:'Blida',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'10',nom:'Bouira',zone:1,delai:1,domicile:700,stopdesk:550},
  {code:'11',nom:'Tamanrasset',zone:5,delai:5,domicile:1600,stopdesk:1400},
  {code:'12',nom:'Tébessa',zone:3,delai:1,domicile:950,stopdesk:750},
  {code:'13',nom:'Tlemcen',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'14',nom:'Tiaret',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'15',nom:'Tizi Ouzou',zone:0,delai:1,domicile:590,stopdesk:450},
  {code:'16',nom:'Alger',zone:1,delai:1,domicile:700,stopdesk:550},
  {code:'17',nom:'Djelfa',zone:3,delai:2,domicile:950,stopdesk:750},
  {code:'18',nom:'Jijel',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'19',nom:'Sétif',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'20',nom:'Saïda',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'21',nom:'Skikda',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'22',nom:'Sidi Bel Abbès',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'23',nom:'Annaba',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'24',nom:'Guelma',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'25',nom:'Constantine',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'26',nom:'Médéa',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'27',nom:'Mostaganem',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'28',nom:"M'Sila",zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'29',nom:'Mascara',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'30',nom:'Ouargla',zone:3,delai:2,domicile:950,stopdesk:750},
  {code:'31',nom:'Oran',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'32',nom:'El Bayadh',zone:4,delai:3,domicile:1050,stopdesk:850},
  {code:'33',nom:'Illizi',zone:5,delai:6,domicile:1600,stopdesk:1400},
  {code:'34',nom:'Bordj Bou Arreridj',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'35',nom:'Boumerdès',zone:1,delai:1,domicile:700,stopdesk:550},
  {code:'36',nom:'El Tarf',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'37',nom:'Tindouf',zone:5,delai:5,domicile:1600,stopdesk:1400},
  {code:'38',nom:'Tissemsilt',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'39',nom:'El Oued',zone:3,delai:1,domicile:950,stopdesk:750},
  {code:'40',nom:'Khenchela',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'41',nom:'Souk Ahras',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'42',nom:'Tipaza',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'43',nom:'Mila',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'44',nom:'Aïn Defla',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'45',nom:'Naâma',zone:4,delai:3,domicile:1050,stopdesk:850},
  {code:'46',nom:'Aïn Témouchent',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'47',nom:'Ghardaïa',zone:3,delai:2,domicile:950,stopdesk:750},
  {code:'48',nom:'Relizane',zone:2,delai:1,domicile:900,stopdesk:650},
  {code:'49',nom:'Timimoun',zone:4,delai:5,domicile:1050,stopdesk:850},
  {code:'50',nom:'Bordj Badji Mokhtar',zone:4,delai:5,domicile:1050,stopdesk:850},
  {code:'51',nom:'Ouled Djellal',zone:3,delai:1,domicile:950,stopdesk:750},
  {code:'52',nom:'Béni Abbès',zone:4,delai:4,domicile:1050,stopdesk:850},
  {code:'53',nom:'In Salah',zone:5,delai:5,domicile:1600,stopdesk:1400},
  {code:'54',nom:'In Guezzam',zone:5,delai:5,domicile:1600,stopdesk:1400},
  {code:'55',nom:'Touggourt',zone:3,delai:2,domicile:950,stopdesk:750},
  {code:'56',nom:'Djanet',zone:5,delai:6,domicile:1600,stopdesk:1400},
  {code:'57',nom:"El M'Ghair",zone:3,delai:1,domicile:950,stopdesk:750},
  {code:'58',nom:'El Menia',zone:4,delai:5,domicile:1050,stopdesk:850},
];
let tarifsLivraisonData=TARIFS_LIVRAISON_DEFAUT;

async function renderParametres(){
  const el=document.getElementById('page-parametres');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Chargement…</div>';
  try{
    const r=await api('/parametres');
    const d=await r.json();
    paramsData=d.parametres||{};
    tarifsLivraisonData=(d.tarifs_livraison&&d.tarifs_livraison.length)?d.tarifs_livraison:TARIFS_LIVRAISON_DEFAUT;
  }catch(e){
    paramsData={
      nom_site:'Atelier S.L',email_contact:'contact@example.com',telephone_contact:'+213 XXX XXX XXX',
      frais_livraison:500,seuil_livraison_gratuite:5000,
      livraison_gratuite_active:true,soldes_active:false,maintenance_active:false,
      instagram:'https://instagram.com/ateliersl',facebook:'',
      delai_livraison:'3 à 7 jours ouvrables'
    };
    tarifsLivraisonData=TARIFS_LIVRAISON_DEFAUT;
  }
  el.innerHTML=`
    <div style="max-width:680px">
      <div class="card" style="margin-bottom:20px">
        <div class="param-section-title">Informations générales</div>
        <div class="form-group"><label class="form-label">Nom du site</label>
          <input class="form-input" id="p-nom" value="${escHtml(paramsData.nom_site||'')}"/></div>
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Email de contact</label>
            <input class="form-input" id="p-email" type="email" value="${escHtml(paramsData.email_contact||'')}"/></div>
          <div class="form-group"><label class="form-label">Téléphone</label>
            <input class="form-input" id="p-tel" value="${escHtml(paramsData.telephone_contact||'')}"/></div>
        </div>
        <div class="form-group"><label class="form-label">Délai de livraison (affiché aux clients)</label>
          <input class="form-input" id="p-delai" value="${escHtml(paramsData.delai_livraison||'')}"/></div>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="param-section-title">Livraison & Tarifs</div>
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Frais de livraison (DZD)</label>
            <input class="form-input" id="p-frais" type="number" value="${paramsData.frais_livraison||0}"/></div>
          <div class="form-group"><label class="form-label">Seuil livraison gratuite (DZD)</label>
            <input class="form-input" id="p-seuil" type="number" value="${paramsData.seuil_livraison_gratuite||0}"/></div>
        </div>
        <div class="param-row">
          <div><div class="param-label">Livraison gratuite activée</div><div class="param-desc">Offrir la livraison dès le seuil défini</div></div>
          <label class="toggle-switch"><input type="checkbox" id="p-liv-gratuite" ${paramsData.livraison_gratuite_active?'checked':''}><span class="toggle-slider"></span></label>
        </div>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="param-section-title">Grille tarifaire de livraison (Yalidine — par wilaya)</div>
        <div class="param-desc" style="margin-bottom:12px">Tarifs en DZD appliqués automatiquement selon la wilaya et le mode choisis par le client au checkout (domicile ou stop-desk). Modifie une valeur puis clique sur « Enregistrer les paramètres » en bas de page.</div>
        <div style="max-height:420px;overflow-y:auto;border:1px solid var(--border,#e5e5e5);border-radius:8px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="position:sticky;top:0;background:var(--bg-alt,#f7f7f7);z-index:1">
              <tr>
                <th style="text-align:left;padding:8px 10px">Wilaya</th>
                <th style="text-align:center;padding:8px 6px">Zone</th>
                <th style="text-align:center;padding:8px 6px">Délai (j.)</th>
                <th style="text-align:center;padding:8px 6px">Tarif domicile (DZD)</th>
                <th style="text-align:center;padding:8px 6px">Tarif stop-desk (DZD)</th>
              </tr>
            </thead>
            <tbody>
              ${tarifsLivraisonData.map(t=>`
                <tr style="border-top:1px solid var(--border,#eee)">
                  <td style="padding:6px 10px">${escHtml(t.nom||t.code)}</td>
                  <td style="text-align:center;padding:6px">${t.zone}</td>
                  <td style="text-align:center;padding:6px">${t.delai}</td>
                  <td style="padding:6px 6px"><input class="form-input" style="text-align:center" type="number" min="0" step="10" id="tl-dom-${t.code}" value="${t.domicile}"/></td>
                  <td style="padding:6px 6px"><input class="form-input" style="text-align:center" type="number" min="0" step="10" id="tl-sd-${t.code}" value="${t.stopdesk}"/></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="param-section-title">Mode du site</div>
        <div class="param-row">
          <div><div class="param-label">Soldes actives</div><div class="param-desc">Afficher la bannière promotionnelle sur la boutique</div></div>
          <label class="toggle-switch"><input type="checkbox" id="p-soldes" ${paramsData.soldes_active?'checked':''}><span class="toggle-slider"></span></label>
        </div>
        <div class="param-row">
          <div><div class="param-label" style="color:${paramsData.maintenance_active?TERRA:'var(--text)'}">Mode maintenance</div><div class="param-desc">Afficher une page d'attente aux visiteurs</div></div>
          <label class="toggle-switch"><input type="checkbox" id="p-maintenance" ${paramsData.maintenance_active?'checked':''}><span class="toggle-slider"></span></label>
        </div>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="param-section-title">Réseaux sociaux</div>
        <div class="form-group"><label class="form-label">Instagram</label>
          <input class="form-input" id="p-insta" value="${escHtml(paramsData.instagram||'')}" placeholder="https://instagram.com/ateliersl"/></div>
        <div class="form-group"><label class="form-label">Facebook</label>
          <input class="form-input" id="p-fb" value="${escHtml(paramsData.facebook||'')}" placeholder="https://facebook.com/ateliersl"/></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="renderParametres()">Réinitialiser</button>
        <button class="btn btn-terra" onclick="saveParametres()">💾 Enregistrer les paramètres</button>
      </div>
    </div>`;
}
async function saveParametres(){
  const tarifs_livraison=tarifsLivraisonData.map(t=>{
    const domEl=document.getElementById('tl-dom-'+t.code);
    const sdEl=document.getElementById('tl-sd-'+t.code);
    return {
      code: t.code,
      domicile: domEl ? (+domEl.value||0) : t.domicile,
      stopdesk: sdEl ? (+sdEl.value||0) : t.stopdesk,
    };
  });
  const data={
    nom_site:document.getElementById('p-nom').value.trim(),
    email_contact:document.getElementById('p-email').value.trim(),
    telephone_contact:document.getElementById('p-tel').value.trim(),
    delai_livraison:document.getElementById('p-delai').value.trim(),
    frais_livraison:+document.getElementById('p-frais').value||0,
    seuil_livraison_gratuite:+document.getElementById('p-seuil').value||0,
    livraison_gratuite_active:document.getElementById('p-liv-gratuite').checked,
    soldes_active:document.getElementById('p-soldes').checked,
    maintenance_active:document.getElementById('p-maintenance').checked,
    instagram:document.getElementById('p-insta').value.trim(),
    facebook:document.getElementById('p-fb').value.trim(),
    tarifs_livraison,
  };
  try{
    const r=await api('/parametres',{method:'PUT',body:JSON.stringify(data)});
    if(r.ok){
      const d=await r.json();
      if(d.tarifs_livraison&&d.tarifs_livraison.length) tarifsLivraisonData=d.tarifs_livraison;
      toast('✓ Paramètres enregistrés');
    }
    else{const d=await r.json();toast(d.message||'Erreur');}
  }catch(e){toast('Erreur réseau — paramètres non enregistrés');}
}

/* ══════════════════════════════════════════════════════════
   EXPORT CSV
══════════════════════════════════════════════════════════ */
async function exportCSV(type){
  /* maxLimite = plafond réel accepté par le backend pour ce endpoint
     (au-delà, l'API renvoie une erreur 400 de validation) */
  const EXPORTS={
    commandes: {url:'/commandes',            filename:'commandes.csv',     maxLimite:50,  params:{ordre:'DESC'}},
    clients:   {url:'/utilisateurs',         filename:'clients.csv',       maxLimite:100, params:{role:'client'}},
    produits:  {url:'/produits',             filename:'produits.csv',      maxLimite:50,  params:{}},
    newsletter:{url:'/newsletter/abonnes',   filename:'newsletter.csv',    maxLimite:100, params:{}},
    journaux:  {url:'/journaux-admin',       filename:'journaux_admin.csv',maxLimite:50,  params:{}},
  };
  const cfg=EXPORTS[type];
  if(!cfg){toast('Export non disponible');return;}
  toast('⬇ Export en cours…');
  try{
    let all=[];
    let page=1;
    const MAX_PAGES=500; // garde-fou anti boucle infinie
    while(page<=MAX_PAGES){
      const qs=new URLSearchParams({page,limite:cfg.maxLimite,...cfg.params});
      const r=await api(`${cfg.url}?${qs}`);
      if(!r.ok){
        let msg='';
        try{ const d=await r.json(); msg=d.message||(d.errors&&d.errors[0]?.msg)||''; }catch(_){}
        throw new Error(msg||`Erreur serveur (${r.status})`);
      }
      const d=await r.json();
      const arr=Object.values(d).find(v=>Array.isArray(v))||[];
      all=all.concat(arr);
      const totalPages=d.pagination?.pages ?? d.pages ?? null;
      const doitContinuer = totalPages!=null ? page<totalPages : arr.length===cfg.maxLimite;
      if(!doitContinuer) break;
      page++;
    }
    if(!all.length){toast('Aucune donnée à exporter');return;}
    const keys=Object.keys(all[0]);
    const csv=[keys.join(','),...all.map(row=>keys.map(k=>JSON.stringify(row[k]??'')).join(','))].join('\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=cfg.filename;a.click();
    URL.revokeObjectURL(a.href);
    toast(`✓ Export téléchargé : ${cfg.filename} (${all.length} ligne(s))`);
  }catch(e){
    toast('Erreur export : '+(e.message||'vérifiez la connexion au serveur'));
  }
}


/* ══════════════════════════════════════════════════════════
   MISE À JOUR NEWSLETTER avec Export CSV
══════════════════════════════════════════════════════════ */

async function renderNewsletter(filtre='actif'){
  const el=document.getElementById('page-newsletter');
  el.innerHTML='<div class="loading-msg">Chargement des abonnés…</div>';
  try{
    const params=new URLSearchParams({limite:100,page:1});
    if(filtre==='actif')params.set('actif','true');
    if(filtre==='inactif')params.set('actif','false');
    const r=await api(`/newsletter/abonnes?${params}`);
    const d=await r.json();
    if(!r.ok)throw new Error(d.message);
    const abonnes=d.abonnes||[];
    const filtresHTML=`<div style="display:flex;gap:8px;margin-bottom:18px;align-items:center;flex-wrap:wrap">
      ${['actif','inactif',''].map(f=>`<button class="ftab${filtre===f?' active':''}" onclick="renderNewsletter('${f}')">${f==='actif'?'Actifs':f==='inactif'?'Désinscrits':'Tous'}</button>`).join('')}
      <span style="margin-left:auto;font-size:13px;color:var(--text-muted)">${d.total||0} abonné(s)</span>
      <button class="btn-export" onclick="exportCSV('newsletter')">⬇ Export CSV</button>
    </div>`;
    if(abonnes.length===0){el.innerHTML=filtresHTML+'<p style="color:var(--text-muted)">Aucun abonné.</p>';return;}
    const rows=abonnes.map(a=>`
      <tr>
        <td>${escHtml(a.email)}</td>
        <td>${a.actif?'<span class="pill pill-success">Actif</span>':'<span class="pill pill-neutral">Désinscrit</span>'}</td>
        <td>${new Date(a.created_at).toLocaleDateString('fr-FR')}</td>
        <td>${a.updated_at&&a.updated_at!==a.created_at?new Date(a.updated_at).toLocaleDateString('fr-FR'):'—'}</td>
      </tr>`).join('');
    el.innerHTML=filtresHTML+`
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Email</th><th>Statut</th><th>Inscrit le</th><th>Mis à jour</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }catch(e){el.innerHTML=`<p style="color:var(--danger)">${e.message||'Erreur de chargement.'}</p>`;}
}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ══════════════════════════════════════════════════════════
   RECHERCHE — debounce + conservation du focus/curseur
   (évite de reperdre le focus du champ à chaque frappe,
   puisque renderXxx() remplace tout le innerHTML de la page,
   y compris le champ de recherche lui-même)
══════════════════════════════════════════════════════════ */
const __searchTimers={};
function debouncedSearch(key, inputEl, renderFn, delay=350){
  clearTimeout(__searchTimers[key]);
  const inputId=inputEl.id;
  const value=inputEl.value;
  const pos=inputEl.selectionStart;
  __searchTimers[key]=setTimeout(async()=>{
    await renderFn(value);
    const newInput=document.getElementById(inputId);
    if(newInput){
      newInput.focus();
      try{newInput.setSelectionRange(pos,pos);}catch(e){}
    }
  },delay);
}

/* Export CSV commandes — intégré directement dans renderCommandes() ci-dessus */

function init(){
  const nav=document.getElementById('sbNav');
  NAV.forEach(n=>{
    const btn=document.createElement('button');
    btn.className='nav-item'+(n.id==='dashboard'?' active':'');
    btn.dataset.page=n.id;
    btn.innerHTML=`<span class="nav-icon">${n.icon}</span><span class="nav-label">${n.label}</span>`;
    btn.onclick=()=>navigate(n.id);
    nav.appendChild(btn);
  });
  state.initialHash=location.hash?location.hash.slice(1):null;
  document.getElementById('btn-login').addEventListener('click',doLogin);
  document.getElementById('inp-pw').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  document.getElementById('inp-email').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('inp-pw').focus();});
}
window.addEventListener('DOMContentLoaded',init);

/* ── Variante rows in product modal ── */
const TAILLES_STD=['XS','S','M','L','XL','XXL'];
// Palette de couleurs simples proposées pour l'ajout rapide multi-couleurs
// (mêmes teintes signature + couleurs de base, alignées sur la palette
// utilisée côté boutique pour le sur mesure)
const COULEURS_RAPIDES=[
  {nom:'Or kabyle',hex:'#C9A84C'},{nom:'Bordeaux',hex:'#7B1C2A'},
  {nom:'Vert émeraude',hex:'#2E6B52'},{nom:'Bleu nuit',hex:'#1C2E5A'},
  {nom:'Blanc neige',hex:'#FFFAFA'},{nom:'Noir',hex:'#1A1A1A'},
  {nom:'Blanc cassé',hex:'#F9F5EF'},{nom:'Rose poudré',hex:'#D4A0A0'},
  {nom:'Terracotta',hex:'#B85C3A'},{nom:'Argent',hex:'#A8A9AD'},
  {nom:'Rouge',hex:'#C1272D'},{nom:'Bleu roi',hex:'#1E4D9B'},
  {nom:'Jaune moutarde',hex:'#D4A017'},{nom:'Orange',hex:'#D9752D'},
  {nom:'Violet',hex:'#6A4C93'},{nom:'Gris anthracite',hex:'#4A4A4A'},
  {nom:'Beige',hex:'#E8DCC8'},{nom:'Turquoise',hex:'#2E8B8B'},
  {nom:'Kaki',hex:'#6B6B47'},{nom:'Marron',hex:'#5C3A21'}
];
let quickCouleursSelected=new Map(); // nom -> {hex, stock}
function renderQuickCouleursGrid(){
  const grid=document.getElementById('quickCouleursGrid');
  if(!grid)return;
  grid.innerHTML=COULEURS_RAPIDES.map(function(c){
    const nomEsc=c.nom.replace(/'/g,"\\'");
    const entry=quickCouleursSelected.get(c.nom);
    if(entry){
      return '<div class="quick-couleur-chip selected">'
        +'<span class="dot" style="background:'+c.hex+'"></span>'
        +'<span onclick="toggleQuickCouleur(\''+nomEsc+'\',\''+c.hex+'\')" style="cursor:pointer">'+c.nom+'</span>'
        +'<input type="number" min="0" class="qc-chip-stock" value="'+entry.stock+'" title="Nombre de robes disponibles en '+c.nom+'" '
        +'onclick="event.stopPropagation()" oninput="updateQuickCouleurStock(\''+nomEsc+'\',this.value)"/>'
        +'</div>';
    }
    return '<div class="quick-couleur-chip" onclick="toggleQuickCouleur(\''+nomEsc+'\',\''+c.hex+'\')">'
      +'<span class="dot" style="background:'+c.hex+'"></span>'+c.nom+'</div>';
  }).join('');
}
function toggleQuickCouleur(nom,hex){
  if(quickCouleursSelected.has(nom)) quickCouleursSelected.delete(nom);
  else quickCouleursSelected.set(nom,{hex:hex,stock:5});
  renderQuickCouleursGrid();
}
function updateQuickCouleurStock(nom,value){
  const entry=quickCouleursSelected.get(nom);
  if(entry) entry.stock=Math.max(0,+value||0);
}
function ajouterCouleursRapides(){
  const taille=(document.getElementById('qc-taille')||{}).value||'';
  if(!taille){toast('Choisissez une taille pour l\'ajout rapide');return;}
  if(!quickCouleursSelected.size){toast('Cochez au moins une couleur');return;}
  const supp=+((document.getElementById('qc-supp')||{}).value)||0;
  const existantes=Array.from(document.querySelectorAll('#variantes-list .variante-row')).map(function(row){
    return (row.querySelector('.v-taille')?.value||'')+'|'+(row.querySelector('.v-couleur')?.value.trim()||'');
  });
  let ajoutees=0,ignorees=0;
  quickCouleursSelected.forEach(function(entry,nom){
    const cle=taille+'|'+nom;
    if(existantes.indexOf(cle)!==-1){ignorees++;return;}
    ajouterVarianteRow({taille:taille,couleur:nom,couleur_hex:entry.hex,stock:entry.stock,prix_supplement:supp});
    existantes.push(cle);
    ajoutees++;
  });
  quickCouleursSelected.clear();
  renderQuickCouleursGrid();
  if(ajoutees) toast('✓ '+ajoutees+' couleur'+(ajoutees>1?'s':'')+' ajoutée'+(ajoutees>1?'s':'')+' pour la taille '+taille+(ignorees?' ('+ignorees+' déjà présente(s))':''));
  else toast('Ces couleurs existent déjà pour cette taille');
}
function voirMesuresLigne(ligneId,commandeId,produitNom){
  const mesures=(window.__lignesMesures||{})[ligneId]||{};
  const items=Object.keys(mesures)
    .filter(function(k){return mesures[k]!=null && mesures[k]!=='';})
    .map(function(k){
      var connu=MESURES_FIELDS.find(function(f){return f.key===k;});
      var label=connu?connu.label:(k.charAt(0).toUpperCase()+k.slice(1)).replace(/_/g,' ');
      return {label:label,valeur:mesures[k]};
    });
  const grilleHTML=items.length
    ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">'
      +items.map(function(it){
        return '<div style="background:var(--bg-alt,#f7f7f7);border:1px solid var(--border,#eee);border-radius:10px;padding:10px 12px">'
          +'<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.02em;margin-bottom:4px">'+escHtml(it.label)+'</div>'
          +'<div style="font-size:18px;font-weight:700;color:var(--accent,#C9A84C)">'+escHtml(String(it.valeur))+'<span style="font-size:12px;color:var(--text-muted);font-weight:400"> cm</span></div>'
          +'</div>';
      }).join('')
      +'</div>'
    : '<div style="color:var(--text-muted);font-size:13px">Aucune mesure renseignée.</div>';
  showModal('📏 Mesures — '+escHtml(produitNom||''),
    grilleHTML
    +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">'
    +'<button class="btn btn-outline btn-sm" onclick="voirCommande(\''+commandeId+'\')">← Retour à la commande</button>'
    +'<button class="btn btn-ghost btn-sm" onclick="hideModal()">Fermer</button>'
    +'</div>'
  );
}
let varianteCount=0;
const MESURES_FIELDS=[
  {key:'tour_poitrine',label:'Tour de poitrine'},
  {key:'tour_taille',label:'Tour de taille'},
  {key:'tour_hanche',label:'Tour de hanche'},
  {key:'epaule',label:'Épaule'},
  {key:'epaule_a_epaule',label:'Épaule à épaule'},
  {key:'tour_bras',label:'Tour du bras'},
  {key:'encolure_avant',label:'Encolure avant'},
  {key:'encolure_arriere',label:'Encolure arrière'},
  {key:'epaule_a_taille',label:'Épaule à taille'},
  {key:'taille_au_sol',label:'Taille au sol'},
  {key:'manche',label:'Manche'},
  {key:'longueur',label:'Longueur'},
  {key:'tour_genoux',label:'Tour de genoux'},
  {key:'taille_genoux',label:'Taille aux genoux'},
  {key:'genoux_au_sol',label:'Genoux au sol'},
];
function buildMesuresFieldsHTML(mesures){
  mesures=mesures||{};
  return '<div class="vm-header">📏 Mesures (cm) pour cette taille</div>'
    +'<div class="vm-grid">'
    +MESURES_FIELDS.map(function(f){
      var val=mesures[f.key]!=null?mesures[f.key]:'';
      return '<label class="vm-field-label">'+f.label
        +'<input type="number" min="0" step="0.5" class="vm-field" data-key="'+f.key+'" value="'+val+'" placeholder="cm" oninput="majBadgeMesures(this)"></label>';
    }).join('')
    +'</div>';
}
function toggleMesuresPanel(btn){
  const row=btn.closest('.variante-row');
  const panel=row&&row.nextElementSibling;
  if(!panel||!panel.classList.contains('variante-mesures-panel')) return;
  const isOpen=panel.style.display!=='none';
  panel.style.display=isOpen?'none':'block';
  btn.classList.toggle('active',!isOpen);
}
function majBadgeMesures(input){
  const panel=input.closest('.variante-mesures-panel');
  const row=panel&&panel.previousElementSibling;
  const btn=row&&row.querySelector('.v-mesures-btn');
  if(!btn) return;
  const rempli=Array.from(panel.querySelectorAll('.vm-field')).some(i=>i.value.trim()!=='');
  btn.classList.toggle('has-data',rempli);
}
function lireMesuresRow(row){
  const panel=row.nextElementSibling;
  if(!panel||!panel.classList.contains('variante-mesures-panel')) return null;
  const out={};
  panel.querySelectorAll('.vm-field').forEach(function(inp){
    const v=inp.value.trim();
    if(v!=='') out[inp.dataset.key]=parseFloat(v);
  });
  return Object.keys(out).length?out:null;
}
function ajouterVarianteRow(v){
  varianteCount++;
  const list=document.getElementById('variantes-list');
  if(!list)return;
  const div=document.createElement('div');
  div.className='variante-row';
  div.id='vrow-'+varianteCount;
  if(v&&v.id) div.dataset.varianteId=v.id;
  const hasMesures=!!(v&&v.mesures&&Object.keys(v.mesures).length);
  div.innerHTML=
    '<select class="v-taille"><option value="">Taille</option>'+TAILLES_STD.map(function(t){return '<option value="'+t+'"'+(v&&v.taille===t?' selected':'')+'>'+t+'</option>';}).join('')+'</select>'
    +'<input class="v-couleur" placeholder="Couleur (ex: Or)" value="'+(v&&v.couleur||'')+'">'
    +'<input class="v-hex" type="color" value="'+(v&&v.couleur_hex||'#C9A84C')+'" title="Code hex de la couleur">'
    +'<input class="v-stock" type="number" min="0" placeholder="Stock" value="'+(v&&v.stock!=null?v.stock:0)+'">'
    +'<input class="v-supp" type="number" min="0" step="50" placeholder="+Prix" value="'+(v&&v.prix_supplement||0)+'">'
    +'<button type="button" class="v-mesures-btn'+(hasMesures?' has-data':'')+'" onclick="toggleMesuresPanel(this)" title="Mesures (cm) pour cette taille">📏</button>'
    +'<button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:0" onclick="removeVarianteRow(this)" title="Supprimer">✕</button>';
  list.appendChild(div);
  const panel=document.createElement('div');
  panel.className='variante-mesures-panel';
  panel.id='vmesures-'+varianteCount;
  panel.style.display='none';
  panel.innerHTML=buildMesuresFieldsHTML(v&&v.mesures);
  list.appendChild(panel);
}
async function removeVarianteRow(btn){
  const row=btn.parentNode;
  const panel=row.nextElementSibling&&row.nextElementSibling.classList.contains('variante-mesures-panel')?row.nextElementSibling:null;
  const varianteId=row.dataset.varianteId;
  const produitId=window.__currentEditProduitId;
  if(varianteId&&produitId){
    if(!confirm('Supprimer définitivement cette variante ?')) return;
    try{ await api(`/produits/${produitId}/variantes/${varianteId}`,{method:'DELETE'}); }catch(e){}
  }
  row.remove();
  if(panel) panel.remove();
}
function chargerVariantesModal(variantes){
  varianteCount=0;
  const list=document.getElementById('variantes-list');
  if(!list)return;
  list.innerHTML='';
  if(!variantes||!variantes.length){
    TAILLES_STD.forEach(function(t){ajouterVarianteRow({taille:t,stock:0,prix_supplement:0});});
  } else {
    variantes.forEach(function(v){ajouterVarianteRow(v);});
  }
}
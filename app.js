'use strict';

const byId = id => document.getElementById(id);
const fmt = number => new Intl.NumberFormat('es-ES').format(number);
const countryNames = new Intl.DisplayNames(['es'], {type:'region'});
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Pacific/Fiji'}).format(new Date());
const storageKey = 'drua-vessels-v1'; // Keep compatibility with registrations made before the rename.
const legacyPorts = {
  'brisbane-suva':['AUBNE','FJSUV'], 'portmoresby-honiara':['PGPOM','SBHIR'],
  'auckland-sydney':['NZAKL','AUSYD'], 'buenosaires-suva':['ARBUE','FJSUV'],
  'singapore-suva':['SGSIN','FJSUV']
};
const presets = [
  ['MV Pacific Harvest','Fiyi','AUBNE','FJSUV','Trigo a granel',28000,8],
  ['MV Island Seed','Papúa Nueva Guinea','PGPOM','SBHIR','Semillas certificadas',5000,5],
  ['MV Southern Grain','Nueva Zelanda','NZAKL','AUSYD','Alimentos no perecederos',18000,7],
  ['MV Esperanza del Pacífico','Argentina','ARBUE','FJSUV','Maíz a granel',32000,42],
  ['MV Oceania Supply','Fiyi','SGSIN','FJSUV','Fertilizantes',24000,20],
  ['MV Alborada','Estados Unidos','USMSY','FJSUV','Arroz a granel',41000,31,'panama'],
  ['MV Esperanza','Países Bajos','NLRTM','AUSYD','Trigo a granel',32000,45,'suez'],
  ['MV Fertilidad','Emiratos Árabes Unidos','AEDXB','SBHIR','Fertilizante fosfatado',25000,27,'ormuz'],
  ['MV Semilla','India','INMAA','FJSUV','Semillas certificadas',5000,26,'malacca'],
  ['MV Aurora','Estados Unidos','USLAX','NZAKL','Maíz a granel',40000,23,'pacific_ocean'],
  ['MV Horizonte','Países Bajos','NLRTM','FJSUV','Fertilizante nitrogenado',28500,44,'panama']
];
const portLabel = code => {
  const [name,country] = seaPorts[code];
  return (name==='Singapore'?'Singapur':name==='Sydney'?'Sídney':name==='Rotterdam'?'Róterdam':name)+', '+countryNames.of(country);
};
let saved;
try { saved = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { saved = []; }
if (!Array.isArray(saved)) saved = [];

function prepareVessel(entry, custom = true) {
  const [from,to] = entry.from && entry.to ? [entry.from,entry.to] : legacyPorts[entry.route] || [];
  if (!seaPorts[from] || !seaPorts[to] || from===to) return null;
  if (!Number.isFinite(Date.parse(entry.departure+'T12:00:00Z'))) return null;
  const normal = sailingPlan(from,to,entry.passage);
  if (!normal) return null;
  const speed = Math.max(1,normal.km)/entry.days;
  return {...entry,from,to,normal,active:normal,custom,speed,elapsed:0,travelled:0,
    alert:null,status:'En tránsito',origin:portLabel(from),destination:portLabel(to)};
}

const routes = presets.map(([ship,flag,from,to,cargo,tonnes,days,passage]) =>
  prepareVessel({ship,flag,from,to,cargo,tonnes,days,passage,departure:today()},false)
).filter(Boolean);
for (const entry of saved) {
  if (!entry || typeof entry.ship!=='string' || typeof entry.flag!=='string' || typeof entry.cargo!=='string'
      || !Number.isFinite(Number(entry.days)) || Number(entry.days)<=0 || !Number.isFinite(Number(entry.tonnes))) continue;
  const vessel = prepareVessel(entry);
  if (vessel) routes.push(vessel);
}
let selected = 0;
let view = 'mando';
let clockSpeed = 1;
const map = L.map('map',{
  zoomControl:false,zoomSnap:.25,minZoom:.5,maxZoom:6,
  maxBounds:[[-85,-180],[85,540]]
}).setView([-18,155],2.5);
L.control.zoom({position:'bottomleft'}).addTo(map);
L.control.scale({imperial:false,position:'bottomright'}).addTo(map);
map.attributionControl.setPrefix('');
map.attributionControl.addAttribution('Natural Earth');

const land = L.geoJSON(null,{interactive:false,style:{
  color:'#559699',weight:.65,fillColor:'#24585a',fillOpacity:1
}}).addTo(map);

const regionalBounds = L.latLngBounds([[-48,108],[4,189]]);
const globalBounds = L.latLngBounds([[-65,-178],[78,178]]);
let mapMode = 'regional';
const regionalLabels = [
  ['Australia',-24,134], ['Papúa Nueva Guinea',-5.5,145],
  ['Islas Salomón',-7,161], ['Nueva Zelanda',-43,174],
  ['Fiyi',-16.7,179.5], ['Vanuatu',-17,166], ['Samoa',-11,-172],
  ['Tonga',-23,-174], ['Pacífico Sur',-33,174]
];

function fitOverview(mode) {
  mapMode=mode;
  updateMapControls();
  map.fitBounds(mode==='global' ? globalBounds : regionalBounds,{
    padding:[map.getSize().x<500 && mode==='regional' ? 47 : 20,18],maxZoom:mode==='global' ? 2.5 : 4,animate:false
  });
}

function updateMapControls() {
  byId('regionalMap').setAttribute('aria-pressed',mapMode==='regional');
  byId('globalMap').setAttribute('aria-pressed',mapMode==='global');
}

fetch('vendor/world.geojson').then(response=>response.json()).then(data=>{
  for (const shift of [-360,0,360]) {
    land.addData(data.features.map(feature=>({...feature,geometry:{
      ...feature.geometry,coordinates:shiftGeometry(feature.geometry.coordinates,shift)
    }})));
  }
}).catch(()=>{ byId('mapMessage').textContent='No se pudo cargar la cartografía base.'; });
const layers = L.layerGroup().addTo(map);
const geographicLabels = L.layerGroup().addTo(map);
const markers = [];
const vesselIcon = '<img src="assets/vessel.svg" alt="" width="24" height="24">';
function shiftGeometry(coords,shift) {
  return typeof coords[0]==='number' ? [coords[0]+shift,coords[1]] : coords.map(p=>shiftGeometry(p,shift));
}
function mapPoint([lat,lon], center=map.getCenter().lng) {
  return [lat,center+longitudeDelta(center,lon)];
}
function unwrap(path) {
  const output = [];
  for (const point of path) output.push(mapPoint(point,output.at(-1)?.[1] ?? 160));
  return output;
}
function drawLine(path,options) {
  const line = unwrap(path);
  for (const shift of [-360,0,360]) {
    L.polyline(line.map(([lat,lon])=>[lat,lon+shift]),options).addTo(layers);
  }
}
function measure(plan) {
  if (plan.distances) return;
  plan.distances = [0];
  for(let i=1;i<plan.path.length;i++) {
    plan.distances.push(plan.distances[i-1]+seaDistance(plan.path[i-1],plan.path[i]));
  }
  plan.length = plan.distances.at(-1);
}
function position(vessel) {
  const plan = vessel.active;
  measure(plan);
  let lo=1,hi=plan.path.length-1;
  while (lo<hi) {
    const middle=(lo+hi)>>1;
    if (plan.distances[middle]<vessel.travelled) lo=middle+1;
    else hi=middle;
  }
  const a=plan.path[lo-1],b=plan.path[lo];
  const segment=plan.distances[lo]-plan.distances[lo-1];
  const fraction=segment ? Math.min(1,(vessel.travelled-plan.distances[lo-1])/segment) : 0;
  return {point:[a[0]+(b[0]-a[0])*fraction,a[1]+longitudeDelta(a[1],b[1])*fraction],edge:lo-1};
}
function redraw() {
  geographicLabels.clearLayers();
  if (map.getZoom()>=2.25 || (mapMode==='regional' && map.getZoom()>=1.75)) {
    for (const [name,lat,lon] of regionalLabels) {
      const ocean=name==='Pacífico Sur';
      const className=ocean?'geo-label geo-ocean':'geo-label';
      L.marker(mapPoint([lat,lon]),{interactive:false,keyboard:false,
        icon:L.divIcon({className,html:name,iconSize:[100,20],iconAnchor:[50,10]})})
        .addTo(geographicLabels);
    }
  }
  for (const [lat,lon] of [[-13.83,-171.77],[-21.14,-175.21],[-17.74,168.31]]) {
    if(map.getZoom()>=2) {
      L.circleMarker(mapPoint([lat,lon]),{interactive:false,radius:2,color:'#a5d8cb',weight:1,fillOpacity:1})
        .addTo(geographicLabels);
    }
  }
  layers.clearLayers();
  markers.length=0;
  routes.forEach((vessel,index)=>{
    if (index===selected) return;
    drawLine(vessel.normal.path,{color:'#83aec0',weight:1.25,opacity:.52,interactive:false});
  });
  drawLine(routes[selected].normal.path,{color:'#04252c',weight:6,opacity:.76,interactive:false});
  drawLine(routes[selected].normal.path,{color:'#54e6d1',weight:3,opacity:1,interactive:false});
  routes.forEach((vessel,index)=>{
    const current = index===selected;
    if (vessel.alert?.alternative) {
      drawLine(vessel.alert.alternative.path,{color:'#ffc66c',dashArray:'7 6',weight:current?4:2,interactive:false});
    }
    if (current && vessel.alert) {
      L.circleMarker(mapPoint(vessel.alert.point),{color:'#ffc66c',radius:8,fillOpacity:.45})
        .addTo(layers).bindTooltip(vessel.alert.label);
    }
    if (current) {
      for (const [code,label] of [[vessel.from,vessel.origin],[vessel.to,vessel.destination]]) {
        L.circleMarker(mapPoint(portPosition(code)),{radius:4,color:'#a0fff0',fillOpacity:.9})
          .addTo(layers).bindTooltip(Object.assign(document.createElement("span"),{textContent:label}));
      }
    }
    const marker=L.marker(mapPoint(position(vessel).point),{
      title:vessel.ship,alt:vessel.ship,
      icon:L.divIcon({className:'ship-marker',html:'<div class="marker-inner'+(current?'':' other')+'">'+vesselIcon+'</div>',
        iconSize:current?[32,32]:[24,24],iconAnchor:current?[16,16]:[12,12]})
    }).addTo(layers);
    const label=document.createElement('span');
    label.textContent=vessel.ship;
    marker.bindTooltip(label).on('click',()=>selectVessel(index));
    markers.push(marker);
  });
}
map.on('moveend',redraw);

function selectVessel(index,focus=true) {
  selected=index;
  const vessel=routes[index];
  if(focus) {
    mapMode='route';
    updateMapControls();
    const bounds=L.latLngBounds(unwrap(vessel.active.path));
    map.fitBounds(bounds,{padding:[24,24],maxZoom:4,animate:false});
  }
  redraw();
  updateUI();
}

function arrival(vessel) {
  const date=new Date(vessel.departure+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+transitDays(vessel));
  return date.toISOString().slice(0,10);
}
function transitDays(vessel) {
  return vessel.alert?.alternative ? Math.ceil(vessel.alert.days) : Number(vessel.days);
}
function renderReports() {
  const rows=routes.map(vessel=>{
    const cells=[vessel.ship,vessel.flag,vessel.origin,vessel.destination,vessel.cargo,
      fmt(vessel.tonnes)+' t',vessel.departure,arrival(vessel),transitDays(vessel),vessel.status];
    const row=document.createElement('tr');
    for(const value of cells) {
      const td=document.createElement('td');
      td.textContent=value;
      row.append(td);
    }
    return row;
  });
  byId('reportBody').replaceChildren(...rows);
}
function updateUI() {
  const vessel=routes[selected];
  const passage=Object.entries(strategicPassages)
    .filter(([key])=>vessel.normal.edges.some(edge=>seaEdges[edge]?.[3]===key))
    .map(([,label])=>label).join(' · ');
  const fields={shipName:vessel.ship,shipId:vessel.custom?'BUQUE INSCRITO':'SIMULADO',shipCargo:vessel.cargo,
    shipJourney:vessel.origin+' → '+vessel.destination,shipVolume:fmt(vessel.tonnes)+' t',
    shipEta:transitDays(vessel)+' días · '+arrival(vessel),shipStatus:vessel.status,
    etaOrigin:seaPorts[vessel.from][0],etaDestination:seaPorts[vessel.to][0],
    statAlerts:routes.filter(s=>s.alert && s.status!=='Arribado').length,mapTag:'/ '+seaPorts[vessel.to][0],
    mapMessage:vessel.origin+' → '+vessel.destination+' · '+fmt(Math.round(vessel.normal.km))+' km'+(passage?' · '+passage:''),
    scenarioNote:vessel.alert?.message || 'Simula una amenaza en el recorrido pendiente.',
    reportText:routes.length+' buques registrados en la simulación de abastecimiento marítimo de Oceanía.'};
  for (const [id,value] of Object.entries(fields)) byId(id).textContent=value;
  byId('simulate').disabled=Boolean(vessel.alert) || vessel.status==='Arribado';
  byId('statCargo').textContent=fmt(routes.filter(v=>v.status!=='Arribado').reduce((sum,s)=>sum+Number(s.tonnes),0))+' t';
  [...byId('routeList').children].forEach((button,index)=>{
    button.classList.toggle('active',index===selected);
    button.setAttribute('aria-pressed',index===selected);
  });
  updateEta(vessel);
  renderReports();
}
function buildRouteList() {
  byId('routeList').replaceChildren(...routes.map((vessel,index)=>{
    const button=document.createElement('button');
    button.className='route-item';
    const name=document.createElement('strong'), journey=document.createElement('span');
    name.textContent=vessel.ship;
    journey.textContent=vessel.origin+' → '+vessel.destination;
    button.append(name,journey);
    button.onclick=()=>selectVessel(index);
    return button;
  }));
  byId('statRoutes').textContent=String(routes.length).padStart(2,'0');
  byId('routeCount').textContent=routes.length+' BUQUES';
}

function findDetour(vessel,severity,targetPassage) {
  const plan=vessel.normal;
  const {point,edge:current}=position(vessel);
  const ahead=plan.edges.map((id,index)=>({id,index})).filter(({id,index})=>id>=0 && index>=current);
  const threat=ahead.find(({id})=>targetPassage && seaEdges[id][3]===targetPassage)
    || ahead[Math.floor(ahead.length/2)];
  if (!threat) return null;
  const passage=targetPassage && seaEdges[threat.id][3]===targetPassage ? targetPassage : null;
  const [a,b]=seaEdges[threat.id];
  const [lon,lat]=seaNodes[a], [endLon,endLat]=seaNodes[b];
  const threatPoint=[(lat+endLat)/2,lon+longitudeDelta(lon,endLon)/2];
  const label=passage ? strategicPassages[passage] : 'Tramo marítimo simulado';
  const policy={blockedEdge:threat.id,blockedPassage:passage};
  if (severity==='critical' && !passage) {
    policy.avoidEdges=new Set(seaLinks[a].concat(seaLinks[b]).map(link=>link.index));
  }
  const alternatives=[];
  const terminal=plan.path.length-2;
  for (const index of [current,current+1]) {
    if (index<1 || index>terminal || (index===current+1 && (current===threat.index ||
        policy.avoidEdges?.has(plan.edges[current]) || (passage && seaEdges[plan.edges[current]]?.[3]===passage)))) continue;
    const [nodeLat,nodeLon]=plan.path[index];
    const currentEdge=seaEdges[plan.edges[index===terminal ? index-1 : index]];
    const node=currentEdge?.slice(0,2).find(id=>seaNodes[id][0]===nodeLon && seaNodes[id][1]===nodeLat);
    if(node===undefined) continue;
    const next=routeBetween(node,portNode(vessel.to),policy);
    if(next) alternatives.push({...next,km:next.km+seaDistance(point,plan.path[index]),
      path:[point,...next.path,portPosition(vessel.to)]});
  }
  alternatives.sort((left,right)=>left.km-right.km);
  const alternative=alternatives[0];
  const message=alternative
    ? label+' · Desvío automático de '+fmt(Math.round(alternative.km))+' km desde la posición actual.'
    : label+' · La red simulada no ofrece un paso habilitado. El buque queda en espera.';
  return {point:threatPoint,label,message,alternative,severity,days:vessel.elapsed+(alternative?.km ?? 0)/vessel.speed};
}

const confirmation = byId('threatDialog');
byId('simulate').onclick=()=>{
  const vessel=routes[selected];
  const upcoming=new Set(vessel.normal.edges.slice(position(vessel).edge)
    .map(id=>seaEdges[id]?.[3]).filter(passage=>strategicPassages[passage]));
  const scope=byId('threatScope');
  scope.replaceChildren(new Option('Tramo de la ruta','segment'),
    ...[...upcoming].map(passage=>new Option(strategicPassages[passage],passage)));
  if(upcoming.has(vessel.passage)) scope.value=vessel.passage;
  confirmation.showModal();
};
byId('confirmThreat').onclick=()=>{
  confirmation.close();
  const vessel=routes[selected];
  const alert=findDetour(vessel,byId('threatSeverity').value,byId('threatScope').value);
  if(!alert) {
    byId('scenarioNote').textContent='El buque ya está en la aproximación final al puerto.';
    return;
  }
  vessel.alert=alert;
  vessel.status=alert.alternative?'En desvío':'En espera';
  if(alert.alternative) {
    vessel.active=alert.alternative;
    vessel.travelled=0;
    selectVessel(selected);
    return;
  }
  redraw();
  updateUI();
};
byId('cancelThreat').onclick=()=>confirmation.close();
byId('reset').onclick=()=>{
  for(const vessel of routes) Object.assign(vessel,{
    alert:null,status:'En tránsito',active:vessel.normal,travelled:0,elapsed:0
  });
  redraw();
  updateUI();
};

function updateEta(vessel) {
  measure(vessel.active);
  const remaining=Math.max(0,vessel.active.length-vessel.travelled);
  byId('etaProgress').style.width=(100*(1-remaining/Math.max(1,vessel.active.length))).toFixed(1)+'%';
  byId('etaBig').textContent=vessel.status==='En espera'?'En espera':
    vessel.status==='Arribado'?'Arribado':Math.ceil(remaining/vessel.speed)+' días';
}
let lastTime=performance.now();
function tick(now) {
  const days=Math.min(now-lastTime,1000)/60000*clockSpeed;
  lastTime=now;
  let changed=false;
  for(const [index,vessel] of routes.entries()) {
    if(vessel.status==='Arribado' || vessel.status==='En espera') continue;
    measure(vessel.active);
    const travelled=Math.min(vessel.active.length-vessel.travelled,days*vessel.speed);
    vessel.elapsed+=travelled/vessel.speed;
    vessel.travelled+=travelled;
    if(vessel.travelled>=vessel.active.length) {
      vessel.status='Arribado';
      changed=true;
    }
    if(view==='mando') markers[index]?.setLatLng(mapPoint(position(vessel).point));
  }
  if(changed) updateUI();
  else if(view==='mando') updateEta(routes[selected]);
  requestAnimationFrame(tick);
}

const titles={
  mando:['Control de Mando','Monitoreo simulado del abastecimiento alimentario marítimo en Oceanía','VISTA GENERAL'],
  reportes:['Reportes','Registro de embarcaciones y trayectorias','RESUMEN'],
  sobre:['Sobre DRUA','Seguridad alimentaria y abastecimiento marítimo en Oceanía','ACERCA DEL PROYECTO']
};
function showView(next) {
  view=next;
  document.querySelector('main').classList.toggle('non-dashboard',view!=='mando');
  for(const button of document.querySelectorAll('.nav')) {
    const active=button.dataset.view===view;
    button.classList.toggle('active',active);
    if(active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  [byId('title').textContent,byId('subtitle').textContent,byId('sectionLabel').textContent]=titles[view];
  byId('reports').classList.toggle('hidden',view!=='reportes');
  byId('about').classList.toggle('hidden',view!=='sobre');
  if(view==='mando') map.invalidateSize();
  updateUI();
}
for(const button of document.querySelectorAll('.nav')) button.onclick=()=>showView(button.dataset.view);
document.querySelector('.brand').onclick=event=>{event.preventDefault();showView('mando')};
byId('regionalMap').onclick=()=>fitOverview('regional');
byId('globalMap').onclick=()=>fitOverview('global');
byId('help').onclick=()=>byId('helpDialog').classList.remove('hidden');
for(const button of document.querySelectorAll('#helpDialog .close,#helpDialog .close-action')) {
  button.onclick=()=>byId('helpDialog').classList.add('hidden');
}
byId('print').onclick=()=>window.print();
byId('speed').onchange=event=>{clockSpeed=Number(event.target.value)};

function initRegistration() {
  const form=byId('registerForm');
  const country=byId('originCountry'),origin=byId('originSelect'),destination=byId('destinationSelect');
  const error=byId('formError');
  const codes=Object.keys(seaPorts).sort((a,b)=>portLabel(a).localeCompare(portLabel(b),'es'));
  const countries=[...new Set(codes.map(code=>seaPorts[code][1]))]
    .sort((a,b)=>countryNames.of(a).localeCompare(countryNames.of(b),'es'));
  country.replaceChildren(...countries.map(code=>new Option(countryNames.of(code),code)));
  destination.replaceChildren(...codes.filter(code=>destinationRegions.has(seaPorts[code][1]))
    .map(code=>new Option(portLabel(code),code)));
  function fillOrigins() {
    origin.replaceChildren(...codes.filter(code=>seaPorts[code][1]===country.value)
      .map(code=>new Option(portLabel(code),code)));
  }
  function resetFields() {
    form.reset();
    country.value='AU';
    fillOrigins();
    origin.value='AUBNE';
    destination.value='FJSUV';
    form.elements.departure.value=today();
  }
  let step=1;
  let pending=null;
  function setStep(number) {
    step=number;
    error.textContent='';
    for(const panel of form.querySelectorAll('.step-fields')) panel.classList.toggle('hidden',Number(panel.dataset.step)!==step);
    for(const indicator of form.querySelectorAll('[data-step-indicator]')) {
      const position=Number(indicator.dataset.stepIndicator);
      indicator.classList.toggle('current',position===step);
      indicator.classList.toggle('completed',position<step);
    }
    byId('prevStep').classList.toggle('hidden',step===1);
    byId('nextStep').classList.toggle('hidden',step===3);
    byId('submitRegistration').classList.toggle('hidden',step!==3);
  }
  resetFields();
  country.onchange=fillOrigins;
  byId('openRegister').onclick=()=>{
    showView('mando');
    byId('registerDialog').scrollIntoView({behavior:'smooth',block:'center'});
    form.querySelector('[data-step="'+step+'"] input, [data-step="'+step+'"] select')?.focus({preventScroll:true});
  };
  byId('nextStep').onclick=()=>{
    for(const field of form.querySelectorAll('[data-step="'+step+'"] input,[data-step="'+step+'"] select')) {
      if(!field.reportValidity()) return;
    }
    if(step===2) {
      const data=Object.fromEntries(new FormData(form));
      const entry={ship:data.ship.trim(),flag:data.flag.trim(),cargo:data.cargo,
        tonnes:Number(data.tonnes),days:Number(data.days),departure:data.departure,from:data.origin,to:data.destination};
      if(!entry.ship || !entry.flag) {
        setStep(1);
        error.textContent='Completa el nombre y la bandera del buque.';
        return;
      }
      const vessel=prepareVessel(entry);
      if(!vessel) {
        error.textContent='No hay conexión marítima para esos puertos. Elige dos puertos distintos conectados a la red.';
        return;
      }
      pending={entry,vessel};
      byId('registrationSummary').textContent=entry.ship+' · '+vessel.origin+' → '+vessel.destination+
        ' · '+fmt(Math.round(vessel.normal.km))+' km · '+fmt(entry.tonnes)+' t';
    }
    setStep(step+1);
  };
  byId('prevStep').onclick=()=>setStep(step-1);
  form.onsubmit=event=>{
    event.preventDefault();
    if(step!==3 || !pending) return;
    try {
      const stored=JSON.parse(localStorage.getItem(storageKey)||'[]');
      const entries=Array.isArray(stored)?stored:saved;
      localStorage.setItem(storageKey,JSON.stringify([...entries,pending.entry]));
    } catch {
      error.textContent='No se pudo guardar el buque en este navegador.';
      return;
    }
    routes.push(pending.vessel);
    pending=null;
    buildRouteList();
    resetFields();
    setStep(1);
    showView('mando');
    selectVessel(routes.length-1);
    byId('map').scrollIntoView({behavior:'smooth',block:'nearest'});
  };
}

initRegistration();
buildRouteList();
selectVessel(0,false);
fitOverview('regional');
let previousMapSize = map.getSize();
new ResizeObserver(()=>{
  const container=map.getContainer();
  if (!container.clientWidth || !container.clientHeight) return;
  map.invalidateSize({pan:false,debounceMoveend:true});
  const size=map.getSize();
  if (size.equals(previousMapSize)) return;
  previousMapSize=size;
  if (mapMode==='route') selectVessel(selected);
  else fitOverview(mapMode);
}).observe(map.getContainer());
requestAnimationFrame(tick);

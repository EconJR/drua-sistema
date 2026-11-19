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
  measure(normal);
  const speed = Math.max(1,normal.length)/entry.days;
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
// ISO country codes from the bundled Natural Earth map, with additional port territories.
const originRegions = [
  ['Oceanía','AU FJ NC NZ PG SB VU AS CK FM GU KI MH MP NR NU PF PN PW TK TO TV WF WS UM'],
  ['Asia','AE AF AM AZ BD BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE'],
  ['América','AG AI AR AW BB BL BM BO BR BS BZ CA CL CO CR CU CW DM DO EC FK GD GF GL GP GT GY HN HT JM KN KY LC MF MQ MS MX NI PA PE PR PY SR SV SX TC TT US UY VC VE VG VI'],
  ['Europa','AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK'],
  ['África','AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW']
];
const regionByCountry=new Map(originRegions.flatMap(([region,countries])=>countries.split(' ').map(code=>[code,region])));
const explorer={mode:'origin',group:'Oceanía',state:'all'};
const groupKey=vessel=>explorer.mode==='origin' ? regionByCountry.get(seaPorts[vessel.from][1]) || 'Otras regiones' : vessel.to;
const groupName=key=>explorer.mode==='origin' ? key : portLabel(key).split(',')[0];
const stateRank={critical:0,ordinary:1,normal:2};
function visibleRoutes() {
  return routes.filter(vessel=>groupKey(vessel)===explorer.group &&
    (explorer.state==='all' || severityOf(vessel)===explorer.state));
}

let selected = null;
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

const cartography = fetch('vendor/world.geojson').then(response=>response.json()).then(data=>{
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
function drawLine(path,options,onClick) {
  const line = unwrap(path);
  for (const shift of [-360,0,360]) {
    const segment=L.polyline(line.map(([lat,lon])=>[lat,lon+shift]),options).addTo(layers);
    if(onClick) segment.on('click',onClick);
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
  const visible=visibleRoutes();
  for(const vessel of visible) {
    const index=routes.indexOf(vessel);
    if (index===selected) continue;
    drawLine(vessel.normal.path,{color:'#83aec0',weight:1.5,opacity:.56},()=>revealVessel(index));
  }
  if(selected!==null) {
    drawLine(routes[selected].normal.path,{color:'#04252c',weight:6,opacity:.76,interactive:false});
    drawLine(routes[selected].normal.path,{color:'#54e6d1',weight:3,opacity:1,interactive:false});
  }
  for(const vessel of visible) {
    const index=routes.indexOf(vessel);
    const current = index===selected;
    if (vessel.alert?.alternative) {
      drawLine(vessel.alert.alternative.path,{color:'#ffc66c',dashArray:'7 6',weight:current?4:2,opacity:current?1:.45,interactive:false});
    }
    if (current && vessel.alert) {
      L.circleMarker(mapPoint(vessel.alert.point),{color:'#ffc66c',radius:8,fillOpacity:.45})
        .addTo(layers).bindTooltip(vessel.alert.label);
    }
    if (current) {
      for (const [code,anchor] of [[vessel.from,'top'],[vessel.to,'bottom']]) {
        const name=Object.assign(document.createElement('span'),{textContent:portLabel(code).split(',')[0]});
        L.circleMarker(mapPoint(portPosition(code)),{radius:4,color:'#a0fff0',fillOpacity:.9})
          .addTo(layers).bindTooltip(name,{permanent:true,direction:anchor,className:'explorer-port-label'});
      }
    }
    const marker=L.marker(mapPoint(position(vessel).point),{
      title:vessel.ship,alt:vessel.ship,zIndexOffset:current?1000:0,
      icon:L.divIcon({className:'ship-marker',html:'<div class="marker-inner'+(current?'':' other')+'">'+vesselIcon+'</div>',
        iconSize:current?[32,32]:[24,24],iconAnchor:current?[16,16]:[12,12]})
    }).addTo(layers);
    marker.bindTooltip(()=>vesselPreview(vessel),{className:'vessel-hover',direction:'auto',offset:[10,-4]})
      .on('click',()=>revealVessel(index));
    markers[index]=marker;
  }
}
map.on('moveend',redraw);

function selectVessel(index,focus=true) {
  selected=index;
  const vessel=routes[index];
  explorer.group=groupKey(vessel);
  if(explorer.state!=='all' && explorer.state!==severityOf(vessel)) explorer.state='all';
  map.invalidateSize({pan:false});
  if(focus) {
    mapMode='route';
    updateMapControls();
    const original=unwrap(vessel.normal.path);
    const bounds=L.latLngBounds(original);
    if(vessel.alert?.alternative) {
      const alternative=unwrap(vessel.alert.alternative.path);
      const shift=original.at(-1)[1]-alternative.at(-1)[1];
      bounds.extend(L.latLngBounds(alternative.map(([lat,lon])=>[lat,lon+shift])));
    }
    map.fitBounds(bounds,{padding:[26,26],maxZoom:4,animate:false});
  }
  redraw();
  updateUI();
}

function revealVessel(index) {
  selectVessel(index);
  if(matchMedia('(max-width: 760px)').matches) {
    byId('map').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
}

const msPerDay=86400000;
const dateTime=new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC',hourCycle:'h23'});

function simulatedDate(vessel,days) {
  return new Date(Date.parse(vessel.departure+'T12:00:00Z')+days*msPerDay);
}
function arrival(vessel) {
  if(vessel.status==='En espera') return 'Por confirmar';
  return dateTime.format(simulatedDate(vessel,vessel.alert?.alternative?vessel.alert.days:Number(vessel.days)))+' UTC';
}
function transitDays(vessel) {
  return vessel.alert?.alternative ? Math.ceil(vessel.alert.days) : Number(vessel.days);
}
function severityBadge(vessel) {
  const badge=document.createElement('span');
  const severity=vessel.alert?.severity || 'normal';
  badge.className='vessel-state '+severity;
  badge.textContent={normal:'Ruta normal',ordinary:'No crítica',critical:'Crítica'}[severity];
  return badge;
}
let fleetFilter='all';
let previewVessel=null;
const severityOf=vessel=>vessel.alert?.severity || 'normal';
const searchKey=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('es');

function renderFleetCards() {
  const search=searchKey(byId('fleetSearch').value.trim());
  const cargo=byId('fleetCargo').value;
  const visible=routes.filter(vessel=>
    (fleetFilter==='all' || severityOf(vessel)===fleetFilter) &&
    (!cargo || vessel.cargo===cargo) &&
    searchKey(vessel.ship).includes(search));
  const container=byId('fleetCards');
  container.replaceChildren(...visible.map(buildFleetCard));
  byId('reportText').textContent=visible.length===1?'1 buque encontrado':fmt(visible.length)+' buques encontrados';
  if(!visible.length) {
    const message=document.createElement('p');
    message.className='fleet-no-results';
    message.textContent='No hay buques que coincidan con estos filtros.';
    container.append(message);
  }
  if(previewVessel && !visible.includes(previewVessel)) closeFleetDetail();
}
function buildFleetCard(vessel) {
  const card=document.createElement('article');
  card.className='fleet-card '+severityOf(vessel);
  card.dataset.vessel=String(routes.indexOf(vessel));
  card.dataset.photo=String(Number(card.dataset.vessel)%3);
  card.innerHTML='<div class="fleet-card-photo" aria-hidden="true"></div>'+
    '<div class="fleet-card-heading"><h3></h3></div><div class="fleet-card-data">'+
    '<p class="card-ports"></p><p class="card-cargo"></p><p class="card-eta"></p>'+
    '<div class="fleet-card-event"></div><button type="button" class="fleet-open">Ver detalle →</button></div>';
  card.querySelector('h3').textContent=vessel.ship;
  card.querySelector('.fleet-card-heading').append(severityBadge(vessel));
  card.querySelector('.card-ports').textContent=vessel.origin+' → '+vessel.destination;
  card.querySelector('.card-cargo').textContent=vessel.cargo+' · '+fmt(vessel.tonnes)+' t';
  card.querySelector('.card-eta').textContent='Llegada simulada · '+arrival(vessel);
  const event=card.querySelector('.fleet-card-event');
  if(vessel.alert) {
    const state=document.createElement('strong');
    state.textContent=vessel.status;
    const note=document.createElement('p');
    note.textContent=vessel.alert.label+' · '+delayText(vessel);
    event.append(state,note);
  } else {
    const meter=document.createElement('progress');
    meter.max=1;
    meter.setAttribute('aria-label','Avance del recorrido');
    meter.value=vessel.travelled/Math.max(1,vessel.normal.length);
    const state=document.createElement('span');
    state.textContent=vessel.status;
    event.append(meter,state);
  }
  const button=card.querySelector('.fleet-open');
  button.setAttribute('aria-label','Ver detalle de '+vessel.ship);
  button.setAttribute('aria-controls','fleetReportDialog');
  button.setAttribute('aria-haspopup','dialog');
  card.classList.toggle('is-previewed',previewVessel===vessel);
  card.addEventListener('pointerenter',event=>{
    if(event.pointerType==='mouse' && matchMedia('(min-width: 1000px)').matches) openVesselReport(vessel);
  });
  button.addEventListener('focus',()=>{
    if(matchMedia('(min-width: 1000px)').matches) openVesselReport(vessel);
  });
  card.onclick=event=>{ if(!event.target.closest('button')) button.click(); };
  button.onclick=()=>openReportDialog(vessel,button);
  return card;
}
function closeFleetDetail() {
  previewVessel=null;
  byId('fleetDetailContent').hidden=true;
  byId('fleetDetailEmpty').hidden=false;
  highlightFleetCard();
}
function highlightFleetCard() {
  for(const card of byId('fleetCards').querySelectorAll('.fleet-card')) {
    const active=routes[Number(card.dataset.vessel)]===previewVessel;
    card.classList.toggle('is-previewed',active);
  }
}
function vesselPreview(vessel) {
  const preview=document.createElement('div');
  const title=document.createElement('strong');
  title.textContent=vessel.ship;
  preview.append(title,severityBadge(vessel));
  const lines=vessel.alert ? [
    ['Estado',vessel.status],
    ['Hora simulada',dateTime.format(simulatedDate(vessel,vessel.alert.eventDays))+' UTC'],
    ['Inicio del desvío',eventCoordinates(vessel.alert)],
    ['Vía alternativa',vessel.alert.alternative?describeAlternative(vessel.alert.alternative,vessel.destination):'Sin paso habilitado'],
    ['Nueva llegada',arrival(vessel)],['Cambio de tránsito',delayText(vessel)]
  ] : [['Ruta',vessel.origin+' → '+vessel.destination],['Llegada simulada',arrival(vessel)]];
  if(vessel.alert && !vessel.alert.alternative) lines[2][0]='Posición durante la alerta';
  for(const [label,value] of lines){
    const line=document.createElement('div');
    const key=document.createElement('b');
    key.textContent=label+' · ';
    line.append(key,value);
    preview.append(line);
  }
  return preview;
}
function delayText(vessel) {
  if(!vessel.alert?.alternative) return 'Llegada por confirmar';
  const delta=(vessel.alert.days-Number(vessel.days))*24;
  return new Intl.NumberFormat('es',{maximumFractionDigits:1}).format(Math.abs(delta))+(delta<-.05?' h menos':' h extra');
}
function eventCoordinates(alert) {
  const [lat,lon]=alert.eventPosition;
  const coordinate=(value,positive,negative)=>Math.abs(value).toFixed(3)+'° '+(value<0?negative:positive);
  return coordinate(lat,'N','S')+' · '+coordinate(longitudeDelta(0,lon),'E','O');
}
function renderReports() {
  const totals={normal:0,ordinary:0,critical:0};
  for(const vessel of routes) totals[severityOf(vessel)]++;
  for(const [id,value] of Object.entries({fleetTotal:routes.length,fleetNormal:totals.normal,
    fleetOrdinary:totals.ordinary,fleetCritical:totals.critical})) byId(id).textContent=fmt(value);
  const cargo=byId('fleetCargo');
  const currentCargo=cargo.value;
  cargo.replaceChildren(new Option('Todas las cargas',''),
    ...[...new Set(routes.map(vessel=>vessel.cargo))].sort((a,b)=>a.localeCompare(b,'es'))
      .map(name=>new Option(name,name)));
  if([...cargo.options].some(option=>option.value===currentCargo)) cargo.value=currentCargo;
  renderFleetCards();
  if(previewVessel) openVesselReport(previewVessel,{refresh:true});
  const rows=routes.map(vessel=>{
    const row=document.createElement('tr');
    const name=row.insertCell();
    const button=document.createElement('button');
    button.type='button';
    button.className='report-link';
    button.textContent=vessel.ship;
    button.onclick=()=>openReportDialog(vessel,button);
    name.append(button);
    const cells=[vessel.flag,vessel.origin,vessel.destination,vessel.cargo,
      fmt(vessel.tonnes)+' t',vessel.departure,arrival(vessel),
      vessel.status==='En espera'?'Por confirmar':transitDays(vessel)];
    for(const value of cells) row.insertCell().textContent=value;
    const status=row.insertCell();
    const detail=document.createElement('small');
    detail.textContent=vessel.status;
    status.append(severityBadge(vessel),detail);
    return row;
  });
  byId('reportBody').replaceChildren(...rows);
}

let reportMap,reportTracks;
function renderFacts(id,facts) {
  const container=byId(id);
  container.replaceChildren(...facts.map(([heading,value])=>{
    const pair=document.createElement('div'),label=document.createElement('dt'),description=document.createElement('dd');
    label.textContent=heading;
    description.textContent=value;
    pair.append(label,description);
    return pair;
  }));
}
function showReportMap(vessel) {
  if(!reportMap) {
    reportMap=L.map('reportMap',{scrollWheelZoom:false,minZoom:0,maxZoom:6,zoomSnap:.25});
    reportMap.attributionControl.setPrefix('');
    reportMap.attributionControl.addAttribution('Natural Earth');
    const base=L.geoJSON(null,{interactive:false,style:{color:'#559699',weight:.6,fillColor:'#24585a',fillOpacity:1}}).addTo(reportMap);
    cartography.then(()=>base.addData(land.toGeoJSON()));
    reportTracks=L.layerGroup().addTo(reportMap);
  }
  reportMap.invalidateSize({pan:false});
  reportTracks.clearLayers();
  const original=unwrap(vessel.normal.path);
  const bounds=L.latLngBounds(original);
  L.polyline(original,{color:'#54e6d1',weight:2}).addTo(reportTracks);
  if(vessel.alert?.alternative) {
    const alternative=unwrap(vessel.alert.alternative.path);
    const shifted=alternative.map(([lat,lon])=>[lat,lon+original.at(-1)[1]-alternative.at(-1)[1]]);
    L.polyline(shifted,{color:'#ffc66c',weight:3,dashArray:'7 5'}).addTo(reportTracks);
    bounds.extend(L.latLngBounds(shifted));
  }
  reportMap.fitBounds(bounds,{padding:[14,14],maxZoom:5,animate:false});
  const center=reportMap.getCenter().lng;
  L.circleMarker(mapPoint(position(vessel).point,center),{radius:5,color:'#b7fff1',fillOpacity:.95})
    .addTo(reportTracks).bindTooltip('Posición al abrir el reporte');
  if(vessel.alert) {
    L.circleMarker(mapPoint(vessel.alert.eventPosition,center),{radius:5,color:'#ffc66c',fillOpacity:.95})
      .addTo(reportTracks).bindTooltip(vessel.alert.alternative?'Inicio del desvío':'Posición al confirmar la alerta');
  }
}
function openVesselReport(vessel,{refresh=false}={}) {
  if(!refresh && previewVessel===vessel && !byId('fleetDetailContent').hidden) return;
  previewVessel=vessel;
  byId('fleetDetailContent').hidden=false;
  byId('fleetDetailEmpty').hidden=true;
  highlightFleetCard();
  byId('reportVesselName').textContent=vessel.ship;
  byId('reportVesselStatus').replaceChildren(severityBadge(vessel),' · '+vessel.status);
  renderFacts('reportVesselFacts',[
    ['Bandera',vessel.flag],['Origen',vessel.origin],['Destino',vessel.destination],
    ['Carga',vessel.cargo+' · '+fmt(vessel.tonnes)+' t'],
    ['Salida simulada',dateTime.format(simulatedDate(vessel,0))+' UTC'],
    ['Llegada estimada',arrival(vessel)]
  ]);
  const alert=vessel.alert;
  byId('reportEventNote').textContent=alert?.message || 'Este buque sigue el itinerario original. No se han registrado alertas.';
  const facts=[];
  if(alert) {
    facts.push(['Hora simulada del evento',dateTime.format(simulatedDate(vessel,alert.eventDays))+' UTC'],
      [alert.alternative?'Posición al iniciar el desvío':'Posición durante la alerta',eventCoordinates(alert)],
      ['Punto afectado',alert.label],
      ['Vía alternativa',alert.alternative ? describeAlternative(alert.alternative,vessel.destination):'Sin paso habilitado'],
      ['Llegada antes del evento',dateTime.format(simulatedDate(vessel,Number(vessel.days)))+' UTC'],
      ['Nueva llegada estimada',arrival(vessel)]);
    facts.push(['Cambio en el tiempo de tránsito',delayText(vessel)]);
  }
  renderFacts('reportEventFacts',facts);
  byId('reportMapLegend').textContent=alert?.alternative ?
    'Turquesa · ruta original | Dorado · vía alternativa e inicio del desvío' : 'Turquesa · ruta original';
  if(!refresh) byId('vesselReport').scrollTop=0;
  showReportMap(vessel);
}
const fleetReportDialog=byId('fleetReportDialog');
const sharedReportBody=byId('fleetDetailContent').querySelector('.report-dialog-body');
let reportDialogTrigger=null;

function openReportDialog(vessel,trigger) {
  if(fleetReportDialog.open) return;
  openVesselReport(vessel);
  reportDialogTrigger=trigger;
  byId('fleetReportDialogTitle').textContent=vessel.ship;
  fleetReportDialog.classList.toggle('has-alert',Boolean(vessel.alert));
  fleetReportDialog.classList.toggle('has-detour',Boolean(vessel.alert?.alternative));
  byId('fleetReportDialogSlot').append(sharedReportBody);
  fleetReportDialog.showModal();
  sharedReportBody.scrollTop=0;
  showReportMap(vessel);
}

fleetReportDialog.addEventListener('close',()=>{
  byId('viewFleetRoute').before(sharedReportBody);
  if(previewVessel) showReportMap(previewVessel);
  if(reportDialogTrigger?.isConnected) reportDialogTrigger.focus({preventScroll:true});
  reportDialogTrigger=null;
});

function describeAlternative(plan,destination) {
  const names=[...new Set(plan.edges.map(id=>strategicPassages[seaEdges[id]?.[3]]).filter(Boolean))];
  return (names.length ? names.join(' → ') : 'Tramos marítimos alternativos')+
    ' → '+destination+' · '+fmt(Math.round(plan.length))+' km restantes.';
}
function updateUI() {
  byId('statAlerts').textContent=routes.filter(s=>s.alert && s.status!=='Arribado').length;
  byId('statCargo').textContent=fmt(routes.filter(v=>v.status!=='Arribado').reduce((sum,s)=>sum+Number(s.tonnes),0))+' t';
  if(view==='mando') buildRouteList();
  if(view==='reportes') renderReports();
  const vessel=routes[selected];
  updateExplorerSummary(vessel);
  if(!vessel) {
    byId('mapTag').textContent='/ Oceanía y Pacífico Sur';
    byId('mapMessage').textContent='Selecciona un buque o una ruta para ver su detalle.';
    return;
  }
  const passage=Object.entries(strategicPassages)
    .filter(([key])=>vessel.normal.edges.some(edge=>seaEdges[edge]?.[3]===key))
    .map(([,label])=>label).join(' · ');
  const fields={shipName:vessel.ship,shipId:vessel.custom?'BUQUE INSCRITO':'SIMULADO',shipCargo:vessel.cargo,
    shipJourney:vessel.origin+' → '+vessel.destination,shipVolume:fmt(vessel.tonnes)+' t',
    shipEta:transitDays(vessel)+' días · '+arrival(vessel),shipStatus:vessel.status,
    etaOrigin:seaPorts[vessel.from][0],etaDestination:seaPorts[vessel.to][0],
    mapTag:'/ '+seaPorts[vessel.to][0],
    mapMessage:vessel.origin+' → '+vessel.destination+' · '+fmt(Math.round(vessel.normal.km))+' km'+(passage?' · '+passage:''),
    scenarioNote:vessel.alert?.message || 'Simula una amenaza en el recorrido pendiente.'};
  for (const [id,value] of Object.entries(fields)) byId(id).textContent=value;
  byId('simulate').disabled=Boolean(vessel.alert) || vessel.status==='Arribado';
  updateEta(vessel);
}
function buildRouteList() {
  const groups=new Map();
  for(const vessel of routes) {
    const key=groupKey(vessel);
    groups.set(key,(groups.get(key)||0)+1);
  }
  const keys=[...groups.keys()];
  if(explorer.mode==='origin') {
    const order=[...originRegions.map(([name])=>name),'Otras regiones'];
    keys.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  } else keys.sort((a,b)=>groupName(a).localeCompare(groupName(b),'es'));
  const focused=document.activeElement;
  const focusedRoute=focused?.dataset.routeIndex;
  const focusedGroup=focused?.dataset.group;
  byId('routeGroupLabel').textContent=explorer.mode==='origin'?'Región de origen':'Puerto de llegada';
  byId('routeGroups').replaceChildren(...keys.map(key=>{
    const button=document.createElement('button');
    button.type='button';
    button.dataset.group=key;
    button.textContent=groupName(key)+' ';
    const count=document.createElement('span');
    count.textContent=fmt(groups.get(key));
    button.append(count);
    button.setAttribute('aria-pressed',key===explorer.group);
    button.onclick=()=>changeExplorer({group:key});
    return button;
  }));
  byId('routeGroupTitle').textContent=groupName(explorer.group);
  byId('routeState').value=explorer.state;
  const visible=visibleRoutes().sort((a,b)=>stateRank[severityOf(a)]-stateRank[severityOf(b)]);
  byId('routeList').replaceChildren(...visible.map(vessel=>{
    const index=routes.indexOf(vessel);
    const button=document.createElement('button');
    button.type='button';
    button.className='route-item'+(selected===index?' active':'');
    button.dataset.routeIndex=String(index);
    button.setAttribute('aria-pressed',selected===index);
    const journey=document.createElement('strong'), name=document.createElement('span');
    journey.textContent=portLabel(vessel.from).split(',')[0]+' → '+portLabel(vessel.to).split(',')[0];
    name.textContent=vessel.ship;
    button.append(journey,name,explorerBadge(vessel));
    button.onclick=()=>revealVessel(index);
    return button;
  }));
  byId('statRoutes').textContent=String(routes.length).padStart(2,'0');
  byId('routeCount').textContent=fmt(visible.length)+(visible.length===1?' ruta visible':' rutas visibles');
  byId('routeEmpty').classList.toggle('hidden',visible.length!==0);
  const match=focusedRoute!==undefined ? [...byId('routeList').children].find(button=>button.dataset.routeIndex===focusedRoute) :
    [...byId('routeGroups').children].find(button=>button.dataset.group===focusedGroup);
  match?.focus({preventScroll:true});
}

function explorerBadge(vessel) {
  const severity=severityOf(vessel);
  const badge=document.createElement('span');
  badge.className='explorer-status '+severity;
  const icon=document.createElement('i');
  icon.setAttribute('aria-hidden','true');
  icon.textContent={normal:'●',ordinary:'▲',critical:'!'}[severity];
  const label={normal:vessel.status==='Arribado'?'Arribado':'Ruta normal',ordinary:vessel.status+' · No crítica',critical:vessel.status+' · Crítica'};
  badge.append(icon,label[severity]);
  return badge;
}

function updateExplorerSummary(vessel) {
  byId('explorerSummary').classList.toggle('hidden',!vessel);
  if(!vessel) return;
  byId('explorerShip').textContent=vessel.ship;
  byId('explorerStatus').replaceChildren(explorerBadge(vessel));
  byId('explorerCargo').textContent=vessel.cargo+' · '+fmt(vessel.tonnes)+' t';
  const initial=dateTime.format(simulatedDate(vessel,Number(vessel.days)))+' UTC';
  const revised=arrival(vessel);
  const change=vessel.alert && revised!==initial;
  byId('explorerArrival').textContent='Llegada simulada · '+(change?initial+' → '+revised:revised);
  const minutes=vessel.alert?.alternative ? Math.round((vessel.alert.days-Number(vessel.days))*1440):0;
  const absMinutes=Math.abs(minutes);
  const duration=[Math.floor(absMinutes/60)?fmt(Math.floor(absMinutes/60))+' h':'',absMinutes%60?fmt(absMinutes%60)+' min':''].filter(Boolean).join(' ');
  byId('explorerDelay').textContent=minutes>0?'+'+duration+' de retraso':minutes<0?duration+' antes':'';
  byId('explorerSimulate').disabled=Boolean(vessel.alert) || vessel.status==='Arribado';
}

function toggleVesselPanel(show) {
  byId('vesselPanel').classList.toggle('hidden',!show);
  byId('toggleVesselDetail').setAttribute('aria-expanded',show);
  byId('toggleVesselDetail').textContent=show?'Ocultar detalle del buque':'Ver detalle del buque';
}

function changeExplorer(changes) {
  Object.assign(explorer,changes);
  if(selected!==null && !visibleRoutes().includes(routes[selected])) {
    selected=null;
    toggleVesselPanel(false);
  }
  if(selected===null) {
    const hasLongRoute=visibleRoutes().some(vessel=>vessel.normal.length>6000);
    fitOverview(hasLongRoute?'global':'regional');
  }
  updateUI();
  redraw();
}
for(const button of document.querySelectorAll('[data-explorer-mode]')) {
  button.onclick=()=>{
    if(button.dataset.explorerMode===explorer.mode) return;
    explorer.mode=button.dataset.explorerMode;
    const group=selected===null?(explorer.mode==='origin'?'Oceanía':'FJSUV'):groupKey(routes[selected]);
    for(const toggle of document.querySelectorAll('[data-explorer-mode]')){
      toggle.setAttribute('aria-pressed',toggle===button);
    }
    changeExplorer({group});
  };
}
byId('routeState').onchange=event=>changeExplorer({state:event.target.value});

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
  if(alternative) measure(alternative);
  return {point:threatPoint,label,message,alternative,severity,eventPosition:point,
    eventDays:vessel.elapsed,days:vessel.elapsed+(alternative?.length ?? 0)/vessel.speed};
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
  changeExplorer({});
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
  else if(view==='mando' && selected!==null) updateEta(routes[selected]);
  requestAnimationFrame(tick);
}

const titles={
  mando:['Control de Mando','Monitoreo simulado del abastecimiento alimentario marítimo en Oceanía','VISTA GENERAL'],
  reportes:['Reportes','Registro de embarcaciones y trayectorias','RESUMEN'],
  sobre:['Sobre DRUA','','']
};
function showView(next) {
  view=next;
  document.querySelector('main').dataset.view=view;
  byId('app').classList.toggle('report-view',view==='reportes');
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
  if(view!=='reportes' && previewVessel) closeFleetDetail();
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
byId('fleetSearch').oninput=renderFleetCards;
byId('fleetCargo').onchange=renderFleetCards;
for(const button of document.querySelectorAll('[data-fleet-filter]')) {
  button.onclick=()=>{
    fleetFilter=button.dataset.fleetFilter;
    for(const option of document.querySelectorAll('[data-fleet-filter]')) {
      option.setAttribute('aria-pressed',option===button);
    }
    renderFleetCards();
  };
}
byId('closeFleetDetail').onclick=()=>{
  const active=byId('fleetCards').querySelector('.is-previewed');
  closeFleetDetail();
  if(active) {
    active.tabIndex=-1;
    active.focus({preventScroll:true});
  }
};
byId('viewFleetRoute').onclick=()=>{
  const index=routes.indexOf(previewVessel);
  if(index===-1) return;
  showView('mando');
  selectVessel(index);
  byId('map').scrollIntoView({block:'nearest'});
};

byId('startGuide').onclick=()=>showView('mando');
byId('closeVessel').onclick=()=>{
  toggleVesselPanel(false);
  byId('toggleVesselDetail').focus({preventScroll:true});
};
byId('toggleVesselDetail').onclick=()=>toggleVesselPanel(byId('vesselPanel').classList.contains('hidden'));
byId('explorerSimulate').onclick=()=>byId('simulate').click();
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
  const registration=byId('registerDialog');
  byId('openRegister').onclick=()=>{
    registration.showModal();
    form.querySelector('[data-step="'+step+'"] input, [data-step="'+step+'"] select')?.focus();
  };
  byId('closeRegister').onclick=()=>registration.close();
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
    registration.close();
    resetFields();
    setStep(1);
    showView('mando');
    selectVessel(routes.length-1);
    byId('map').scrollIntoView({behavior:'smooth',block:'nearest'});
  };
}

initRegistration();
updateUI();
redraw();
fitOverview('regional');
let previousMapSize = map.getSize();
new ResizeObserver(()=>{
  const container=map.getContainer();
  if (!container.clientWidth || !container.clientHeight) return;
  map.invalidateSize({pan:false,debounceMoveend:true});
  const size=map.getSize();
  if (size.equals(previousMapSize)) return;
  previousMapSize=size;
  if (mapMode==='route' && selected!==null) selectVessel(selected);
  else fitOverview(mapMode);
}).observe(map.getContainer());
requestAnimationFrame(tick);

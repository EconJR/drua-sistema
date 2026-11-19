'use strict';

const [seaNodes, seaEdges, seaPorts] = maritimeData;
const seaLinks = seaNodes.map(() => []);
const strategicPassages = {
  panama: 'Canal de Panamá', suez: 'Canal de Suez', ormuz: 'Estrecho de Ormuz',
  malacca: 'Estrecho de Malaca', gibraltar: 'Estrecho de Gibraltar',
  babalmandab: 'Bab el-Mandeb', chili: 'Paso de Drake', south_africa: 'Cabo de Buena Esperanza',
  pacific_ocean: 'Pacífico abierto', sunda: 'Estrecho de Sonda'
};
const destinationRegions = new Set('AU NZ FJ PG SB VU WS TO KI TV NR FM MH PW NC PF GU MP AS CK NU WF'.split(' '));
for (const [index, [a, b, km, passage]] of seaEdges.entries()) {
  if (['northwest','bering'].includes(passage)) continue;
  seaLinks[a].push({to:b, km, passage, index});
  seaLinks[b].push({to:a, km, passage, index});
}

function longitudeDelta(a,b) {
  return ((b-a+540)%360)-180;
}

function seaDistance(a,b) {
  const rad = Math.PI/180;
  const h = Math.sin((b[0]-a[0])*rad/2)**2
    + Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(longitudeDelta(a[1],b[1])*rad/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(1,h)));
}

function portPosition(code) {
  const [, , lon, lat] = seaPorts[code];
  return [lat, lon];
}

const nearestPorts = new Map();
function portNode(code) {
  if (nearestPorts.has(code)) return nearestPorts.get(code);
  const point = portPosition(code);
  let best = -1, distance = Infinity;
  seaNodes.forEach(([lon, lat], id) => {
    if (!seaLinks[id].length) return;
    const km = seaDistance(point,[lat,lon]);
    if (km < distance) { best = id; distance = km; }
  });
  nearestPorts.set(code,best);
  return best;
}

function routeBetween(start, end, {required, blockedEdge, blockedPassage, avoidEdges} = {}) {
  const width = seaNodes.length;
  const target = end+(required ? width : 0);
  const costs = new Float64Array(width*2).fill(Infinity);
  const parents = new Int32Array(width*2).fill(-1);
  const incoming = new Int32Array(width*2).fill(-1);
  const heap = [];
  const push = (id,cost) => {
    let i = heap.length;
    heap.push([id,cost]);
    while (i && heap[(i-1)>>1][1] > cost) {
      heap[i] = heap[(i-1)>>1];
      i = (i-1)>>1;
    }
    heap[i] = [id,cost];
  };
  costs[start] = 0;
  push(start,0);
  while (heap.length) {
    const [id,cost] = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (2*i+1 < heap.length) {
        let child = 2*i+1;
        if (child+1 < heap.length && heap[child+1][1] < heap[child][1]) child++;
        if (heap[child][1] >= last[1]) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    if (cost !== costs[id]) continue;
    if (id === target) break;
    for (const edge of seaLinks[id%width]) {
      if (edge.index === blockedEdge || (blockedPassage && edge.passage === blockedPassage) || avoidEdges?.has(edge.index)) continue;
      const passed = required && (id>=width || edge.passage===required);
      const next = edge.to+(passed ? width : 0);
      if (cost+edge.km >= costs[next]) continue;
      costs[next] = cost+edge.km;
      parents[next] = id;
      incoming[next] = edge.index;
      push(next,costs[next]);
    }
  }
  if (!Number.isFinite(costs[target])) return null;
  const path = [], edges = [];
  for (let id=target; id!==-1; id=parents[id]) {
    const [lon,lat] = seaNodes[id%width];
    path.push([lat,lon]);
    if (incoming[id]!==-1) edges.push(incoming[id]);
  }
  return {path:path.reverse(),edges:edges.reverse(),km:costs[target]};
}

function sailingPlan(origin,destination,required) {
  const plan = routeBetween(portNode(origin),portNode(destination),{required});
  if (!plan) return null;
  return {
    ...plan, path:[portPosition(origin),...plan.path,portPosition(destination)],
    edges:[-1,...plan.edges,-1]
  };
}

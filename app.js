/* Western Ghats ESA Atlas.
   All data is static JSON under data/ and api/v1/ -- there is no backend.
   Display geometry is topology-simplified (~33 m); when a single village is
   opened its full-resolution geometry is fetched from the API. */
'use strict';

const STATES = [
  ['GA', 'Goa'], ['GJ', 'Gujarat'], ['KA', 'Karnataka'],
  ['KL', 'Kerala'], ['MH', 'Maharashtra'], ['TN', 'Tamil Nadu']
];
const COLOR = {
  whole_village: '#2e7d32', bifurcated_village: '#f9a825',
  notified_forest: '#00695c', kerala_village: '#5e35b1',
  kerala_bifurcated_village: '#8e63d6'
};
const CAT_LABEL = {
  whole_village: 'Whole village', bifurcated_village: 'Bifurcated — part only',
  notified_forest: 'Notified forest', kerala_village: 'Kerala village (portion-wise)',
  kerala_bifurcated_village: 'Kerala village, bifurcated'
};
const $ = s => document.querySelector(s);
const fmt = n => n == null ? '—' : n.toLocaleString('en-IN',
  { maximumFractionDigits: n < 100 ? 2 : 0 });

const state = { rows: [], byCode: new Map(), summary: null, sel: null, filtered: [] };
const busy = (on, msg) => { const l = $('#loading'); l.hidden = !on; if (msg) l.textContent = msg; };

/* ---------------- map ---------------- */
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      base: {
        type: 'raster', tileSize: 256,
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
                'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
                'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxzoom: 19
      }
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  },
  center: [75.4, 14.2], zoom: 5.1, maxZoom: 16, minZoom: 3.5
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }));
map.addControl(new maplibregl.AttributionControl({ compact: true }));

/* ---------------- boot ----------------
   Attributes and the whole sidebar load independently of the map, so filtering,
   the not-mapped list and downloads still work if WebGL is unavailable. */
(async function initData() {
  busy(true, 'Loading village records…');
  try {
    const [summary, ...attrs] = await Promise.all([
      fetch('api/v1/summary.json').then(r => r.json()),
      ...STATES.map(([c]) => fetch(`api/v1/states/${c}.json`).then(r => r.json()))
    ]);
    state.summary = summary;
    attrs.forEach(a => a.rows.forEach(r => {
      state.rows.push(r);
      if (r.censuscode) state.byCode.set(String(r.censuscode), r);
    }));
    buildFilters(); buildDownloads(); loadMissing(); applyFilter();
    $('#ver').textContent = `${summary.version} · ${fmt(summary.matched)} villages`;
    busy(false);
  } catch (e) {
    busy(true, 'Could not load village records. Check the console.');
    console.error(e);
  }
})();

map.on('error', e => console.error('map:', e && e.error));

map.on('load', async () => {
  try {
    const topos = await Promise.all(
      STATES.map(([c]) => fetch(`data/villages/${c}.topo.json`).then(r => r.json())));
    const feats = [];
    topos.forEach(t => {
      const o = t.objects[Object.keys(t.objects)[0]];
      topojson.feature(t, o).features.forEach(f => {
        if (f.properties.censuscode) f.id = String(f.properties.censuscode);
        feats.push(f);
      });
    });
    map.addSource('villages', {
      type: 'geojson', data: { type: 'FeatureCollection', features: feats },
      promoteId: 'censuscode'
    });
    map.addLayer({
      id: 'v-fill', type: 'fill', source: 'villages',
      paint: {
        'fill-color': ['match', ['get', 'esa_category'],
          ...Object.entries(COLOR).flat(), '#777'],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.85, 0.42]
      }
    });
    map.addLayer({
      id: 'v-line', type: 'line', source: 'villages',
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#111', '#3c4a3c'],
        'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.4, 0.35]
      }
    });

    const outlines = await fetch('data/states.geojson').then(r => r.json());
    map.addSource('states', { type: 'geojson', data: outlines });
    map.addLayer({
      id: 's-line', type: 'line', source: 'states',
      paint: { 'line-color': '#243024', 'line-width': 1.4, 'line-opacity': 0.75 }
    });

    state.mapReady = true;
    applyFilter();                 // re-apply now that the layers exist
  } catch (e) {
    console.error('map layers:', e);
  }
});

/* ---------------- interaction ---------------- */
map.on('click', 'v-fill', e => openVillage(e.features[0].properties.censuscode));
map.on('mouseenter', 'v-fill', () => map.getCanvas().style.cursor = 'pointer');
map.on('mouseleave', 'v-fill', () => map.getCanvas().style.cursor = '');

let selId = null;
function highlight(code) {
  if (!map.getSource || !map.getSource('villages')) { selId = code == null ? null : String(code); return; }
  if (selId !== null) map.setFeatureState({ source: 'villages', id: selId }, { sel: false });
  selId = code == null ? null : String(code);
  if (selId !== null) map.setFeatureState({ source: 'villages', id: selId }, { sel: true });
}

async function openVillage(code) {
  code = String(code);
  const row = state.byCode.get(code);
  highlight(code);
  const d = $('#detail');
  d.hidden = false;
  d.innerHTML = `<button class="close" aria-label="Close">&times;</button><p>Loading…</p>`;
  d.querySelector('.close').onclick = () => { d.hidden = true; highlight(null); };
  let f = null;
  try { f = await fetch(`api/v1/villages/${code}.json`).then(r => r.ok ? r.json() : null); }
  catch (e) { /* fall back to the attributes we already have */ }
  const p = (f && f.properties) || row;
  if (!p) { d.innerHTML = `<button class="close">&times;</button><p>No record for ${code}.</p>`;
            d.querySelector('.close').onclick = () => { d.hidden = true; highlight(null); }; return; }

  const flags = [];
  if (p.bifurcated) flags.push('The gazette marks this village with <b>*</b>: only <b>part</b> of it lies inside the ESA. This polygon is the whole village and therefore <b>over-states</b> the ESA area.');
  if (String(p.gz_state) === 'KERALA') flags.push('Kerala defines its ESA as village <b>portions</b>. Use the official Kerala KML layer for the true boundary.');
  if (p.scope === 'state') flags.push('Matched at state-wide scope — the district and taluka in the gazette did not resolve, so this pairing is less certain.');
  if (p.score != null && p.score < 90) flags.push(`Name similarity was ${p.score}, below the 90 mark — worth checking against the gazette.`);

  d.innerHTML = `
    <button class="close" aria-label="Close">&times;</button>
    <h3>${esc(p.gz_village)}</h3>
    <div class="note">${esc(p.gz_taluka)}, ${esc(p.gz_district)}, ${esc(p.gz_state)}</div>
    <span class="badge" style="background:${COLOR[p.esa_category] || '#777'}">${CAT_LABEL[p.esa_category] || p.esa_category}</span>
    <dl>
      <dt>Area</dt><dd>${fmt(p.area_km2)} km²</dd>
      <dt>Gazette S.No.</dt><dd>${esc(p.gz_sno)}</dd>
      <dt>Census name</dt><dd>${esc(p.cen_village)}</dd>
      <dt>Census sub-district</dt><dd>${esc(p.cen_subdistrict)}</dd>
      <dt>Census district</dt><dd>${esc(p.cen_district)}</dd>
      <dt>Census code</dt><dd>${esc(p.censuscode)}</dd>
      <dt>LGD code</dt><dd>${esc(p.lgd_villagecode)}</dd>
      <dt>Match score</dt><dd>${esc(p.score)} (${esc(p.scope)})</dd>
    </dl>
    ${flags.map(t => `<div class="flag">${t}</div>`).join('')}
    <a class="btn" href="api/v1/villages/${code}.json" download>Download this village (GeoJSON)</a>`;
  d.querySelector('.close').onclick = () => { d.hidden = true; highlight(null); };

  if (f && f.geometry && state.mapReady) {
    const b = new maplibregl.LngLatBounds();
    const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : b.extend(c);
    walk(f.geometry.coordinates);
    map.fitBounds(b, { padding: 70, maxZoom: 13, duration: 700 });
  }
}
const esc = v => v == null || v === '' ? '—' :
  String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- filters ---------------- */
function buildFilters() {
  const s = $('#f-state');
  STATES.forEach(([c, n]) => s.add(new Option(n, n.toUpperCase())));
  s.onchange = () => { fillDistricts(); applyFilter(); };
  $('#f-district').onchange = () => { fillTalukas(); applyFilter(); };
  $('#f-taluka').onchange = applyFilter;
  $('#f-search').oninput = applyFilter;
}
const uniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y));

function fillDistricts() {
  const st = $('#f-state').value, d = $('#f-district');
  d.length = 1; d.disabled = !st;
  if (st) uniq(state.rows.filter(r => r.gz_state === st).map(r => r.gz_district))
    .forEach(v => d.add(new Option(v, v)));
  fillTalukas();
}
function fillTalukas() {
  const st = $('#f-state').value, di = $('#f-district').value, t = $('#f-taluka');
  t.length = 1; t.disabled = !di;
  if (di) uniq(state.rows.filter(r => r.gz_state === st && r.gz_district === di)
    .map(r => r.gz_taluka)).forEach(v => t.add(new Option(v, v)));
}

function applyFilter() {
  const st = $('#f-state').value, di = $('#f-district').value,
        tl = $('#f-taluka').value, q = $('#f-search').value.trim().toLowerCase();
  let rows = state.rows;
  if (st) rows = rows.filter(r => r.gz_state === st);
  if (di) rows = rows.filter(r => r.gz_district === di);
  if (tl) rows = rows.filter(r => r.gz_taluka === tl);
  if (q) rows = rows.filter(r =>
    String(r.gz_village).toLowerCase().includes(q) ||
    String(r.cen_village || '').toLowerCase().includes(q));
  state.filtered = rows;

  const codes = rows.map(r => String(r.censuscode)).filter(c => c && c !== 'null');
  const narrowed = rows.length !== state.rows.length;
  const filter = narrowed
    ? ['in', ['get', 'censuscode'], ['literal', codes]]
    : null;
  ['v-fill', 'v-line'].forEach(l => map.getLayer(l) && map.setFilter(l, filter));

  renderResults(rows); renderStats(rows, st);
  if (narrowed && rows.length) fitTo(codes);
}

function fitTo(codes) {
  if (!state.mapReady) return;
  const set = new Set(codes);
  const src = map.getSource('villages'); if (!src || !src._data) return;
  const b = new maplibregl.LngLatBounds();
  const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : b.extend(c);
  let n = 0;
  for (const f of src._data.features) {
    if (!set.has(String(f.properties.censuscode))) continue;
    walk(f.geometry.coordinates); if (++n > 400) break;
  }
  if (n) map.fitBounds(b, { padding: 50, maxZoom: 12, duration: 700 });
}

function renderResults(rows) {
  const box = $('#results');
  if (rows.length === state.rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = rows.slice(0, 250).map(r =>
    `<div class="hit" tabindex="0" data-c="${esc(r.censuscode)}">${esc(r.gz_village)}
      <small>${esc(r.gz_taluka)}, ${esc(r.gz_district)} · ${fmt(r.area_km2)} km²</small></div>`
  ).join('') + (rows.length > 250
    ? `<div class="note">…and ${fmt(rows.length - 250)} more. Narrow the filter.</div>` : '');
  box.querySelectorAll('.hit').forEach(el => {
    const go = () => openVillage(el.dataset.c);
    el.onclick = go;
    el.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}

function renderStats(rows, st) {
  const area = rows.reduce((a, r) => a + (r.area_km2 || 0), 0);
  const s = state.summary;
  let notified = null, unmatched = null;
  if (st) { const e = s.states.find(x => x.state === st); notified = e.notified_km2; unmatched = e.unmatched; }
  else { notified = s.states.reduce((a, x) => a + x.notified_km2, 0);
         unmatched = s.states.reduce((a, x) => a + x.unmatched, 0); }
  const showRatio = rows.length === (st
    ? s.states.find(x => x.state === st).villages : s.matched);
  const pct = showRatio && notified ? Math.min(100, area / notified * 100) : null;
  $('#stats').innerHTML = `
    <h3>${st ? st.replace('TAMIL NADU', 'Tamil Nadu') : 'All six states'}</h3>
    <div class="statrow"><span>Villages shown</span><b>${fmt(rows.length)}</b></div>
    <div class="statrow"><span>Mapped area</span><b>${fmt(area)} km²</b></div>
    ${showRatio ? `
      <div class="statrow"><span>Notified area</span><b>${fmt(notified)} km²</b></div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="note">${(area / notified * 100).toFixed(0)}% of the area stated in Annexure A.
        ${fmt(unmatched)} gazette row${unmatched === 1 ? '' : 's'} not mapped.</div>`
      : `<div class="note">Filtered selection — area is the sum of the villages shown.</div>`}`;
}

/* ---------------- layers ---------------- */
$('#l-villages').onchange = e => ['v-fill', 'v-line'].forEach(l =>
  map.getLayer(l) && map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none'));

$('#l-points').onchange = async e => {
  if (e.target.checked && !map.getSource('pts')) {
    busy(true, 'Loading boundary points…');
    map.addSource('pts', { type: 'geojson', data: await fetch('data/points.geojson').then(r => r.json()) });
    map.addLayer({ id: 'pts', type: 'circle', source: 'pts',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.6, 12, 6],
               'circle-color': '#c62828', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    map.on('click', 'pts', ev => {
      const p = ev.features[0].properties;
      new maplibregl.Popup({ closeButton: true })
        .setLngLat(ev.lngLat)
        .setHTML(`<b>Annexure B point ${esc(p.point)}</b><br>${esc(p.state)}<br>
                  ${(+p.lat).toFixed(4)}, ${(+p.lon).toFixed(4)}<br>
                  <small>gazette page ${esc(p.page)}</small>`)
        .addTo(map);
    });
    busy(false);
  } else if (map.getLayer('pts')) {
    map.setLayoutProperty('pts', 'visibility', e.target.checked ? 'visible' : 'none');
  }
};

$('#l-kerala').onchange = async e => {
  if (e.target.checked && !map.getSource('kl')) {
    busy(true, 'Loading Kerala official ESA…');
    try {
      map.addSource('kl', { type: 'geojson', data: await fetch('data/kerala_official.geojson').then(r => r.json()) });
      map.addLayer({ id: 'kl-fill', type: 'fill', source: 'kl',
        paint: { 'fill-color': '#0277bd', 'fill-opacity': 0.3 } }, 'v-line');
      map.addLayer({ id: 'kl-line', type: 'line', source: 'kl',
        paint: { 'line-color': '#01579b', 'line-width': 1.3 } });
    } catch (err) { console.error(err); }
    busy(false);
  } else {
    ['kl-fill', 'kl-line'].forEach(l => map.getLayer(l) &&
      map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none'));
  }
};

/* ---------------- not-mapped tab ---------------- */
async function loadMissing() {
  const d = await fetch('api/v1/unmatched.json').then(r => r.json());
  const by = {};
  d.rows.forEach(r => { (by[r.state] = by[r.state] || []).push(r); });
  $('#missing-summary').innerHTML = `
    <div class="card"><div class="statrow"><span>Gazette rows</span><b>${fmt(state.summary.gazette_rows)}</b></div>
    <div class="statrow"><span>Mapped</span><b>${fmt(state.summary.matched)}</b></div>
    <div class="statrow"><span>Not mapped</span><b>${fmt(d.count)}</b></div>
    <div class="bar"><span style="width:${state.summary.matched / state.summary.gazette_rows * 100}%"></span></div>
    <div class="note">${(state.summary.matched / state.summary.gazette_rows * 100).toFixed(1)}% of gazette rows have a polygon.</div></div>`;
  $('#missing-list').innerHTML = Object.entries(by).sort((a, b) => b[1].length - a[1].length)
    .map(([st, rs]) => `<div class="card"><h3>${esc(st)} — ${rs.length}</h3>` +
      rs.map(r => `<div class="miss"><b>${esc(r.village)}</b>
        <small>${esc(r.taluka)}, ${esc(r.district)} · S.No. ${esc(r.sno)}</small>
        <small>${esc(r.reason)}</small></div>`).join('') + '</div>').join('');
}

/* ---------------- downloads ---------------- */
function buildDownloads() {
  $('#downloads').innerHTML = state.summary.states.map(s => `
    <div class="dlgroup">
      <h3>${esc(s.state === 'TAMIL NADU' ? 'Tamil Nadu' : s.state)}</h3>
      <p>${fmt(s.villages)} villages · ${fmt(s.area_km2)} km²</p>
      <div class="dlrow">
        <a href="downloads/WG_ESA_2024_${s.code}.geojson" download>GeoJSON</a>
        <a href="downloads/WG_ESA_2024_${s.code}_shapefile.zip" download>Shapefile</a>
        <a href="downloads/WG_ESA_2024_${s.code}.kml" download>KML</a>
        <a href="downloads/WG_ESA_2024_${s.code}.csv" download>CSV</a>
      </div>
    </div>`).join('');
}

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  document.querySelectorAll('.tabpane').forEach(p =>
    p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
});

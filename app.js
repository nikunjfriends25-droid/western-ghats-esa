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
const CAT_SHORT = {
  whole_village: 'Whole village', bifurcated_village: 'Bifurcated',
  notified_forest: 'Notified forest', kerala_village: 'Kerala',
  kerala_bifurcated_village: 'Kerala, bifurcated'
};
const CAT_HELP = {
  whole_village: 'The entire revenue village lies inside the ESA.',
  bifurcated_village: 'Gazette marks * — only part of the village is inside. The polygon is the whole village and over-states the ESA.',
  notified_forest: 'A Reserve Forest or forest block rather than a revenue village.',
  kerala_village: 'Kerala defines its ESA as village portions; this polygon is the whole village.',
  kerala_bifurcated_village: 'Kerala row also marked * in the gazette.'
};
const $ = s => document.querySelector(s);
const fmt = n => typeof n === 'number' && isFinite(n)
  ? n.toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 })
  : esc(n);

const state = { rows: [], byCode: new Map(), summary: null, filtered: [], cats: new Set() };
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
      if (r.vid) state.byCode.set(String(r.vid), r);
    }));
    buildFilters(); buildCats(); buildDownloads(); loadMissing(); applyFilter();
    $('#ver').textContent = `${fmt(summary.matched)} villages · ${fmt(summary.gazette_rows)} gazette rows`;
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
        if (f.properties.vid) f.id = String(f.properties.vid);
        feats.push(f);
      });
    });
    map.addSource('villages', {
      type: 'geojson', data: { type: 'FeatureCollection', features: feats },
      promoteId: 'vid'
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
map.on('click', 'v-fill', e => openVillage(e.features[0].properties.vid));
map.on('mouseenter', 'v-fill', () => map.getCanvas().style.cursor = 'pointer');
map.on('mouseleave', 'v-fill', () => map.getCanvas().style.cursor = '');

let selId = null;
function highlight(code) {
  if (!map.getSource || !map.getSource('villages')) { selId = code == null ? null : String(code); return; }
  if (selId !== null) map.setFeatureState({ source: 'villages', id: selId }, { sel: false });
  selId = code == null ? null : String(code);
  if (selId !== null) map.setFeatureState({ source: 'villages', id: selId }, { sel: true });
}

const VID = /^[A-Za-z0-9_-]{1,32}$/;      // ids are census codes or gz-XX-NNNN

async function openVillage(code) {
  code = String(code);
  if (!VID.test(code)) { console.warn('ignoring malformed village id', code); return; }
  const row = state.byCode.get(code);
  highlight(code);
  const d = $('#detail');
  d.hidden = false;
  d.innerHTML = `<button class="close" aria-label="Close">&times;</button><p>Loading…</p>`;
  d.querySelector('.close').onclick = () => { d.hidden = true; highlight(null); };
  let f = null;
  try { f = await fetch('api/v1/villages/' + encodeURIComponent(code) + '.json')
              .then(r => r.ok ? r.json() : null); }
  catch (e) { /* fall back to the attributes we already have */ }
  const p = (f && f.properties) || row;
  if (!p) { d.innerHTML = `<button class="close">&times;</button><p>No record for ${esc(code)}.</p>`;
            d.querySelector('.close').onclick = () => { d.hidden = true; highlight(null); }; return; }

  const flags = [];
  if (p.bifurcated) flags.push('The gazette marks this village with <b>*</b>: only <b>part</b> of it lies inside the ESA. This polygon is the whole village and therefore <b>over-states</b> the ESA area.');
  if (String(p.gz_state) === 'KERALA') flags.push('Kerala defines its ESA as village <b>portions</b>. Use the official Kerala KML layer for the true boundary.');
  if (p.scope === 'state') flags.push('Matched at state-wide scope — the district and taluka in the gazette did not resolve, so this pairing is less certain.');
  if (p.score != null && p.score < 90) flags.push(`Name similarity was ${esc(p.score)}, below the 90 mark — worth checking against the gazette.`);

  d.innerHTML = `
    <button class="close" aria-label="Close">&times;</button>
    <h3>${esc(p.gz_village)}</h3>
    <div class="sub">${esc(p.gz_taluka)}, ${esc(p.gz_district)}, ${esc(p.gz_state)}</div>
    <span class="badge" style="background:${COLOR[p.esa_category] || '#777'}">${CAT_LABEL[p.esa_category] || esc(p.esa_category)}</span>
    <dl class="kv">
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
    ${renderCard(f && f.analysis)}
    <a class="btn" href="api/v1/villages/${encodeURIComponent(code)}.json" download>Download this village (GeoJSON)</a>`;
  d.querySelector('.close').onclick = () => { d.hidden = true; highlight(null); };

  if (f && f.geometry && state.mapReady) {
    const b = new maplibregl.LngLatBounds();
    const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : b.extend(c);
    walk(f.geometry.coordinates);
    map.fitBounds(b, { padding: 70, maxZoom: 13, duration: 700 });
  }
}
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
/* Village report card -- analysis 8. Rendered from the per-village API's
   `analysis` block; every figure is per whole village, so it inherits the
   bifurcated / Kerala over-statement caveat shown above it. */
function renderCard(a) {
  if (!a) return '';
  const row = (k, v, s) => v == null || v === '' ? '' :
    `<dt>${esc(k)}</dt><dd>${typeof v === 'number' ? fmt(v) : esc(v)}${s ? ' ' + s : ''}</dd>`;
  const sec = (title, body) => body.trim()
    ? `<h4>${esc(title)}</h4><dl class="kv">${body}</dl>` : '';

  const people = sec('People', [
    row('Population', a.population), row('Households', a.households),
    row('Scheduled Tribe', a.pop_st, a.st_pct != null ? `(${a.st_pct}%)` : ''),
    row('Literacy', a.literacy_pct, '%'),
    row('Land-dependent workers', a.land_dependent_pct, '%'),
    row('Density', a.pop_density, '/km²')].join(''));

  const land = sec('Land cover', [
    row('Natural forest', a.natural_forest_pct, '%'),
    row('Plantation', a.plantation_pct, '%'),
    row('Agriculture', a.agri_pct, '%'),
    row('Degraded forest', a.wl_degraded_forest_pct, '%'),
    row('Built-up', a.lulc_builtup_pct, '%')].join(''));

  const prot = sec('Protection & tenure', [
    row('Protected / ESZ', a.protected_pct, '%'),
    row('Corridor / tiger reserve', a.connectivity_pct, '%'),
    row('Recorded Forest Area', a.rfa_pct, '%'),
    row('Outside Recorded Forest', a.outside_rfa_pct, '%'),
    row('Parks / sanctuaries', a.pa_names), row('ESZ', a.esz_names),
    row('Tiger reserve', a.tiger_names)].join(''));

  const admin = sec('Administration & setting', [
    row('Forest division', a.fsi_division), row('Forest range', a.fsi_range),
    row('Basin', a.basin), row('Sub-basin', a.subbasin),
    row('National highway', a.nh_km, 'km'), row('Highways', a.nh_names)].join(''));

  const gauge = (label, v, hint) => v == null ? '' :
    `<div class="gauge">
       <div class="g-top"><span>${esc(label)}</span><b>${v.toFixed(0)}<small>/100</small></b></div>
       <div class="g-track"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>
       <div class="g-hint">${esc(hint)}</div>
     </div>`;
  const BAND = {
    protect: ['#2f6d3a', 'High ecological value, low human pressure — the cheapest protection to deliver.'],
    negotiate: ['#d98324', 'High value and high pressure — protection here needs local agreement.'],
    'contested low-value': ['#b8433a', 'Low measured value but high pressure — the hardest case to justify.'],
    mixed: ['#6b7280', 'Middling on both axes.'],
    unclassified: ['#9aa29b', 'Too few indicators available to score.'],
  };
  const b = BAND[a.priority] || BAND.unclassified;
  const scores = (a.conservation_score != null || a.conflict_score != null) ? `
    <h4>Composite assessment</h4>
    <div class="scores">
      ${gauge('Conservation value', a.conservation_score, 'Forest, connectivity, recorded forest')}
      ${gauge('Human pressure', a.conflict_score, 'People, built-up, highways, land dependence')}
      ${a.priority ? `<div class="band" style="--b:${b[0]}">
          <span class="band-dot"></span><b>${esc(a.priority)}</b>
          <span class="band-why">${esc(b[1])}</span></div>` : ''}
      <p class="g-note">Both are percentile ranks against the other 4,330 ESA villages, not
        absolute measures. A score of 80 means higher than 80% of them.</p>
    </div>` : '';

  const notes = [];
  if (a.lulc_reliable === false) notes.push('Village is under 25 km², so land-cover shares are indicative only — the satellite mapping is 1:250,000.');
  if (a.rfa_gap_suspect) notes.push('No Recorded Forest Area recorded here despite high forest cover — likely a gap in the forest layer, not private land.');
  if (a.uninhabited) notes.push('Recorded as uninhabited in the 2011 Census.');

  return `<div class="an">${people}${land}${prot}${admin}${scores}
    ${notes.map(t => `<div class="flag">${t}</div>`).join('')}</div>`;
}

const esc = v => v == null || v === '' ? '—' : String(v).replace(/[&<>"'`]/g, c => ENT[c]);

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
  if (state.cats.size) rows = rows.filter(r => state.cats.has(r.esa_category));
  state.filtered = rows;

  const codes = rows.map(r => String(r.vid)).filter(c => c && c !== 'null' && c !== 'undefined');
  const narrowed = rows.length !== state.rows.length;
  const filter = narrowed
    ? ['in', ['get', 'vid'], ['literal', codes]]
    : null;
  ['v-fill', 'v-line'].forEach(l => map.getLayer(l) && map.setFilter(l, filter));

  renderResults(rows); renderStats(rows, st);
  // the right-hand insights panel recomputes from the same filtered set
  if (window.onSelectionChange) {
    const scope = tl ? tl + ', ' + di : di ? di + ' district'
      : st ? (st === 'TAMIL NADU' ? 'Tamil Nadu' : st[0] + st.slice(1).toLowerCase())
      : 'All six states';
    window.onSelectionChange(rows, scope + (q ? ' · "' + q + '"' : ''));
  }
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
    if (!set.has(String(f.properties.vid))) continue;
    walk(f.geometry.coordinates); if (++n > 400) break;
  }
  if (n) map.fitBounds(b, { padding: 50, maxZoom: 12, duration: 700 });
}

function renderResults(rows) {
  const box = $('#results');
  if (rows.length === state.rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = rows.slice(0, 250).map(r =>
    `<div class="hit" tabindex="0" role="button" data-c="${esc(r.vid)}">
       <b>${esc(r.gz_village)}</b>
       <small>${esc(r.gz_taluka)}, ${esc(r.gz_district)} · ${fmt(r.area_km2)} km²</small></div>`
  ).join('') + (rows.length > 250
    ? `<div class="more">…and ${fmt(rows.length - 250)} more. Narrow the filter.</div>` : '');
  box.querySelectorAll('.hit').forEach(el => {
    const go = () => openVillage(el.dataset.c);
    el.onclick = go;
    el.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}

function renderStats(rows, st) {
  const area = rows.reduce((a, r) => a + (r.area_km2 || 0), 0);
  const sum = state.summary;
  const whole = !st && !state.cats.size &&
    rows.length === sum.matched;
  const stateWhole = st && !state.cats.size &&
    rows.length === sum.states.find(x => x.state === st).villages;
  const notified = st ? sum.states.find(x => x.state === st).notified_km2
                      : sum.states.reduce((a, x) => a + x.notified_km2, 0);
  const unmapped = st ? sum.states.find(x => x.state === st).unmatched
                      : sum.states.reduce((a, x) => a + x.unmatched, 0);
  const comparable = whole || stateWhole;
  const ratio = area / notified;

  $('#metrics').innerHTML = `
    <div class="metric"><div class="k">Villages</div><div class="v">${fmt(rows.length)}</div></div>
    <div class="metric"><div class="k">Mapped area</div>
      <div class="v">${fmt(area)}<small>km²</small></div></div>
    ${comparable ? `
      <div class="metric wide">
        <div class="k">Against Annexure A</div>
        <div class="v">${(ratio * 100).toFixed(0)}<small>% of ${fmt(notified)} km² notified</small></div>
        <div class="bar"><i style="width:${Math.min(100, ratio * 100)}%"></i></div>
        <p class="hint">${fmt(unmapped)} gazette row${unmapped === 1 ? '' : 's'} in
          ${st ? 'this state' : 'the notification'} could not be mapped.</p>
      </div>`
    : `<div class="metric wide"><div class="k">Filtered subset</div>
         <p class="hint">Area is the sum of the ${fmt(rows.length)} village${rows.length === 1 ? '' : 's'}
         shown. Clear the filters to compare against the notified area.</p></div>`}`;
}

/* ---------------- zone category chips ---------------- */
function buildCats() {
  const counts = {};
  state.rows.forEach(r => counts[r.esa_category] = (counts[r.esa_category] || 0) + 1);
  const order = ['whole_village', 'bifurcated_village', 'notified_forest',
                 'kerala_village', 'kerala_bifurcated_village'];
  $('#cats').innerHTML = order.filter(c => counts[c]).map(c =>
    `<button class="chip" data-cat="${c}" aria-pressed="false" title="${CAT_HELP[c] || ''}">
       <i class="sw" style="background:${COLOR[c]}"></i>${CAT_SHORT[c]}
       <span class="n">${fmt(counts[c])}</span></button>`).join('');
  $('#cats').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const c = b.dataset.cat;
    if (state.cats.has(c)) state.cats.delete(c); else state.cats.add(c);
    syncCats(); applyFilter();
  });
  syncCats();
}
function syncCats() {
  const none = state.cats.size === 0;
  $('#cats').querySelectorAll('.chip').forEach(b =>
    b.setAttribute('aria-pressed', String(none || state.cats.has(b.dataset.cat))));
  $('#cat-hint').textContent = none
    ? 'All categories shown. Click one to isolate it.'
    : `Showing ${[...state.cats].map(c => CAT_SHORT[c]).join(', ')} only. Click again to clear.`;
}

/* ---------------- layers ---------------- */
const press = (el, on) => el.setAttribute('aria-pressed', String(on));

$('#l-points').onclick = async () => {
  const el = $('#l-points'), on = el.getAttribute('aria-pressed') !== 'true';
  press(el, on);
  if (!state.mapReady) return;
  if (on && !map.getSource('pts')) {
    busy(true, 'Loading boundary points…');
    map.addSource('pts', { type: 'geojson', data: await fetch('data/points.geojson').then(r => r.json()) });
    map.addLayer({ id: 'pts', type: 'circle', source: 'pts',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.6, 12, 6],
               'circle-color': '#c2382f', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
    map.on('click', 'pts', ev => {
      const p = ev.features[0].properties;
      new maplibregl.Popup().setLngLat(ev.lngLat).setHTML(
        `<b>Annexure B point ${esc(p.point)}</b><br>${esc(p.state)}<br>
         ${(+p.lat).toFixed(4)}, ${(+p.lon).toFixed(4)}<br>
         <small>gazette page ${esc(p.page)}</small>`).addTo(map);
    });
    busy(false);
  } else if (map.getLayer('pts')) {
    map.setLayoutProperty('pts', 'visibility', on ? 'visible' : 'none');
  }
};

$('#l-kerala').onclick = async () => {
  const el = $('#l-kerala'), on = el.getAttribute('aria-pressed') !== 'true';
  press(el, on);
  if (!state.mapReady) return;
  if (on && !map.getSource('kl')) {
    busy(true, 'Loading Kerala official ESA…');
    try {
      map.addSource('kl', { type: 'geojson', data: await fetch('data/kerala_official.geojson').then(r => r.json()) });
      // Drawn outline-dominant and on top: a solid fill would paint over the
      // village polygons and make the official layer look larger than them,
      // when in fact 98.1% of it sits inside.
      map.addLayer({ id: 'kl-fill', type: 'fill', source: 'kl',
        paint: { 'fill-color': '#0277bd', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'kl-line', type: 'line', source: 'kl',
        paint: { 'line-color': '#01579b', 'line-width': 1.6 } });
    } catch (err) { console.error(err); }
    busy(false);
  } else {
    ['kl-fill', 'kl-line'].forEach(l => map.getLayer(l) &&
      map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
  }
};

/* ---------------- not-mapped tab ---------------- */
async function loadMissing() {
  const d = await fetch('api/v1/unmatched.json').then(r => r.json());
  const by = {};
  d.rows.forEach(r => { (by[r.state] = by[r.state] || []).push(r); });
  const pct = state.summary.matched / state.summary.gazette_rows * 100;
  $('#missing-summary').innerHTML = `
    <div class="metrics">
      <div class="metric"><div class="k">Gazette rows</div><div class="v">${fmt(state.summary.gazette_rows)}</div></div>
      <div class="metric"><div class="k">Not mapped</div><div class="v">${fmt(d.count)}</div></div>
      <div class="metric wide"><div class="k">Coverage</div>
        <div class="v">${pct.toFixed(1)}<small>% of rows have a polygon</small></div>
        <div class="bar"><i style="width:${pct}%"></i></div></div>
    </div>`;
  $('#missing-list').innerHTML = Object.entries(by).sort((a, b) => b[1].length - a[1].length)
    .map(([st, rs]) => `<div class="block"><h3>${esc(st)} — ${rs.length}</h3>` +
      rs.map(r => `<div class="miss"><b>${esc(r.village)}</b>
        <small>${esc(r.taluka)}, ${esc(r.district)} · S.No. ${esc(r.sno)}</small>
        <small class="why">${esc(r.reason)}</small></div>`).join('') + '</div>').join('');
}

/* ---------------- downloads ---------------- */
function buildDownloads() {
  $('#downloads').innerHTML = state.summary.states.map(s => {
    const name = s.state === 'TAMIL NADU' ? 'Tamil Nadu'
      : s.state[0] + s.state.slice(1).toLowerCase();
    return `<div class="dl">
      <header><h4>${name}</h4>
        <span class="meta">${fmt(s.villages)} villages · ${fmt(s.area_km2)} km²</span></header>
      <div class="dlrow">
        <a href="downloads/WG_ESA_2024_${s.code}.geojson" download>GeoJSON</a>
        <a href="downloads/WG_ESA_2024_${s.code}_shapefile.zip" download>Shapefile</a>
        <a href="downloads/WG_ESA_2024_${s.code}.kml" download>KML</a>
        <a href="downloads/WG_ESA_2024_${s.code}.csv" download>CSV</a>
      </div></div>`;
  }).join('');
}

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x =>
    x.setAttribute('aria-selected', String(x === t)));
  document.querySelectorAll('.pane').forEach(p =>
    p.toggleAttribute('data-active', p.dataset.pane === t.dataset.tab));
});

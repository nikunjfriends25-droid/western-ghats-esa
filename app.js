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
  center: [75.4, 14.2], zoom: 5.1, maxZoom: 16, minZoom: 3.5,
  // without this the WebGL buffer is cleared after each frame and
  // getCanvas().toDataURL() returns a blank image, so the PDF export gets no map
  preserveDrawingBuffer: true
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
    // Symbology has to work at both ends of the zoom range. Zoomed out, 4,331 tiny
    // polygons each with a hairline outline turn into dark speckle that swamps the
    // fill; zoomed in, the outline is what separates one village from the next. So
    // opacity rises as you zoom out and the outline fades away entirely below z7.
    //
    // NOTE the shape of these expressions: ["zoom"] may ONLY be the input to a
    // top-level step/interpolate. Nesting the interpolate inside a ["case"] for the
    // selected-feature state is invalid, MapLibre rejects the whole paint property,
    // and the layer renders without it -- which is exactly how the fill disappeared.
    // So zoom is outermost and the selection case sits inside each stop output.
    const sel = ['boolean', ['feature-state', 'sel'], false];
    map.addLayer({
      id: 'v-fill', type: 'fill', source: 'villages',
      paint: {
        'fill-color': ['match', ['get', 'esa_category'],
          ...Object.entries(COLOR).flat(), '#777'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'],
          4, ['case', sel, 0.9, 0.92],
          7, ['case', sel, 0.9, 0.85],
          10, ['case', sel, 0.9, 0.62],
          13, ['case', sel, 0.9, 0.5]]
      }
    });
    map.addLayer({
      id: 'v-line', type: 'line', source: 'villages',
      paint: {
        'line-color': ['case', sel, '#111', '#3c4a3c'],
        'line-width': ['interpolate', ['linear'], ['zoom'],
          7, ['case', sel, 2.4, 0.2],
          10, ['case', sel, 2.4, 0.5],
          14, ['case', sel, 2.4, 1]],
        'line-opacity': ['interpolate', ['linear'], ['zoom'],
          6, ['case', sel, 1, 0],
          8, ['case', sel, 1, 0.45],
          12, ['case', sel, 1, 0.8]]
      }
    });

    const outlines = await fetch('data/states.geojson').then(r => r.json());
    map.addSource('states', { type: 'geojson', data: outlines });
    map.addLayer({
      id: 's-line', type: 'line', source: 'states',
      paint: {
        'line-color': '#243024',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 7, 1.3, 11, 1.8],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.85, 9, 0.6, 12, 0.35]
      }
    });

    state.mapReady = true;
    applyFilter();                 // re-apply now that the layers exist
    setVillageVisibility();
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
    <button class="btn btn-pdf-card" id="pdf-village">Export this village as PDF</button>
    <a class="btn" href="api/v1/villages/${encodeURIComponent(code)}.json" download>Download this village (GeoJSON)</a>`;
  d.querySelector('.close').onclick = () => { d.hidden = true; highlight(null); };
  if (window.stampInfo) window.stampInfo(d);
  const pdfBtn = d.querySelector('#pdf-village');
  if (pdfBtn && window.exportVillagePdf) {
    pdfBtn.onclick = () => window.exportVillagePdf(p, f && f.analysis);
  }

  if (f && f.geometry && state.mapReady) {
    const b = new maplibregl.LngLatBounds();
    const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : b.extend(c);
    walk(f.geometry.coordinates);
    map.fitBounds(b, { padding: 70, maxZoom: 13, duration: 700 });
  }
}
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
/* Village report card. Grouped, scannable, and every figure carries its unit.
   Rendered from the per-village API's `analysis` block; all of it is per WHOLE
   village, so it inherits the bifurcated / Kerala over-statement caveat. */

const BAND_STYLE = {
  'protect':                { c: '#2f6d3a', t: 'High ecological value with little human pressure — the cheapest protection to deliver.' },
  'protect, some pressure': { c: '#4f924f', t: 'High ecological value, moderate pressure. Worth protecting, with attention to local use.' },
  'negotiate':              { c: '#d98324', t: 'High ecological value AND high pressure. Protection here needs local agreement to hold.' },
  'secondary':              { c: '#7cb073', t: 'Moderate value, little pressure. Easy to include, lower ecological return.' },
  'moderate on both':       { c: '#8a9a86', t: 'Middling on both axes — no strong signal either way.' },
  'pressure-led':           { c: '#c2763a', t: 'Moderate value under heavy pressure. Restrictions will be felt more than they gain.' },
  'low priority':           { c: '#9aa29b', t: 'Little measured ecological value and little pressure.' },
  'contested':              { c: '#b8433a', t: 'Low measured value but high pressure — the hardest inclusion to justify.' },
  'unclassified':           { c: '#9aa29b', t: 'Too few indicators available to place this village.' },
};

function renderCard(a) {
  if (!a) return '';

  const n = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d == null ? 1 : d) : null;
  const stat = (label, val, unit, sub) => val == null ? '' :
    `<div class="vs"><span class="vs-l">${esc(label)}</span>
       <span class="vs-v">${val}${unit ? `<i>${unit}</i>` : ''}</span>
       ${sub ? `<span class="vs-s">${sub}</span>` : ''}</div>`;
  const group = (title, body) => body.trim() ? `<section class="vg">
      <h4>${esc(title)}</h4><div class="vs-grid">${body}</div></section>` : '';
  const listRow = (label, v) => !v || v === '—' ? '' :
    `<div class="vrow"><span>${esc(label)}</span><b>${esc(v)}</b></div>`;

  /* --- people --- */
  const people = group('People · Census 2011', [
    a.population == null
      ? `<div class="vs w"><span class="vs-l">Population</span>
           <span class="vs-v vs-na">no data</span>
           <span class="vs-s">${esc(a.population_status || 'not available')}</span></div>`
      : stat('Population', fmt(a.population), 'people'),
    stat('Households', a.households == null ? null : fmt(a.households), 'households'),
    stat('Scheduled Tribe', a.pop_st == null ? null : fmt(a.pop_st), 'people',
         a.st_pct != null ? n(a.st_pct) + '% of population' : ''),
    stat('Density', n(a.pop_density, 0), 'per km²'),
    stat('Literacy', n(a.literacy_pct), '%'),
    stat('Land-dependent', n(a.land_dependent_pct), '% of workers',
         'cultivators + labourers'),
  ].join(''));

  /* --- land cover --- */
  const cover = group('Land cover', [
    stat('Natural forest', n(a.natural_forest_pct), '% of area'),
    stat('Plantation', n(a.plantation_pct), '% of area'),
    stat('Agriculture', n(a.agri_pct), '% of area'),
    stat('Degraded forest', n(a.wl_degraded_forest_pct), '% of area'),
    stat('Built-up', n(a.lulc_builtup_pct), '% of area'),
  ].join(''));

  /* --- protection, as shares of this village --- */
  const shareBar = (label, pct, km2, colour) => pct == null ? '' :
    `<div class="vbar"><div class="vbar-t"><span>${esc(label)}</span>
       <b>${n(pct, 0)}<i>%</i></b></div>
     <div class="vbar-track"><i style="width:${Math.max(0, Math.min(100, pct))}%;
       background:${colour}"></i></div>
     ${km2 != null ? `<div class="vbar-s">${n(km2, 2)} km² of ${n(a.area_km2 || 0, 2)} km²</div>` : ''}</div>`;

  const prot = (a.protected_pct != null || a.rfa_pct != null) ? `<section class="vg">
      <h4>Protection &amp; tenure</h4>
      ${shareBar('Park, sanctuary or ESZ', a.protected_pct, a.protected_km2, '#1b7f5a')}
      ${shareBar('Corridor or tiger reserve', a.connectivity_pct, a.connect_km2, '#d98324')}
      ${shareBar('Recorded Forest Area', a.rfa_pct, a.rfa_km2, '#2f6d3a')}
      ${listRow('Parks / sanctuaries', a.pa_names)}
      ${listRow('Eco-Sensitive Zone', a.esz_names)}
      ${listRow('Tiger reserve', a.tiger_names)}
    </section>` : '';

  /* --- setting --- */
  const setting = (a.fsi_division || a.basin || a.nh_km) ? `<section class="vg">
      <h4>Setting</h4>
      ${listRow('Forest division', a.fsi_division)}
      ${listRow('Forest range', a.fsi_range)}
      ${listRow('River basin', a.basin)}
      ${listRow('Sub-basin', a.subbasin)}
      ${a.nh_km ? listRow('National highway', n(a.nh_km, 1) + ' km' +
          (a.nh_names ? ' · ' + a.nh_names : '')) : ''}
    </section>` : '';

  /* --- composite --- */
  const axis = (label, v, bandName, what) => v == null ? '' :
    `<div class="vax">
       <div class="vax-t"><span>${esc(label)}</span>
         <b>${n(v, 0)}<i>/100</i></b>
         ${bandName ? `<em class="vax-b">${esc(bandName)}</em>` : ''}</div>
       <div class="vax-track"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>
       <div class="vax-s">${esc(what)}</div>
     </div>`;

  const bs = BAND_STYLE[a.priority] || BAND_STYLE.unclassified;
  const composite = (a.conservation_score != null || a.conflict_score != null) ? `
    <section class="vg">
      <h4>Composite assessment</h4>
      ${axis('Conservation value', a.conservation_score, a.cons_band,
             'natural forest, corridors, recorded forest')}
      ${axis('Human pressure', a.conflict_score, a.risk_band,
             'population, built-up, highways, land dependence')}
      ${a.priority ? `<div class="vband" style="--b:${bs.c}">
          <b>${esc(a.priority)}</b><span>${esc(bs.t)}</span></div>` : ''}
      <p class="vnote">Both are percentile ranks against the other 4,330 ESA villages, not
        absolute measures — 84 means higher than 84% of them. Bands are terciles.</p>
    </section>` : '';

  /* --- caveats specific to this village --- */
  const notes = [];
  if (a.lulc_reliable === false)
    notes.push('Under 25 km², so land cover here is indicative only — the satellite mapping is 1:250,000.');
  if (a.rfa_gap_suspect)
    notes.push('No Recorded Forest Area despite high forest cover — most likely a gap in the forest layer, not private land.');
  if (a.uninhabited)
    notes.push('Recorded as uninhabited in the 2011 Census — the figure is a measured zero, not a missing value.');
  if (a.population == null && a.urban_body)
    notes.push('This is an urban local body. The census workbook behind this atlas covers rural villages only, so its residents are not counted in any population figure here.');

  return `<div class="an">${people}${cover}${prot}${setting}${composite}
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
       <span class="n">${fmt(counts[c])}</span></button>`).join('') +
    `<button class="chip chip-none" id="cat-none" aria-pressed="false"
       title="Hide the village polygons so the overlays and basemap are unobstructed">
       <i class="sw sw-none"></i>None</button>`;

  $('#cats').querySelectorAll('.chip[data-cat]').forEach(b => b.onclick = () => {
    state.hideVillages = false;              // picking a category brings them back
    const c = b.dataset.cat;
    if (state.cats.has(c)) state.cats.delete(c); else state.cats.add(c);
    syncCats(); applyFilter(); setVillageVisibility();
  });

  // "None" hides the village layer outright, so the overlays and the choropleth can
  // be read without 4,331 polygons on top. A visibility switch, not a filter.
  $('#cat-none').onclick = () => {
    state.hideVillages = !state.hideVillages;
    if (state.hideVillages) state.cats.clear();
    syncCats(); applyFilter(); setVillageVisibility();
  };
  syncCats();
}

window.setVillageVisibility = setVillageVisibility;
function setVillageVisibility() {
  if (!state.mapReady) return;
  // on Kerala's official basis the whole-village polygons would sit under the
  // notified ones and misrepresent which geometry the panel is reporting
  const v = (state.hideVillages || state.basisOfficial) ? 'none' : 'visible';
  ['v-fill', 'v-line'].forEach(l => map.getLayer(l) &&
    map.setLayoutProperty(l, 'visibility', v));
}

function syncCats() {
  const none = state.cats.size === 0;
  $('#cats').querySelectorAll('.chip[data-cat]').forEach(b =>
    b.setAttribute('aria-pressed',
      String(!state.hideVillages && (none || state.cats.has(b.dataset.cat)))));
  const nb = $('#cat-none');
  if (nb) nb.setAttribute('aria-pressed', String(!!state.hideVillages));
  $('#cat-hint').textContent = state.hideVillages
    ? 'Villages hidden. Click None again, or any category, to bring them back.'
    : none
      ? 'All categories shown. Click one to isolate it, or None to hide the villages.'
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
  // switching the reference layer off while the panel is measuring on it would
  // leave the two disagreeing about which geometry is on screen
  if (!on && state.basisOfficial && window.setBasis) { await window.setBasis('whole'); return; }
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

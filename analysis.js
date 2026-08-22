/* Analysis layer: choropleth, overlay layers, and the Analysis pane.
   Loaded after app.js and shares its top-level bindings (map, state, $, esc, fmt, COLOR,
   busy) via the global lexical environment. */
'use strict';

const METRIC = {
  population: ['Population', 'people'],
  pop_density: ['Population density', 'per km²'],
  st_pct: ['Scheduled Tribe share', '%'],
  land_dependent_pct: ['Land-dependent workers', '%'],
  natural_forest_pct: ['Natural forest', '%'],
  plantation_pct: ['Plantation', '%'],
  agri_pct: ['Agriculture', '%'],
  wl_degraded_forest_pct: ['Degraded forest', '%'],
  protected_pct: ['Protected area / ESZ', '%'],
  connectivity_pct: ['Corridor / tiger reserve', '%'],
  rfa_pct: ['Recorded Forest Area', '%'],
  outside_rfa_pct: ['Outside Recorded Forest', '%'],
  conservation_score: ['Conservation value', '0–100'],
  conflict_score: ['Human pressure', '0–100'],
};
const RAMP = ['#eef3e8', '#cfe0c3', '#a8c99a', '#7cb073', '#4f924f', '#2f6d3a'];

function metricValues(key) {
  const src = map.getSource && map.getSource('villages');
  if (!src || !src._data) return [];
  return src._data.features.map(f => f.properties[key])
    .filter(x => typeof x === 'number' && isFinite(x));
}

function quantileBreaks(vals, n) {
  const v = vals.slice().sort((a, b) => a - b);
  if (v.length < n) return null;
  const q = [];
  for (let i = 1; i < n; i++) q.push(v[Math.floor(i / n * v.length)]);
  return [...new Set(q)];
}

function applyMetric() {
  const sel = document.querySelector('#f-metric');
  if (!sel || !state.mapReady || !map.getLayer('v-fill')) return;
  const k = sel.value;
  const legend = document.querySelector('#legend');
  if (!k) {
    map.setPaintProperty('v-fill', 'fill-color',
      ['match', ['get', 'esa_category'], ...Object.entries(COLOR).flat(), '#777']);
    legend.innerHTML = '';
    return;
  }
  const breaks = quantileBreaks(metricValues(k), RAMP.length);
  if (!breaks || breaks.length < 2) {
    legend.innerHTML = '<p class="hint">Not enough data to shade this metric.</p>';
    return;
  }
  // -1 sentinel keeps "no data" visually distinct from a genuine zero
  const step = ['step', ['coalesce', ['get', k], -1], RAMP[0]];
  breaks.forEach((b, i) => step.push(b, RAMP[Math.min(i + 1, RAMP.length - 1)]));
  map.setPaintProperty('v-fill', 'fill-color',
    ['case', ['==', ['coalesce', ['get', k], -1], -1], '#d0d0d0', step]);

  const [label, unit] = METRIC[k] || [k, ''];
  legend.innerHTML =
    '<div class="ramp">' + RAMP.map(c => '<i style="background:' + c + '"></i>').join('') + '</div>' +
    '<div class="ramp-lab"><span>' + fmt(breaks[0]) + '</span><span>' +
    fmt(breaks[breaks.length - 1]) + '</span></div>' +
    '<p class="hint">' + esc(label) + ' (' + esc(unit) + ') — quantile breaks. ' +
    'Grey means no data.</p>';
}

/* ---------------- overlay layers ---------------- */
const OV = {
  protected_areas: { color: '#1b7f5a', label: 'name' },
  esz: { color: '#7b5ea7', label: 'Name' },
  corridors: { color: '#d98324', label: 'newname' },
  tiger_reserves: { color: '#b8433a', label: 'newname' },
  recorded_forest: { color: '#2f6d3a', label: null },
};

document.querySelectorAll('#overlays .chip').forEach(b => {
  b.onclick = async () => {
    const id = b.dataset.ov;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    if (!state.mapReady) return;
    const src = 'ov-' + id;
    if (on && !map.getSource(src)) {
      busy(true, 'Loading ' + id.replace(/_/g, ' ') + '…');
      try {
        const data = await fetch('data/overlays/' + id + '.geojson').then(r => r.json());
        map.addSource(src, { type: 'geojson', data: data });
        map.addLayer({
          id: src + '-f', type: 'fill', source: src,
          paint: { 'fill-color': OV[id].color, 'fill-opacity': 0.14 }
        });
        map.addLayer({
          id: src + '-l', type: 'line', source: src,
          paint: { 'line-color': OV[id].color, 'line-width': 1.3 }
        });
        const lab = OV[id].label;
        if (lab) {
          map.on('click', src + '-f', ev => {
            new maplibregl.Popup().setLngLat(ev.lngLat)
              .setHTML('<b>' + esc(ev.features[0].properties[lab]) + '</b>').addTo(map);
          });
        }
      } catch (e) { console.error('overlay ' + id, e); }
      busy(false);
    } else {
      [src + '-f', src + '-l'].forEach(l => map.getLayer(l) &&
        map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
    }
  };
});

/* ---------------- Analysis pane ---------------- */
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) : '0');

function renderAnalysis(a) {
  const t = a.totals;
  document.querySelector('#an-summary').innerHTML =
    '<div class="metrics">' +
    tile('People in ESA villages', fmt(t.population)) +
    tile('Households', fmt(t.households)) +
    tile('Scheduled Tribe', fmt(t.pop_st), pct(t.pop_st, t.population) + '%') +
    tile('Uninhabited villages', fmt(t.uninhabited_villages)) +
    wide('Already protected — park, sanctuary or ESZ', fmt(t.protected_km2),
         'km² · ' + pct(t.protected_km2, t.area_km2) + '% of the ESA',
         pct(t.protected_km2, t.area_km2)) +
    wide('Inside Recorded Forest Area', fmt(t.rfa_km2),
         'km² · ' + pct(t.rfa_km2, t.area_km2) + '%', pct(t.rfa_km2, t.area_km2),
         'The other ' + fmt(t.outside_rfa_km2) + ' km² is <b>not</b> necessarily private — it ' +
         'includes revenue land, water bodies and gaps in the forest layer.') +
    tile('Corridor / tiger reserve', fmt(t.connectivity_km2), 'km²') +
    tile('Degraded forest', fmt(t.degraded_forest_km2), 'km²') +
    tile('National highway', fmt(t.nh_km), 'km') +
    tile('Derelict mining land', fmt(t.derelict_mining_km2), 'km²') +
    '</div>';

  document.querySelector('#an-priority').innerHTML =
    '<div class="block"><h3>Priority bands</h3>' +
    a.priority.map(p => '<div class="statline"><span>' + esc(p.band) + '</span><b>' +
      fmt(p.villages) + '</b><small>' + fmt(p.area_km2) + ' km²</small></div>').join('') +
    '<p class="hint">Terciles of conservation value against human pressure. The two scores ' +
    'correlate −0.48 — related, but not mirror images of each other.</p></div>';

  document.querySelector('#an-states').innerHTML =
    '<div class="block"><h3>By state</h3><table class="mini">' +
    '<tr><th>State</th><th>People</th><th>Forest</th><th>Protected</th><th>Outside RFA</th></tr>' +
    a.states.map(s => '<tr><td>' + esc(title(s.state)) + '</td><td>' + fmt(s.population) +
      '</td><td>' + (s.natural_forest_pct || 0).toFixed(0) + '%</td><td>' +
      pct(s.protected_km2, s.area_km2) + '%</td><td>' +
      pct(s.outside_rfa_km2, s.area_km2) + '%</td></tr>').join('') +
    '</table></div>';

  document.querySelector('#an-limits').innerHTML =
    a.limitations.map(l => '<li>' + esc(l) + '</li>').join('');
}

const title = s => s === 'TAMIL NADU' ? 'Tamil Nadu' : s[0] + s.slice(1).toLowerCase();
const tile = (k, v, s) => '<div class="metric"><div class="k">' + esc(k) + '</div><div class="v">' +
  v + (s ? '<small>' + s + '</small>' : '') + '</div></div>';
const wide = (k, v, s, bar, hint) => '<div class="metric wide"><div class="k">' + esc(k) +
  '</div><div class="v">' + v + '<small>' + s + '</small></div>' +
  '<div class="bar"><i style="width:' + bar + '%"></i></div>' +
  (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';

/* ---------------- boot ---------------- */
(async function () {
  const sel = document.querySelector('#f-metric');
  if (sel) sel.onchange = applyMetric;
  try {
    const a = await fetch('api/v1/analysis-summary.json').then(r => r.json());
    state.an = a;
    renderAnalysis(a);
  } catch (e) { console.error('analysis summary', e); }
  // the choropleth needs the map source, which arrives later
  map.on('idle', function once() { map.off('idle', once); applyMetric(); });
})();

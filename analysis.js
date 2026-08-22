/* Analysis layer: live selection panel, choropleth, and overlay layers.
   Loaded after app.js and shares its top-level bindings (map, state, $, esc, fmt,
   COLOR, busy) through the global lexical environment. */
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
const q = s => document.querySelector(s);

/* ---------------- choropleth ---------------- */
function metricValues(key) {
  const src = map.getSource && map.getSource('villages');
  if (!src || !src._data) return [];
  return src._data.features.map(f => f.properties[key])
    .filter(x => typeof x === 'number' && isFinite(x));
}

/** Quantile breaks, with special handling for zero-inflated metrics.
 *  Protection and connectivity are zero for most villages, so plain quantiles
 *  collapse to two distinct values and the ramp loses four of its six steps.
 *  When zeros dominate, the breaks are computed over the non-zero values and
 *  zero keeps the palest colour as a class of its own. */
function quantileBreaks(vals, n) {
  if (vals.length < n) return null;
  const zeros = vals.filter(v => v === 0).length;
  const heavy = zeros / vals.length > 0.35;
  const pool = heavy ? vals.filter(v => v > 0) : vals;
  if (pool.length < n) return null;
  const v = pool.slice().sort((a, b) => a - b);
  const out = heavy ? [Number.MIN_VALUE] : [];
  const k = heavy ? n - 1 : n;
  for (let i = 1; i < k; i++) out.push(v[Math.floor(i / k * v.length)]);
  return [...new Set(out)].sort((a, b) => a - b);
}

function applyMetric() {
  const sel = q('#f-metric');
  if (!sel || !state.mapReady || !map.getLayer('v-fill')) return;
  const k = sel.value, legend = q('#legend');
  if (!k) {
    map.setPaintProperty('v-fill', 'fill-color',
      ['match', ['get', 'esa_category'], ...Object.entries(COLOR).flat(), '#777']);
    legend.innerHTML = ''; return;
  }
  const breaks = quantileBreaks(metricValues(k), RAMP.length);
  if (!breaks || breaks.length < 2) {
    legend.innerHTML = '<p class="hint">Not enough data to shade this metric.</p>'; return;
  }
  const step = ['step', ['coalesce', ['get', k], -1], RAMP[0]];
  breaks.forEach((b, i) => step.push(b, RAMP[Math.min(i + 1, RAMP.length - 1)]));
  map.setPaintProperty('v-fill', 'fill-color',
    ['case', ['==', ['coalesce', ['get', k], -1], -1], '#d0d0d0', step]);
  const [label, unit] = METRIC[k] || [k, ''];
  legend.innerHTML =
    '<div class="ramp">' + RAMP.map(c => '<i style="background:' + c + '"></i>').join('') + '</div>' +
    '<div class="ramp-lab"><span>' + (breaks[0] === Number.MIN_VALUE ? '0' : fmt(breaks[0])) +
    '</span><span>' + fmt(breaks[breaks.length - 1]) + '</span></div>' +
    '<p class="hint">' + esc(label) + ' (' + esc(unit) + ') — quantile breaks. Grey = no data.</p>';
}

/* ---------------- overlay layers ---------------- */
const OV = {
  protected_areas: { color: '#1b7f5a', label: 'name' },
  esz: { color: '#7b5ea7', label: 'Name' },
  corridors: { color: '#d98324', label: 'newname' },
  tiger_reserves: { color: '#b8433a', label: 'newname' },
  recorded_forest: { color: '#2f6d3a', label: null },
};
/* The ESA villages layer is itself toggleable, so the overlays and the choropleth
   can be examined on their own. */
const vToggle = q('#l-villages');
if (vToggle) vToggle.onclick = () => {
  const on = vToggle.getAttribute('aria-pressed') !== 'true';
  vToggle.setAttribute('aria-pressed', String(on));
  ['v-fill', 'v-line'].forEach(l => map.getLayer && map.getLayer(l) &&
    map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
};

document.querySelectorAll('#overlays .chip[data-ov]').forEach(b => {
  b.onclick = async () => {
    const id = b.dataset.ov, on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    if (!state.mapReady) return;
    const src = 'ov-' + id;
    if (on && !map.getSource(src)) {
      busy(true, 'Loading ' + id.replace(/_/g, ' ') + '…');
      try {
        map.addSource(src, { type: 'geojson',
          data: await fetch('data/overlays/' + id + '.geojson').then(r => r.json()) });
        map.addLayer({ id: src + '-f', type: 'fill', source: src,
          paint: { 'fill-color': OV[id].color, 'fill-opacity': 0.14 } });
        map.addLayer({ id: src + '-l', type: 'line', source: src,
          paint: { 'line-color': OV[id].color, 'line-width': 1.3 } });
        if (OV[id].label) map.on('click', src + '-f', ev => new maplibregl.Popup()
          .setLngLat(ev.lngLat)
          .setHTML('<b>' + esc(ev.features[0].properties[OV[id].label]) + '</b>').addTo(map));
      } catch (e) { console.error('overlay ' + id, e); }
      busy(false);
    } else {
      [src + '-f', src + '-l'].forEach(l => map.getLayer(l) &&
        map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
    }
  };
});

/* ---------------- live selection panel ---------------- */
let SLIM = null;

const sum = (rows, k) => rows.reduce((a, r) => a + (typeof r[k] === 'number' ? r[k] : 0), 0);

/** Area-weighted mean — a plain average would let a 0.5 km2 village count as much
 *  as a 300 km2 one, which badly distorts land-cover shares. */
function wmean(rows, k) {
  let n = 0, d = 0;
  for (const r of rows) {
    if (typeof r[k] === 'number' && isFinite(r[k]) && typeof r.area_km2 === 'number') {
      n += r[k] * r.area_km2; d += r.area_km2;
    }
  }
  return d ? n / d : null;
}

/* A card: label, big number, explicit unit, optional sub-line and meter.
   Units are never implied -- "15,759" alone is meaningless, "15,759 km2" is not. */
function card(label, num, unit, opts) {
  if (num == null) return '';
  const o = opts || {};
  return '<div class="card' + (o.wide ? ' w' : '') + (o.accent ? ' accent' : '') + '">' +
    '<span class="lab">' +
      (o.swatch ? '<i class="swatch" style="background:' + o.swatch + '"></i>' : '') +
      esc(label) + '</span>' +
    '<div class="val"><span class="num">' + num + '</span>' +
      (unit ? '<span class="unit">' + unit + '</span>' : '') + '</div>' +
    (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') +
    (o.meter != null ? '<div class="meter"><i style="width:' +
      Math.max(0, Math.min(100, o.meter)) + '%"></i></div>' : '') +
    '</div>';
}

/** An area that is part of a whole: km2, the share, and a meter. */
function areaCard(label, part, whole, swatch) {
  if (!whole) return '';
  const p = 100 * part / whole;
  return card(label, fmt(part), 'km\u00b2', {
    wide: true, meter: p, swatch: swatch,
    sub: p.toFixed(1) + '% of the ' + fmt(whole) + ' km\u00b2 selected'
  });
}

const num1 = v => (v == null ? null : v.toFixed(1));

function renderInsights(rows, scopeLabel) {
  q('#ins-scope').textContent = scopeLabel;
  const body = q('#ins-body');
  if (!rows || !rows.length) {
    body.innerHTML = '<p class="ins-empty">No villages match the current filter.</p>';
    return;
  }
  if (!SLIM) {
    body.innerHTML = '<p class="ins-empty">Loading indicators\u2026</p>';
    return;
  }
  const area = sum(rows, 'area_km2');
  const pop = sum(rows, 'population'), st = sum(rows, 'pop_st');
  const prio = {};
  rows.forEach(r => { if (r.priority) prio[r.priority] = (prio[r.priority] || 0) + 1; });
  const reliable = rows.filter(r => r.lulc_reliable).length;

  body.innerHTML =
    '<div class="ins-sec"><div class="cards">' +
      card('Villages', fmt(rows.length), rows.length === 1 ? 'village' : 'villages') +
      card('Total area', fmt(area), 'km\u00b2') +
    '</div></div>' +

    '<div class="ins-sec"><h3>People</h3><div class="cards">' +
      card('Population', fmt(pop), 'people',
           { accent: true, sub: 'Census 2011, whole-village \u2014 an upper bound' }) +
      card('Households', fmt(sum(rows, 'households')), 'households') +
      card('Scheduled Tribe', fmt(st), 'people',
           { sub: pop ? (100 * st / pop).toFixed(1) + '% of population' : '' }) +
      card('Density', fmt(area ? pop / area : 0), 'people / km\u00b2') +
      card('Land-dependent workers', num1(wmean(rows, 'land_dependent_pct')), '% of workers',
           { wide: true, sub: 'Cultivators and agricultural labourers' }) +
    '</div></div>' +

    '<div class="ins-sec"><h3>Protection &amp; tenure</h3><div class="cards">' +
      areaCard('Park, sanctuary or ESZ', sum(rows, 'protected_km2'), area, '#1b7f5a') +
      areaCard('Corridor or tiger reserve', sum(rows, 'connect_km2'), area, '#d98324') +
      areaCard('Recorded Forest Area', sum(rows, 'rfa_km2'), area, '#2f6d3a') +
      card('Outside Recorded Forest', fmt(sum(rows, 'outside_rfa_km2')), 'km\u00b2',
           { wide: true, sub: 'Not the same as private land \u2014 also revenue land, ' +
             'water bodies and gaps in the forest layer' }) +
    '</div></div>' +

    '<div class="ins-sec"><h3>Land cover</h3><div class="cards">' +
      card('Natural forest', num1(wmean(rows, 'natural_forest_pct')), '% of area', { accent: true }) +
      card('Plantation', num1(wmean(rows, 'plantation_pct')), '% of area') +
      card('Agriculture', num1(wmean(rows, 'agri_pct')), '% of area') +
      card('Degraded forest', num1(wmean(rows, 'wl_degraded_forest_pct')), '% of area') +
      card('Built-up', num1(wmean(rows, 'lulc_builtup_pct')), '% of area') +
      card('Reliable at this scale', fmt(reliable), 'of ' + fmt(rows.length) + ' villages',
           { sub: 'Mapped at 1:250,000 \u2014 villages under 25 km\u00b2 are indicative only' }) +
    '</div></div>' +

    '<div class="ins-sec"><h3>Pressure &amp; scores</h3><div class="cards">' +
      card('National highway', fmt(sum(rows, 'nh_km')), 'km',
           { wide: true, sub: 'Length of national highway inside the selection' }) +
      card('Conservation value', num1(wmean(rows, 'conservation_score')), 'of 100',
           { sub: 'Percentile rank within the ESA' }) +
      card('Human pressure', num1(wmean(rows, 'conflict_score')), 'of 100',
           { sub: 'Percentile rank within the ESA' }) +
    '</div></div>' +

    (Object.keys(prio).length
      ? '<div class="ins-sec"><h3>Priority bands</h3><div class="cards">' +
        Object.entries(prio).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
          card(k, fmt(v), v === 1 ? 'village' : 'villages',
               { sub: (100 * v / rows.length).toFixed(0) + '% of the selection' })).join('') +
        '</div></div>'
      : '');
}

/* app.js calls this whenever the filters change */
window.onSelectionChange = function (rows, scope) {
  renderInsights(rows, scope);
};

/* ---------------- boot ---------------- */
(async function () {
  const sel = q('#f-metric');
  if (sel) sel.onchange = applyMetric;
  try {
    const [slim, summ] = await Promise.all([
      fetch('api/v1/analysis-slim.json').then(r => r.json()),
      fetch('api/v1/analysis-summary.json').then(r => r.json()),
    ]);
    SLIM = slim; state.an = summ;
    // attach the indicator columns onto the rows the filters already work over
    const fields = slim.sum_fields.concat(slim.mean_fields);
    const at = new Map(slim.vid.map((v, i) => [v, i]));
    state.rows.forEach(r => {
      const i = at.get(String(r.vid));
      if (i == null) return;
      fields.forEach(f => { if (slim[f]) r[f] = slim[f][i]; });
      r.priority = slim.priority[i];
      r.lulc_reliable = !!slim.lulc_reliable[i];
      r.uninhabited = !!slim.uninhabited[i];
    });
    q('#an-limits').innerHTML = summ.limitations.map(l => '<li>' + esc(l) + '</li>').join('');
    renderInsights(state.filtered && state.filtered.length ? state.filtered : state.rows,
                   currentScope());
  } catch (e) {
    console.error('analysis load', e);
    q('#ins-body').innerHTML = '<p class="ins-empty">Indicators could not be loaded.</p>';
  }
  map.on('idle', function once() { map.off('idle', once); applyMetric(); });
})();

function currentScope() {
  const st = q('#f-state') && q('#f-state').value;
  const di = q('#f-district') && q('#f-district').value;
  const tl = q('#f-taluka') && q('#f-taluka').value;
  if (tl) return tl + ', ' + di;
  if (di) return di + ' district';
  if (st) return st === 'TAMIL NADU' ? 'Tamil Nadu' : st[0] + st.slice(1).toLowerCase();
  return 'All six states';
}

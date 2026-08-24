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

/* ---------------- card definitions (the i buttons) ----------------
   Every figure on this panel and on the village card is defined once, in
   data/definitions.json. The reference table in about.html is generated from
   the same file, so the page and these popovers cannot drift apart. */
let DEFS = null;          // key -> {label, unit, what, how, caveat}
let BY_LABEL = null;      // normalised label -> key

/* A few places in the UI shorten a label or use a section heading rather than a
   card name. Rather than touch every call site, map those spellings here. */
const DEF_ALIAS = {
  'land-dependent': 'land_dependent_pct',
  'match score': 'match',
  'people \u00b7 census 2011': 'population',
  'land cover': 'natural_forest_pct',
  'protection & tenure': 'protected',
  'composite assessment': 'conservation_score',
  'priority bands': 'priority',
  'people': 'population',
  'pressure & scores': 'conflict_score',
  'pressure': 'nh_km',
  'extent': 'area_km2',
  'official polygons': 'villages',
};

const defNorm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/[\u2019']/g, "'").replace(/\u00a0/g, ' ');

function defKey(text) {
  const t = defNorm(text);
  if (!t) return null;
  return (BY_LABEL && BY_LABEL[t]) || DEF_ALIAS[t] || null;
}

/* Adds an i button to every label in `root` that names a defined figure.
   Doing it by label after render, rather than at each call site, means a new
   card picks its definition up automatically and none can be forgotten. */
function stampInfo(root) {
  if (!DEFS || !root) return;
  const SEL = '.card .lab, .vs-l, .vbar-t > span, .vax-t > span, ' +
              '.ins-sec > h3, .vg > h4, .kv dt';
  root.querySelectorAll(SEL).forEach(el => {
    if (el.querySelector('.i')) return;
    const key = defKey(el.textContent);
    if (!key || !DEFS[key]) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'i';
    b.dataset.def = key;
    b.textContent = 'i';
    b.setAttribute('aria-label', 'What does "' + DEFS[key].label + '" mean?');
    el.appendChild(b);
  });
}
window.stampInfo = stampInfo;

/* One shared popover, position:fixed so it can never extend the document --
   an absolutely positioned element with no offsets is exactly what made the
   whole page scroll once before. */
let POP = null;
function closeDef() { if (POP) POP.hidden = true; }

function openDef(btn) {
  const d = DEFS[btn.dataset.def];
  if (!d) return;
  if (!POP) {
    POP = document.createElement('div');
    POP.id = 'defpop';
    POP.hidden = true;
    document.body.appendChild(POP);
  }
  POP.innerHTML =
    '<button class="defpop-x" aria-label="Close">&times;</button>' +
    '<h4>' + esc(d.label) + (d.unit ? ' <span>· ' + esc(d.unit) + '</span>' : '') + '</h4>' +
    '<p>' + esc(d.what) + '</p>' +
    '<dl><dt>How it is computed</dt><dd>' + esc(d.how) + '</dd>' +
    '<dt>Watch out for</dt><dd>' + esc(d.caveat) + '</dd></dl>' +
    '<a href="about.html#card-reference">All definitions &rarr;</a>';
  POP.hidden = false;
  // clamp into the viewport; the panel it opens from is only 320px wide
  const r = btn.getBoundingClientRect(), w = Math.min(340, innerWidth - 16);
  POP.style.width = w + 'px';
  let left = Math.min(Math.max(8, r.left - w + 24), innerWidth - w - 8);
  POP.style.left = left + 'px';
  const h = POP.offsetHeight;
  POP.style.top = (r.bottom + 8 + h > innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
  POP.querySelector('.defpop-x').onclick = closeDef;
}

document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('.i[data-def]');
  if (b) { ev.preventDefault(); ev.stopPropagation(); openDef(b); return; }
  if (POP && !POP.hidden && !(ev.target.closest && ev.target.closest('#defpop'))) closeDef();
});
addEventListener('keydown', ev => { if (ev.key === 'Escape') closeDef(); });
addEventListener('resize', closeDef);

/* ---------------- choropleth ---------------- */
/* Values for the chosen metric.
   This used to read map.getSource('villages')._data -- a PRIVATE MapLibre field
   that is not reliably populated in the minified build, so it returned nothing and
   the choropleth silently never rendered. state.rows carries the same 14 fields,
   loaded from analysis-slim.json, and is available before the map finishes. */
function metricValues(key) {
  return state.rows
    .map(r => r[key])
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
  if (!sel) return;
  if (!state.mapReady || !map.getLayer('v-fill')) {
    // the map is not up yet; it re-applies on idle and after the indicators load
    return;
  }
  const k = sel.value, legend = q('#legend');
  if (!k) {
    map.setPaintProperty('v-fill', 'fill-color',
      ['match', ['get', 'esa_category'], ...Object.entries(COLOR).flat(), '#777']);
    if (map.getLayer('kl-fill')) map.setPaintProperty('kl-fill', 'fill-color', '#0277bd');
    legend.innerHTML = ''; return;
  }
  /* On Kerala's official basis the village polygons are hidden, so the ramp has to
     be built from the official rows and painted onto that layer instead. Metrics
     the official geometry cannot carry -- population and the ranked scores -- say
     so rather than shading a blank. */
  const off = typeof BASIS !== 'undefined' && BASIS === 'official' && KLV && KLV.rows;
  const vals = off ? KLV.rows.map(r => r[k]).filter(x => typeof x === 'number' && isFinite(x))
                   : metricValues(k);
  const target = off ? 'kl-fill' : 'v-fill';
  if (off && !vals.length) {
    map.setPaintProperty('kl-fill', 'fill-color', '#0277bd');
    legend.innerHTML = '<p class="hint">' + esc((METRIC[k] || [k])[0]) + ' is not measured on ' +
      'Kerala\u2019s official boundary \u2014 switch to <b>Whole villages</b> to shade by it.</p>';
    return;
  }
  const breaks = quantileBreaks(vals, RAMP.length);
  if (!breaks || breaks.length < 2) {
    legend.innerHTML = '<p class="hint">Not enough data to shade this metric.</p>'; return;
  }
  const step = ['step', ['coalesce', ['get', k], -1], RAMP[0]];
  breaks.forEach((b, i) => step.push(b, RAMP[Math.min(i + 1, RAMP.length - 1)]));
  if (!map.getLayer(target)) return;
  map.setPaintProperty(target, 'fill-color',
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

/* ---------------- Kerala: which geometry the figures are measured on ----------------
   Kerala is the one state that published its own ESA boundary, and it notified
   village PORTIONS. So for Kerala alone the panel can be recomputed on the real
   notified geometry instead of the whole-village approximation. */
let KLV = null;                 // per-village metrics on the 98 official polygons
let KVO = null;                 // each Kerala village clipped to the official boundary
let BASIS = 'whole';            // 'whole' | 'official'
const isKerala = t => /^kerala$/i.test(String(t || '').trim());

function basisToggle(nWhole, nOfficial) {
  const b = (v, label, sub) =>
    '<button type="button" class="bt" data-basis="' + v + '" aria-pressed="' +
    (BASIS === v) + '">' + label + '<small>' + sub + '</small></button>';
  return '<div class="basis" role="group" aria-label="Geometry these figures are measured on">' +
    '<span class="basis-l">Measured on</span><div class="basis-b">' +
    b('whole', 'Whole villages', fmt(nWhole) + ' matched rows') +
    b('official', 'Kerala\u2019s official boundary', fmt(nOfficial) + ' notified polygons') +
    '</div></div>';
}

function renderInsights(rows, scopeLabel) {
  q('#ins-scope').textContent = scopeLabel;
  const body = q('#ins-body');
  const kerala = isKerala(scopeLabel);
  if (!kerala && BASIS !== 'whole') BASIS = 'whole';   // the toggle only applies to Kerala
  const official = !!(kerala && BASIS === 'official' && KLV && KLV.rows);

  if (!official && (!rows || !rows.length)) {
    body.innerHTML = '<p class="ins-empty">No villages match the current filter.</p>';
    return;
  }
  if (!SLIM) {
    body.innerHTML = '<p class="ins-empty">Loading indicators\u2026</p>';
    return;
  }
  const R = official ? KLV.rows : rows;
  const area = sum(R, 'area_km2');
  const pop = sum(R, 'population'), st = sum(R, 'pop_st');
  const prio = {};
  if (!official) R.forEach(r => { if (r.priority) prio[r.priority] = (prio[r.priority] || 0) + 1; });
  const reliable = R.filter(r => r.lulc_reliable).length;

  /* On the official basis there is no population section at all. Census counts
     are per whole village; apportioning them to a portion needs an assumption
     nothing can validate, so the honest answer is to omit them and say why. */
  const people = official
    ? '<div class="ins-sec"><h3>People</h3>' +
      '<p class="ins-na">Not available on this basis. Census 2011 counts are recorded per ' +
      'whole village, and there is no way to apportion them to the part of a village that ' +
      'was actually notified without an assumption that cannot be tested. Switch to ' +
      '<b>Whole villages</b> for population, and read it as an upper bound.</p></div>'
    : '<div class="ins-sec"><h3>People</h3><div class="cards">' +
      card('Population', fmt(pop), 'people',
           { accent: true, sub: 'Census 2011, whole-village \u2014 an upper bound' }) +
      card('Households', fmt(sum(R, 'households')), 'households') +
      card('Scheduled Tribe', fmt(st), 'people',
           { sub: pop ? (100 * st / pop).toFixed(1) + '% of population' : '' }) +
      card('Density', fmt(area ? pop / area : 0), 'people / km\u00b2') +
      card('Land-dependent workers', num1(wmean(R, 'land_dependent_pct')), '% of workers',
           { wide: true, sub: 'Cultivators and agricultural labourers' }) +
      '</div></div>';

  /* The composite scores are percentile ranks against the other ESA villages, so
     they are only defined on the whole-village set they were ranked in. */
  const scores = official
    ? '<div class="ins-sec"><h3>Pressure</h3><div class="cards">' +
      card('National highway', fmt(sum(R, 'nh_km')), 'km',
           { wide: true, sub: 'Length of national highway inside the notified boundary' }) +
      '</div><p class="ins-na">Conservation value and human pressure are percentile ranks ' +
      'against all 4,331 ESA villages, so they are only defined on that whole-village set. ' +
      'They are not recomputed here.</p></div>'
    : '<div class="ins-sec"><h3>Pressure &amp; scores</h3><div class="cards">' +
      card('National highway', fmt(sum(R, 'nh_km')), 'km',
           { wide: true, sub: 'Length of national highway inside the selection' }) +
      card('Conservation value', num1(wmean(R, 'conservation_score')), 'of 100',
           { sub: 'Percentile rank within the ESA' }) +
      card('Human pressure', num1(wmean(R, 'conflict_score')), 'of 100',
           { sub: 'Percentile rank within the ESA' }) +
      '</div></div>';

  body.innerHTML =
    (kerala && KLV ? basisToggle(rows.length, KLV.rows.length) : '') +

    (official
      ? '<p class="basis-note">These figures are measured on the boundary Kerala actually ' +
        'notified \u2014 98 polygons, ' + fmt(area) + ' km\u00b2 \u2014 not on whole villages. ' +
        '<a href="about.html#kerala-check">How this differs \u2192</a></p>'
      : '') +

    '<div class="ins-sec"><div class="cards">' +
      card(official ? 'Official polygons' : 'Villages', fmt(R.length),
           official ? 'polygons' : (R.length === 1 ? 'village' : 'villages')) +
      card('Total area', fmt(area), 'km\u00b2') +
    '</div></div>' +

    people +

    '<div class="ins-sec"><h3>Protection &amp; tenure</h3><div class="cards">' +
      areaCard('Park, sanctuary or ESZ', sum(R, 'protected_km2'), area, '#1b7f5a') +
      areaCard('Corridor or tiger reserve', sum(R, 'connect_km2'), area, '#d98324') +
      areaCard('Recorded Forest Area', sum(R, 'rfa_km2'), area, '#2f6d3a') +
      card('Outside Recorded Forest', fmt(sum(R, 'outside_rfa_km2')), 'km\u00b2',
           { wide: true, sub: 'Not the same as private land \u2014 also revenue land, ' +
             'water bodies and gaps in the forest layer' }) +
    '</div></div>' +

    '<div class="ins-sec"><h3>Land cover</h3><div class="cards">' +
      card('Natural forest', num1(wmean(R, 'natural_forest_pct')), '% of area', { accent: true }) +
      card('Plantation', num1(wmean(R, 'plantation_pct')), '% of area') +
      card('Agriculture', num1(wmean(R, 'agri_pct')), '% of area') +
      card('Degraded forest', num1(wmean(R, 'wl_degraded_forest_pct')), '% of area') +
      card('Built-up', num1(wmean(R, 'lulc_builtup_pct')), '% of area') +
      card('Reliable at this scale', fmt(reliable), 'of ' + fmt(R.length) +
           (official ? ' polygons' : ' villages'),
           { sub: 'Mapped at 1:250,000 \u2014 units under 25 km\u00b2 are indicative only' }) +
    '</div></div>' +

    scores +

    keralaPanel(scopeLabel) +

    (Object.keys(prio).length
      ? '<div class="ins-sec"><h3>Priority bands</h3><div class="cards">' +
        Object.entries(prio).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
          card(k, fmt(v), v === 1 ? 'village' : 'villages',
               { sub: (100 * v / R.length).toFixed(0) + '% of the selection' })).join('') +
        '</div></div>'
      : '');

  stampInfo(body);
}

/* The toggle lives inside the panel body, which renderInsights rewrites wholesale,
   so the handler is delegated rather than bound to the buttons themselves. */
q('#ins-body').addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('.bt[data-basis]');
  if (!b || b.dataset.basis === BASIS) return;
  setBasis(b.dataset.basis);
});

/* Swaps what the map draws for Kerala along with what the panel counts, so the
   two can never disagree about which geometry is on screen. */
window.setBasis = setBasis;
async function setBasis(b) {
  BASIS = b;
  const on = b === 'official';
  if (state.mapReady) {
    if (on && !map.getSource('kl')) {
      busy(true, 'Loading Kerala\u2019s official boundary\u2026');
      try {
        map.addSource('kl', { type: 'geojson',
          data: await fetch('data/kerala_official.geojson').then(r => r.json()) });
        map.addLayer({ id: 'kl-fill', type: 'fill', source: 'kl',
          paint: { 'fill-color': '#0277bd', 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'kl-line', type: 'line', source: 'kl',
          paint: { 'line-color': '#01579b', 'line-width': 1.6 } });
      } catch (e) { console.error('kerala official', e); }
      busy(false);
    }
    if (map.getLayer('kl-fill')) {
      map.setLayoutProperty('kl-fill', 'visibility', on ? 'visible' : 'none');
      map.setLayoutProperty('kl-line', 'visibility', on ? 'visible' : 'none');
      map.setPaintProperty('kl-fill', 'fill-opacity', on ? 0.55 : 0.12);
    }
    state.basisOfficial = on;
    if (window.setVillageVisibility) window.setVillageVisibility();
    const ref = q('#l-kerala');
    if (ref && on) ref.setAttribute('aria-pressed', 'true');
  }
  applyMetric();
  renderInsights(state.filtered && state.filtered.length ? state.filtered : state.rows,
                 currentScope());
}

/* Kerala is the only state with an official published boundary, so it is the only
   place the whole-village approximation can be checked against ground truth. */
let KLC = null;
function keralaPanel(scopeLabel) {
  if (!KLC || !/^kerala$/i.test((scopeLabel || '').trim())) return '';
  const row = (label, k, unit) => {
    const d = KLC.deltas[k]; if (!d) return '';
    const up = d.difference > 0;
    return '<tr><td>' + esc(label) + '</td><td>' + fmt(d.whole_villages) + (unit || '') +
      '</td><td><b>' + fmt(d.official) + (unit || '') + '</b></td><td class="' +
      (up ? 'up' : 'dn') + '">' + (up ? '+' : '') + fmt(d.difference) + '</td></tr>';
  };
  return '<div class="ins-sec klc"><h3>Measured against Kerala’s official boundary</h3>' +
    '<table class="mini klc-t"><tr><th>Metric</th><th>Whole villages</th>' +
    '<th>Official</th><th>Diff</th></tr>' +
    row('Area', 'area_km2', ' km²') +
    row('Protected / ESZ', 'protected_pct', '%') +
    row('Corridor / tiger', 'connectivity_pct', '%') +
    row('Recorded forest', 'rfa_pct', '%') +
    row('Outside rec. forest', 'outside_rfa_pct', '%') +
    row('Natural forest', 'natural_forest_pct', '%') +
    row('Plantation', 'plantation_pct', '%') +
    row('Built-up', 'builtup_pct', '%') +
    row('National highway', 'nh_km', ' km') +
    '</table>' +
    '<p class="hint">Kerala notified <em>portions</em> of villages; this atlas holds whole ' +
    'villages. Every metric moves the same way — the notified portion is the wilder, more ' +
    'protected, less settled part. Plantation halves and highways drop by two thirds, so the ' +
    'whole-village figures overstate development pressure. Population is not compared: Census ' +
    'counts are per whole village and cannot be apportioned to a portion without an ' +
    'assumption that cannot be tested. ' +
    '<a href="about.html#kerala-check">How this was measured →</a></p></div>';
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
    const opt = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    const [slim, summ, klc, klv, defs, kvo] = await Promise.all([
      fetch('api/v1/analysis-slim.json').then(r => r.json()),
      fetch('api/v1/analysis-summary.json').then(r => r.json()),
      opt('api/v1/kerala-comparison.json'),
      opt('api/v1/kerala-official.json'),
      opt('data/definitions.json'),
      opt('api/v1/kerala-village-official.json'),
    ]);
    SLIM = slim; state.an = summ; KLC = klc; KLV = klv; KVO = kvo;
    if (defs) {
      DEFS = {}; BY_LABEL = {};
      defs.groups.forEach(g => g.items.forEach(it => {
        DEFS[it.key] = it;
        BY_LABEL[defNorm(it.label)] = it.key;
      }));
    }
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
    applyMetric();          // values are only available now
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

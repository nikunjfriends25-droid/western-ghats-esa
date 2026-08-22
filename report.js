/* PDF export. No library and no new origin in the CSP: the report is built as
   ordinary HTML in a hidden container, a print stylesheet hides the application
   and reveals it, and the browser's own "Save as PDF" does the rest.

   Loaded after app.js and analysis.js; shares their top-level bindings. */
'use strict';

const REPORT_URL = 'https://nikunjfriends25-droid.github.io/western-ghats-esa/';

/** Snapshot of the live map. Requires preserveDrawingBuffer on the map. */
function mapSnapshot() {
  try {
    if (!state.mapReady) return null;
    const c = map.getCanvas();
    if (!c || !c.width) return null;
    return c.toDataURL('image/png');
  } catch (e) {
    console.warn('map snapshot unavailable', e);
    return null;
  }
}

const rNum = v => (typeof v === 'number' && isFinite(v)) ? fmt(v) : '—';
const rPct = v => (typeof v === 'number' && isFinite(v)) ? v.toFixed(1) + '%' : '—';

function rTable(rows) {
  return '<table class="r-tab"><tbody>' + rows.filter(Boolean).map(
    ([k, v, u]) => '<tr><th>' + esc(k) + '</th><td>' + v +
      (u ? ' <span class="r-u">' + esc(u) + '</span>' : '') + '</td></tr>').join('') +
    '</tbody></table>';
}

function reportShell(title, subtitle, body, img) {
  const now = new Date().toISOString().slice(0, 10);
  return `
    <header class="r-head">
      <div>
        <h1>${esc(title)}</h1>
        <p class="r-sub">${esc(subtitle)}</p>
      </div>
      <div class="r-brand">
        <strong>Western Ghats ESA Atlas</strong>
        <span>Draft notification S.O. 3060(E) · 31 July 2024</span>
        <span>Generated ${now}</span>
      </div>
    </header>
    ${img ? `<figure class="r-map"><img src="${img}" alt="Map of the current selection">
        <figcaption>Map as displayed when exported. Basemap © OpenStreetMap contributors,
        © CARTO.</figcaption></figure>`
      : `<p class="r-nomap">The map could not be captured — export again once it has
         finished drawing.</p>`}
    ${body}
    <footer class="r-foot">
      <p><strong>Read before quoting.</strong> Bifurcated villages and all Kerala villages are
      whole-village polygons standing in for partial extents, so population figures are an
      upper bound and every percentage-of-area figure is an under-estimate. Protected areas are
      OpenStreetMap-derived, not official WII boundaries. Land cover is indicative below
      25 km². Land outside Recorded Forest Area is not the same as private land.</p>
      <p>An independent reconstruction for reference and research. It has no legal standing and
      must not be used to determine whether a specific parcel falls inside the ESA.
      Compiled by Nikunj Jambu · CC BY 4.0 · ${REPORT_URL}</p>
    </footer>`;
}

/* ---------------- selection report ---------------- */
function buildSelectionReport() {
  const rows = (state.filtered && state.filtered.length) ? state.filtered : state.rows;
  const scope = (document.querySelector('#ins-scope') || {}).textContent || 'All six states';
  const area = sum(rows, 'area_km2'), pop = sum(rows, 'population'), st = sum(rows, 'pop_st');
  const prio = {};
  rows.forEach(r => { if (r.priority) prio[r.priority] = (prio[r.priority] || 0) + 1; });

  const body = `
    <section class="r-sec">
      <h2>Extent</h2>
      ${rTable([
        ['Villages', rNum(rows.length), 'villages'],
        ['Total area', rNum(area), 'km²'],
      ])}
      <h2>People · Census 2011</h2>
      ${rTable([
        ['Population', rNum(pop), 'people'],
        ['Households', rNum(sum(rows, 'households')), 'households'],
        ['Scheduled Tribe', rNum(st), pop ? 'people (' + (100 * st / pop).toFixed(1) + '% of population)' : 'people'],
        ['Density', rNum(area ? pop / area : 0), 'people / km²'],
        ['Land-dependent workers', rPct(wmean(rows, 'land_dependent_pct')), 'of workers'],
      ])}
    </section>
    <section class="r-sec">
      <h2>Protection &amp; tenure</h2>
      ${rTable([
        ['Park, sanctuary or ESZ', rNum(sum(rows, 'protected_km2')), 'km² (' + (area ? (100 * sum(rows, 'protected_km2') / area).toFixed(1) : '0') + '% of selection)'],
        ['Corridor or tiger reserve', rNum(sum(rows, 'connect_km2')), 'km²'],
        ['Recorded Forest Area', rNum(sum(rows, 'rfa_km2')), 'km²'],
        ['Outside Recorded Forest Area', rNum(sum(rows, 'outside_rfa_km2')), 'km²'],
      ])}
      <h2>Land cover · area-weighted</h2>
      ${rTable([
        ['Natural forest', rPct(wmean(rows, 'natural_forest_pct')), 'of area'],
        ['Plantation', rPct(wmean(rows, 'plantation_pct')), 'of area'],
        ['Agriculture', rPct(wmean(rows, 'agri_pct')), 'of area'],
        ['Degraded forest', rPct(wmean(rows, 'wl_degraded_forest_pct')), 'of area'],
        ['Built-up', rPct(wmean(rows, 'lulc_builtup_pct')), 'of area'],
      ])}
      <h2>Pressure &amp; scores</h2>
      ${rTable([
        ['National highway', rNum(sum(rows, 'nh_km')), 'km inside selection'],
        ['Conservation value', rPct(wmean(rows, 'conservation_score')).replace('%', ''), 'of 100'],
        ['Human pressure', rPct(wmean(rows, 'conflict_score')).replace('%', ''), 'of 100'],
      ])}
      ${Object.keys(prio).length ? '<h2>Priority bands</h2>' + rTable(
        Object.entries(prio).sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k, rNum(v), 'villages (' + (100 * v / rows.length).toFixed(0) + '%)'])) : ''}
    </section>`;

  return reportShell('Selection report', scope + ' · ' + fmt(rows.length) + ' villages',
                     body, mapSnapshot());
}

/* ---------------- single village report ---------------- */
function buildVillageReport(p, a) {
  const body = `
    <section class="r-sec">
      <h2>Gazette entry</h2>
      ${rTable([
        ['Village', esc(p.gz_village)],
        ['Taluka', esc(p.gz_taluka)],
        ['District', esc(p.gz_district)],
        ['State', esc(p.gz_state)],
        ['Gazette serial no.', esc(p.gz_sno)],
        ['As printed', esc(p.gz_village_raw)],
        ['Category', esc(CAT_LABEL[p.esa_category] || p.esa_category)],
        ['Area', rNum(p.area_km2), 'km²'],
        ['2011 Census code', esc(p.censuscode)],
        ['LGD code', esc(p.lgd_villagecode)],
        ['Matched census name', esc(p.cen_village)],
        ['Name match score', esc(p.score) + ' (' + esc(p.scope) + ')'],
      ])}
    </section>
    ${a ? `<section class="r-sec">
      <h2>People · Census 2011</h2>
      ${rTable([
        ['Population', rNum(a.population), 'people'],
        ['Households', rNum(a.households), 'households'],
        ['Scheduled Tribe', rNum(a.pop_st), a.st_pct != null ? 'people (' + a.st_pct + '%)' : 'people'],
        ['Density', rNum(a.pop_density), 'people / km²'],
        ['Literacy', rPct(a.literacy_pct)],
        ['Land-dependent workers', rPct(a.land_dependent_pct), 'of workers'],
      ])}
      <h2>Land cover</h2>
      ${rTable([
        ['Natural forest', rPct(a.natural_forest_pct), 'of area'],
        ['Plantation', rPct(a.plantation_pct), 'of area'],
        ['Agriculture', rPct(a.agri_pct), 'of area'],
        ['Degraded forest', rPct(a.wl_degraded_forest_pct), 'of area'],
        ['Built-up', rPct(a.lulc_builtup_pct), 'of area'],
      ])}
      <h2>Protection, tenure &amp; setting</h2>
      ${rTable([
        ['Park, sanctuary or ESZ', rPct(a.protected_pct), 'of village'],
        ['Corridor or tiger reserve', rPct(a.connectivity_pct), 'of village'],
        ['Recorded Forest Area', rPct(a.rfa_pct), 'of village'],
        ['Outside Recorded Forest', rPct(a.outside_rfa_pct), 'of village'],
        a.pa_names ? ['Parks / sanctuaries', esc(a.pa_names)] : null,
        a.esz_names ? ['Eco-Sensitive Zone', esc(a.esz_names)] : null,
        a.tiger_names ? ['Tiger reserve', esc(a.tiger_names)] : null,
        a.fsi_division ? ['Forest division', esc(a.fsi_division)] : null,
        a.basin ? ['River basin', esc(a.basin)] : null,
        a.nh_km ? ['National highway', rNum(a.nh_km), 'km'] : null,
      ])}
      <h2>Composite assessment</h2>
      ${rTable([
        ['Conservation value', rNum(a.conservation_score), 'of 100' + (a.cons_band ? ' (' + a.cons_band + ')' : '')],
        ['Human pressure', rNum(a.conflict_score), 'of 100' + (a.risk_band ? ' (' + a.risk_band + ')' : '')],
        ['Band', esc(a.priority)],
      ])}
      <p class="r-note">Both scores are percentile ranks against the other 4,330 ESA villages,
      not absolute measures.</p>
    </section>` : ''}`;

  return reportShell(p.gz_village + ' — village report',
                     [p.gz_taluka, p.gz_district, p.gz_state].filter(Boolean).join(', '),
                     body, mapSnapshot());
}

/* ---------------- print plumbing ---------------- */
let printing = false;
function printReport(html) {
  const el = document.querySelector('#report');
  el.innerHTML = html;
  printing = true;
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    printing = false;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // give the browser a frame to lay the report out before opening the dialog
  setTimeout(() => { window.print(); setTimeout(done, 800); }, 120);
}

const selBtn = document.querySelector('#pdf-selection');
if (selBtn) selBtn.onclick = () => printReport(buildSelectionReport());

/* the village card's own export button is wired when the card is rendered */
window.exportVillagePdf = (p, a) => printReport(buildVillageReport(p, a));

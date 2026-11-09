/* Guided tour. Vanilla, no library, no inline script -- the CSP is script-src 'self'.

   The spotlight is one fixed div with a 9999px box-shadow, which dims everything
   except the cut-out without needing an SVG mask or four separate panels. Both the
   spotlight and the bubble are position:fixed on purpose: an absolutely positioned
   element with no offsets takes the root as its containing block and can stretch the
   document, which is what once made the whole page scroll. */
'use strict';

(function () {
  const STEPS = [
    { t: 'Village boundaries the notification never published',
      b: 'The draft ESA notification names 4,402 villages across six states but includes no ' +
         'map. This atlas reconstructs one: 4,331 of those rows (98.4%) have a mapped ' +
         'boundary. Two minutes to see what it does.' },
    { sel: '#f-state', side: 'right',
      t: 'Narrow it down',
      b: 'Filter to a state, district or taluka, or search a village by its gazette or census ' +
         'name. Everything else on the page — the map, the statistics, the PDF — follows ' +
         'whatever you select here.' },
    { sel: '#cats', side: 'right',
      t: 'Categories are not zones',
      b: 'The ESA is single and undivided — there is no Zone 1/2/3. These five categories ' +
         'record how each polygon was arrived at and how far to trust its extent. Two of them ' +
         'are warnings: bifurcated and Kerala villages are drawn whole, so they over-state.' },
    { sel: '#f-metric', side: 'right',
      t: 'Shade the map by any measure',
      b: 'Population, forest cover, protection, recorded forest, the composite scores — ' +
         'eighteen of them. The legend below shows the quantile breaks, and grey always ' +
         'means no data rather than zero.' },
    { sel: '#overlays', side: 'right',
      t: 'Lay other data over it',
      b: 'Protected areas, tiger reserves, corridors and recorded forest. Pick <b>None</b> ' +
         'under Village category first if you want to see an overlay without the village ' +
         'polygons on top of it.' },
    { sel: '#insights', side: 'left',
      t: 'Statistics for exactly what you selected',
      b: 'This panel recomputes on every filter change — one village or all six states. ' +
         'Every figure carries its unit, and the <b>i</b> on each card opens what it means, ' +
         'how it was computed, and what it cannot be used for.' },
    { sel: '#pdf-selection', side: 'left',
      t: 'Export what you are looking at',
      b: 'A PDF with the map and every statistic for the current selection. Village cards ' +
         'export the same way. For Kerala the report carries both geometries — whole ' +
         'villages and the boundary the State actually notified.' },
    { sel: '.tabs', side: 'right',
      t: 'Take the data with you',
      b: '<b>Not mapped</b> lists the 71 rows that could not be matched, each with a reason. ' +
         '<b>Download</b> has GeoJSON, Shapefile, KML and CSV per state, plus a free JSON API ' +
         'with no key. Everything is CC BY 4.0.' },
    { t: 'Read the caveats before you quote it',
      b: 'This is an independent reconstruction with <b>no legal standing</b> — it must not ' +
         'be used to decide whether a parcel falls inside the ESA. Method &amp; caveats sets ' +
         'out how it was built, how it was verified three ways, and where it is weakest.' },
  ];

  let i = 0, open = false, pad, bub, prevFocus = null;

  function build() {
    pad = document.createElement('div');
    pad.className = 'tour-spot';
    bub = document.createElement('div');
    bub.className = 'tour-bub';
    bub.setAttribute('role', 'dialog');
    bub.setAttribute('aria-modal', 'true');
    bub.setAttribute('aria-live', 'polite');
    document.body.appendChild(pad);
    document.body.appendChild(bub);
  }

  function setSpot(l, t, w, h) {
    pad.style.left = l + 'px';
    pad.style.top = t + 'px';
    pad.style.width = w + 'px';
    pad.style.height = h + 'px';
    pad.style.opacity = '1';
  }

  function place(step) {
    const el = step.sel && document.querySelector(step.sel);
    const vw = innerWidth, vh = innerHeight;

    if (!el || el.getBoundingClientRect().width < 4) {
      // no target, or it is not on screen at this width: centre the bubble and
      // dim the whole page rather than spotlighting nothing
      setSpot(vw / 2, vh / 2, 0, 0);
      bub.style.left = Math.max(12, (vw - bub.offsetWidth) / 2) + 'px';
      bub.style.top = Math.max(12, (vh - bub.offsetHeight) / 2) + 'px';
      return;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect(), m = 6;
    setSpot(r.left - m, r.top - m, r.width + m * 2, r.height + m * 2);

    const bw = bub.offsetWidth, bh = bub.offsetHeight, gap = 14;
    let left, top;
    if (vw < 760) {                      // phone: always below, full width
      left = 12; top = Math.min(r.bottom + gap, vh - bh - 12);
    } else if (step.side === 'left') {
      left = r.left - bw - gap; top = r.top;
    } else {
      left = r.right + gap; top = r.top;
    }
    if (left < 12) left = r.right + gap;
    if (left + bw > vw - 12) left = Math.max(12, r.left - bw - gap);
    bub.style.left = Math.max(12, Math.min(left, vw - bw - 12)) + 'px';
    bub.style.top = Math.max(12, Math.min(top, vh - bh - 12)) + 'px';
  }

  function render() {
    const s = STEPS[i];
    bub.innerHTML =
      '<p class="tour-n">' + (i + 1) + ' of ' + STEPS.length + '</p>' +
      '<h3>' + s.t + '</h3><p>' + s.b + '</p>' +
      '<div class="tour-act">' +
        '<button type="button" class="tour-skip">Skip</button>' +
        '<span class="tour-sp"></span>' +
        (i ? '<button type="button" class="tour-back">Back</button>' : '') +
        '<button type="button" class="tour-next">' +
          (i === STEPS.length - 1 ? 'Done' : 'Next') + '</button>' +
      '</div>';
    bub.querySelector('.tour-next').onclick = () => (i === STEPS.length - 1 ? stop() : go(1));
    bub.querySelector('.tour-skip').onclick = stop;
    const b = bub.querySelector('.tour-back');
    if (b) b.onclick = () => go(-1);
    place(s);
    bub.querySelector('.tour-next').focus();
  }

  function go(d) { i = Math.max(0, Math.min(STEPS.length - 1, i + d)); render(); }

  function start() {
    if (open) return;
    if (!pad) build();
    open = true; i = 0;
    prevFocus = document.activeElement;
    document.body.classList.add('tour-on');
    render();
    addEventListener('keydown', key);
    addEventListener('resize', reflow);
  }

  function stop() {
    open = false;
    document.body.classList.remove('tour-on');
    removeEventListener('keydown', key);
    removeEventListener('resize', reflow);
    try { localStorage.setItem('wg-tour-seen', '1'); } catch (e) { /* private window */ }
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }

  function key(e) {
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  }
  function reflow() { if (open) place(STEPS[i]); }

  const btn = document.querySelector('#tour-start');
  if (btn) btn.onclick = start;
  window.startTour = start;

  // offer it once to a first-time visitor, after the map has had a chance to draw
  let seen = '1';
  try { seen = localStorage.getItem('wg-tour-seen'); } catch (e) { seen = '1'; }
  if (!seen) setTimeout(start, 1400);
})();

/* Highlights the contents-rail entry for whichever section you are reading.
   Deliberately avoids requestAnimationFrame: it is suspended in background or
   non-compositing tabs, which would freeze the highlight. */
(function () {
  const links = [...document.querySelectorAll('.docnav a[href^="#"]')];
  if (!links.length) return;
  const targets = links
    .map(a => ({ a, el: document.getElementById(a.getAttribute('href').slice(1)) }))
    .filter(t => t.el);
  if (!targets.length) return;

  let last = 0, timer = null;
  function update() {
    last = Date.now(); timer = null;
    const line = 120;                     // a little below the sticky topbar
    let cur = targets[0];
    for (const t of targets) {
      if (t.el.getBoundingClientRect().top <= line) cur = t; else break;
    }
    const el = document.scrollingElement || document.documentElement;
    if (el.scrollTop + window.innerHeight >= el.scrollHeight - 4) cur = targets[targets.length - 1];
    links.forEach(x => x.classList.toggle('on', x === cur.a));
  }
  function onScroll() {                   // trailing-edge throttle, ~80 ms
    const wait = 80 - (Date.now() - last);
    if (wait <= 0) update();
    else if (!timer) timer = setTimeout(update, wait);
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  update();
})();

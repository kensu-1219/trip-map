/* 自繪線條圖示組（24×24，1.6 線寬、方角）—— 取代介面上的 emoji */
(function () {
  'use strict';
  const P = {
    plan: '<rect x="3.5" y="5" width="17" height="15"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M7 13h2M11 13h2M15 13h2M7 16.5h2M11 16.5h2"/>',
    places: '<path d="M12 2.8l6.2 6.2L12 21.2 5.8 9z"/><rect x="10.3" y="7.3" width="3.4" height="3.4" transform="rotate(45 12 9)"/>',
    add: '<rect x="3.5" y="3.5" width="17" height="17"/><path d="M12 8v8M8 12h8"/>',
    measure: '<path d="M3 15.5L15.5 3 21 8.5 8.5 21z"/><path d="M7 13.5l1.8 1.8M9.5 11l2.6 2.6M12 8.5l1.8 1.8M14.5 6l2.6 2.6"/>',
    share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 11.5v9h14v-9"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/>',
    locate: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><rect x="10.6" y="10.6" width="2.8" height="2.8" fill="currentColor"/>',
    fit: '<path d="M3.5 8.5v-5h5M15.5 3.5h5v5M20.5 15.5v5h-5M8.5 20.5h-5v-5"/><rect x="8.5" y="8.5" width="7" height="7"/>',
    walk: '<circle cx="13.2" cy="4.4" r="1.9"/><path d="M12.3 7.6L10.6 13.4l-2.4 7.1M10.6 13.4l3.2 2.8.9 4.3M11.9 9.4l-3.6 2.2M12 9.3l2.4 2.4 2.8.6"/>',
    bike: '<circle cx="6" cy="16" r="3.8"/><circle cx="18" cy="16" r="3.8"/><path d="M6 16l4.2-7h6.3L18 16M10.2 9L13 16h-7M14.7 6.3h2.6"/>',
    car: '<path d="M4 16.5V12l2.2-5h11.6L20 12v4.5z"/><path d="M4 12h16"/><circle cx="7.6" cy="16.8" r="1.7"/><circle cx="16.4" cy="16.8" r="1.7"/>',
    transit: '<rect x="5.5" y="3" width="13" height="14.5" rx="1"/><path d="M5.5 10.5h13M9 3v7.5M15 3v7.5"/><circle cx="9" cy="14" r=".9" fill="currentColor"/><circle cx="15" cy="14" r=".9" fill="currentColor"/><path d="M8 17.5L6 21M16 17.5l2 3.5"/>',
    bus: '<rect x="4.5" y="3.5" width="15" height="14" rx="1"/><path d="M4.5 12h15M4.5 7h15"/><circle cx="8.3" cy="14.8" r=".9" fill="currentColor"/><circle cx="15.7" cy="14.8" r=".9" fill="currentColor"/><path d="M7 17.5v3M17 17.5v3"/>',
    ferry: '<path d="M3 17c1.5 1.4 3 1.4 4.5 0s3-1.4 4.5 0 3 1.4 4.5 0 3-1.4 4.5 0"/><path d="M5 14l1.5-4h11L19 14M9 10V6.5h6V10M12 4v2.5"/>',
    hotel: '<path d="M3.5 19.5v-12M3.5 15.5h17v4M3.5 11.5h6.5v4M10 11.5h7.5a3 3 0 0 1 3 3v1"/><rect x="5.3" y="8.7" width="2.6" height="2.6"/>',
    edit: '<path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19z"/><path d="M13.5 7l3.5 3.5"/>',
    up: '<path d="M6 14l6-6 6 6"/>',
    down: '<path d="M6 10l6 6 6-6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>',
    nav: '<path d="M3.5 11L20.5 3.5 13 20.5l-2-7.5z"/>',
    auto: '<path d="M5 18l4.5-6 5 2.5L19 6"/><rect x="3.3" y="16.3" width="3.4" height="3.4"/><rect x="7.8" y="10.3" width="3.4" height="3.4"/><rect x="12.8" y="12.8" width="3.4" height="3.4"/><path d="M19 3v4M17 5h4"/>',
    map: '<path d="M3.5 6l5.5-2 6 2 5.5-2v14l-5.5 2-6-2-5.5 2z"/><path d="M9 4v14M15 6v14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3l5.2 5.2"/>',
    folder: '<path d="M3.5 6.5h6l2 2.5h9v10.5h-17z"/><path d="M12 12v5M9.5 14.5L12 17l2.5-2.5"/>',
    download: '<path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5"/><path d="M4 16.5v4h16v-4"/>',
    copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
    undo: '<path d="M8.5 5L4 9.5 8.5 14"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H10"/>',
    close: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>',
    text: '<path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4M8 11.5h8M8 14.5h8M8 17.5h5"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 18.5z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><rect x="9.8" y="9.8" width="4.4" height="4.4" transform="rotate(45 12 12)"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="1"/><path d="M10.5 18.5h3"/>',
    swap: '<path d="M8 3.5v16M4.5 7L8 3.5 11.5 7M16 20.5v-16M12.5 17l3.5 3.5 3.5-3.5"/>',
    pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    warn: '<path d="M12 3.5L21 20H3z"/><path d="M12 10v4.5M12 17v.5"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    ext: '<path d="M13.5 3.5h7v7M20.5 3.5L11 13"/><path d="M18 14v6.5H3.5V6H10"/>',
  };
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' +
    Object.entries(P).map(([k, v]) => '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter">' + v + '</symbol>').join('') + '</svg>';
  function inject() {
    if (document.getElementById('icon-sprite')) return;
    const d = document.createElement('div'); d.id = 'icon-sprite'; d.innerHTML = sprite;
    document.body.insertBefore(d, document.body.firstChild);
    // 靜態標記：<i data-ic="plan"></i>
    document.querySelectorAll('[data-ic]').forEach((el) => { el.outerHTML = ic(el.dataset.ic); });
  }
  function ic(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + (P[name] ? name : 'pin') + '"/></svg>';
  }
  window.TripIcons = { ic, inject, names: Object.keys(P) };
  if (document.body) inject(); else document.addEventListener('DOMContentLoaded', inject);
})();

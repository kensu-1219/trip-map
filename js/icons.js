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
    hotel: '<g transform="translate(0.77 -1.32)"><path d="M3.5 19.5v-12M3.5 15.5h17v4M3.5 11.5h6.5v4M10 11.5h7.5a3 3 0 0 1 3 3v1"/><rect x="5.3" y="8.7" width="2.6" height="2.6"/></g>',
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
    // ---- 地點分類 ----
    c_food: '<g transform="translate(0.1 1.29)"><path d="M6.5 3v5.5a2 2 0 0 0 4 0V3M8.5 3v18"/><path d="M17.5 21V3c-2 1.1-4 3.6-4 7.4V13.5h4"/></g>',
    c_cafe: '<g transform="translate(0.32 -0.9)"><path d="M4.5 9h12v5.5a4.5 4.5 0 0 1-4.5 4.5H9a4.5 4.5 0 0 1-4.5-4.5z"/><path d="M16.5 10.5h1.5a2.3 2.3 0 0 1 0 4.6h-1.8M3.5 21h15"/><path d="M8.5 3.5c-.8 1 .8 2 0 3M12.5 3.5c-.8 1 .8 2 0 3"/></g>',
    c_bar: '<g transform="translate(-0.05 1.79)"><path d="M4 4h16l-8 9z"/><path d="M12 13v7.5M8 20.5h8M15.5 4l2.5-2"/><circle cx="16.5" cy="7" r="1" fill="currentColor"/></g>',
    c_station: '<rect x="6.5" y="3" width="11" height="13" rx="2"/><path d="M6.5 9.5h11"/><rect x="8.8" y="12" width="1.4" height="1.4" fill="currentColor" stroke="none"/><rect x="13.8" y="12" width="1.4" height="1.4" fill="currentColor" stroke="none"/><path d="M9 16.5L7 21M15 16.5l2 4.5M8.2 19h7.6"/>',
    c_airport: '<g transform="translate(0.7 -0.28)"><path d="M2.8 14.5L21 7.6c.8-.3.9-1.4.1-1.8-.6-.3-1.3-.3-1.9 0L14.5 8 7.6 4.6 5.5 5.5l4.6 4.3-4 1.6-2.4-1.3-1.5.7 2 3z"/><path d="M3 20.5h18"/></g>',
    c_shopping: '<path d="M4.5 8h15l-1 13h-13z"/><path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5"/>',
    c_market: '<path d="M3 9.5L4.5 4h15L21 9.5z"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M4.5 12v8.5h15V12M9.5 20.5v-5h5v5"/>',
    c_museum: '<g transform="translate(0.15 -0.91)"><path d="M3 9L12 4l9 5z"/><path d="M6 11.5v6.5M12 11.5v6.5M18 11.5v6.5M3.5 21h17M4.5 18.5h15"/></g>',
    c_temple: '<path d="M2.5 5.5c3 .8 6 1.2 9.5 1.2s6.5-.4 9.5-1.2"/><path d="M4.5 10h15M6.5 6.5V21M17.5 6.5V21M12 6.7V10"/>',
    c_castle: '<g transform="translate(0.07 -0.42)"><path d="M4 21V10h3V7.5h2.5V10h5V7.5H17V10h3v11z"/><path d="M10 21v-4.5a2 2 0 0 1 4 0V21M12 7.5V3l3.5 1.5L12 6"/></g>',
    c_park: '<path d="M12 21v-6.5"/><path d="M12 3L6 12h3l-3.5 4.5h13L15 12h3z"/>',
    c_beach: '<g transform="translate(0.78 0.19)"><path d="M3 20c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0"/><path d="M12.5 16.5L9 6"/><path d="M3.5 8.5a8 8 0 0 1 13-3.5z"/></g>',
    c_view: '<g transform="translate(0.15 0.29)"><path d="M12 2.5v3M9 21l1.8-15.5h2.4L15 21M8 21h8M10.2 11h3.6M9.6 15.5h4.8"/><path d="M5 8.5a7.5 7.5 0 0 1 3-3.5M19 8.5a7.5 7.5 0 0 0-3-3.5"/></g>',
    c_landmark: '<g transform="translate(1.84 0.45)"><path d="M5.5 21V3.5"/><path d="M5.5 4.5h12l-2.5 4 2.5 4h-12"/><path d="M3 21h6"/></g>',
    c_theme: '<g transform="translate(0.15 0.31)"><circle cx="12" cy="10" r="7"/><path d="M12 3v14M5 10h14M7 5l10 10M17 5L7 15"/><path d="M8 21l4-4 4 4z"/></g>',
    c_zoo: '<g transform="translate(-0.53 0.6)"><circle cx="7" cy="9" r="1.9"/><circle cx="11" cy="5.8" r="1.9"/><circle cx="15.5" cy="6.5" r="1.9"/><circle cx="18.5" cy="10.5" r="1.9"/><path d="M12.5 11c-2.6 0-5.5 3.4-5.5 6.3 0 1.9 1.5 2.7 3 2.2 1.5-.4 2.8-.4 4.2.1 1.6.5 3-.4 3-2.2 0-3-2.6-6.4-4.7-6.4z"/></g>',
    c_onsen: '<path d="M3.5 14.5c0 3.5 3.8 6 8.5 6s8.5-2.5 8.5-6"/><path d="M3.5 14.5h17"/><path d="M8 11.5c-1.3-1.5 1.3-2.5 0-4.2S9.3 4.8 8 3.5M12 11.5c-1.3-1.5 1.3-2.5 0-4.2S13.3 4.8 12 3.5M16 11.5c-1.3-1.5 1.3-2.5 0-4.2S17.3 4.8 16 3.5"/>',
    c_hotel: '<g transform="translate(0.77 -1.32)"><path d="M3.5 19.5v-12M3.5 15.5h17v4M3.5 11.5h6.5v4M10 11.5h7.5a3 3 0 0 1 3 3v1"/><rect x="5.3" y="8.7" width="2.6" height="2.6"/></g>',
    c_other: '<g transform="translate(0.15 0.37)"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></g>',
    // ---- 其他新圖示 ----
    done: '<rect x="3.5" y="3.5" width="17" height="17"/><path d="M7.5 12.5l3 3 6-7"/>',
    undone: '<rect x="3.5" y="3.5" width="17" height="17"/>',
    today: '<rect x="3.5" y="5" width="17" height="15"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><rect x="10" y="12.5" width="4" height="4" transform="rotate(45 12 14.5)" fill="currentColor"/>',
    money: '<rect x="2.5" y="6" width="19" height="12"/><circle cx="12" cy="12" r="2.8"/><path d="M5.5 9v6M18.5 9v6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    cloudy: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 18.5z"/>',
    rain: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
    snow: '<path d="M7 14h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 14z"/><path d="M8 17.5v.5M12 19v.5M16 17.5v.5M10 21v.5M14 21v.5"/>',
    storm: '<path d="M7 14h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 14z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14M8 21h8"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><rect x="3.5" y="4.5" width="3" height="3"/><rect x="3.5" y="10.5" width="3" height="3"/><rect x="3.5" y="16.5" width="3" height="3"/>',
    theme: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-1 .8-1.7 1.9-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><rect x="6.5" y="10.5" width="2.2" height="2.2"/><rect x="9.5" y="6.5" width="2.2" height="2.2"/><rect x="14" y="6.5" width="2.2" height="2.2"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5V3.5h5v3M6 6.5l1 14h10l1-14M10 10.5v6M14 10.5v6"/>',
    next: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
    grip: '<rect x="8" y="5" width="2.4" height="2.4" fill="currentColor"/><rect x="13.6" y="5" width="2.4" height="2.4" fill="currentColor"/><rect x="8" y="10.8" width="2.4" height="2.4" fill="currentColor"/><rect x="13.6" y="10.8" width="2.4" height="2.4" fill="currentColor"/><rect x="8" y="16.6" width="2.4" height="2.4" fill="currentColor"/><rect x="13.6" y="16.6" width="2.4" height="2.4" fill="currentColor"/>',
    expand: '<path d="M6 9l6 6 6-6"/>',
    collapse: '<path d="M18 15l-6-6-6 6"/>',
    filter: '<path d="M3.5 4.5h17l-6.5 8v6l-4 2v-8z"/>',
  };
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' +
    Object.entries(P).map(([k, v]) => '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="square" stroke-linejoin="miter">' + v + '</symbol>').join('') + '</svg>';
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

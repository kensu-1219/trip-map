/* 向量底圖樣式（OpenFreeMap / OpenMapTiles 圖資）：日系插畫、NieR 兩套。
   只在選到這兩個主題時才載入 MapLibre。 */
(function () {
  'use strict';
  const SRC = 'https://tiles.openfreemap.org/planet';
  const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const ATTR = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

  // 中文優先，沒有就用當地名稱
  const NAME = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name'], ['get', 'name:latin']];

  const PAL = {
    illust: {
      bg: '#f6efdc', water: '#a8d5e2', waterLine: '#7fb8cc', sea: '#bfe2ec', park: '#cfe4b4', wood: '#b6d69c', grass: '#dcebc4',
      sand: '#f2e2b8', farm: '#efe7c6', residential: '#f3e8cf', building: '#ead9b9', buildingLine: '#d9c39c',
      road: '#ffffff', roadCase: '#e2c99d', major: '#ffd9a3', majorCase: '#d9a868', motorway: '#f7b977', motorwayCase: '#c98a4a',
      rail: '#b08a6a', path: '#c9a97c', boundary: '#c79a8a',
      label: '#5a3e2b', labelHalo: '#fbf6ea', water_label: '#3f7f9a', city: '#4a2f1e', font: ['Noto Sans Bold'], fontReg: ['Noto Sans Regular'],
      roadW: 1.15,
    },
    nier: {
      bg: '#d6d0b8', water: '#c4bea5', waterLine: '#8d877288', sea: '#c4bea5', park: '#cdc7ac', wood: '#c7c1a5', grass: '#d1cbb2',
      sand: '#d3cdb4', farm: '#d3cdb4', residential: '#d2ccb3', building: 'rgba(0,0,0,0)', buildingLine: '#8f8a76',
      road: '#e4dfca', roadCase: '#6e6a5a', major: '#e9e4d0', majorCase: '#4a463b', motorway: '#4a463b', motorwayCase: '#4a463b',
      rail: '#4a463b', path: '#8f8a76', boundary: '#4a463b',
      label: '#3c3a33', labelHalo: '#d6d0b8', water_label: '#57534a', city: '#2e2c26', font: ['Noto Sans Regular'], fontReg: ['Noto Sans Regular'],
      roadW: 0.8,
    },
  };

  const zw = (pairs, k) => ['interpolate', ['exponential', 1.5], ['zoom']].concat(pairs.flatMap(([z, w]) => [z, w * (k || 1)]));

  function build(theme) {
    const c = PAL[theme];
    if (!c) return null;
    const nier = theme === 'nier';
    const roadSel = (classes) => ['all', ['==', ['geometry-type'], 'LineString'], ['match', ['get', 'class'], classes, true, false]];
    const layers = [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': c.wood, 'fill-opacity': nier ? 0.6 : 0.9 } },
      { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['match', ['get', 'class'], ['grass', 'wetland'], true, false], paint: { 'fill-color': c.grass, 'fill-opacity': 0.8 } },
      { id: 'landcover-sand', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'sand'], paint: { 'fill-color': c.sand } },
      { id: 'landcover-farm', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'farmland'], paint: { 'fill-color': c.farm, 'fill-opacity': 0.7 } },
      { id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], true, false], paint: { 'fill-color': c.residential, 'fill-opacity': 0.7 } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park, 'fill-opacity': 0.9 } },
      { id: 'park-pattern', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 11, paint: { 'fill-pattern': theme + '-park', 'fill-opacity': nier ? 0.35 : 0.5 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'water-pattern', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-pattern': theme + '-water', 'fill-opacity': nier ? 0.55 : 0.6 } },
      { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', paint: { 'line-color': c.waterLine, 'line-width': nier ? 0.8 : 1.4, 'line-blur': nier ? 0 : 0.6 } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': c.water, 'line-width': zw([[8, 0.6], [14, 2.5], [18, 6]]) } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine, 'fill-opacity': nier ? 1 : 0.9 } },
      { id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14, filter: roadSel(['path', 'track']), paint: { 'line-color': c.path, 'line-width': zw([[14, 0.6], [18, 1.6]]), 'line-dasharray': [2, 2] } },
      { id: 'minor-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: roadSel(['minor', 'service', 'tertiary']), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.roadCase, 'line-width': zw([[12, 1], [14, 3.2], [18, 16]], c.roadW) } },
      { id: 'minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: roadSel(['minor', 'service', 'tertiary']), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.road, 'line-width': zw([[12, 0.4], [14, 2], [18, 13]], c.roadW) } },
      { id: 'major-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: roadSel(['primary', 'secondary', 'trunk']), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.majorCase, 'line-width': zw([[6, 0.6], [10, 2.4], [14, 6], [18, 24]], c.roadW) } },
      { id: 'major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: roadSel(['primary', 'secondary', 'trunk']), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.major, 'line-width': zw([[6, 0.3], [10, 1.4], [14, 4.4], [18, 20]], c.roadW) } },
      { id: 'motorway-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 5, filter: roadSel(['motorway']), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.motorwayCase, 'line-width': zw([[5, 0.8], [10, 3], [14, 7], [18, 26]], c.roadW) } },
      { id: 'motorway', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 5, filter: roadSel(['motorway']), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.motorway, 'line-width': zw([[5, 0.4], [10, 1.8], [14, 5], [18, 22]], c.roadW) } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 8, filter: roadSel(['rail', 'transit']), paint: { 'line-color': c.rail, 'line-width': zw([[8, 0.6], [14, 1.6], [18, 3]]) } },
      { id: 'rail-hatch', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: roadSel(['rail', 'transit']), paint: { 'line-color': c.rail, 'line-width': zw([[12, 3], [18, 8]]), 'line-dasharray': [0.2, 3] } },
      { id: 'boundary-state', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 5, filter: ['all', ['>', ['get', 'admin_level'], 2], ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': c.boundary, 'line-opacity': 0.45, 'line-width': nier ? 0.6 : 0.9, 'line-dasharray': [2, 2] } },
      { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': c.boundary, 'line-width': nier ? 0.9 : 1.4, 'line-dasharray': nier ? [6, 2, 1, 2] : [3, 2] } },
      { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': NAME, 'text-font': c.fontReg, 'text-size': 12, 'text-letter-spacing': 0.2 }, paint: { 'text-color': c.water_label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.2 } },
      { id: 'water-name-line', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'text-field': NAME, 'text-font': c.fontReg, 'text-size': 12, 'text-letter-spacing': 0.2, 'symbol-placement': 'line' }, paint: { 'text-color': c.water_label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.2 } },
      { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14, layout: { 'text-field': NAME, 'text-font': c.fontReg, 'text-size': 11, 'symbol-placement': 'line' }, paint: { 'text-color': c.label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.4 } },
      { id: 'poi-station', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 13, filter: ['match', ['get', 'class'], ['railway'], true, false], layout: { 'text-field': NAME, 'text-font': c.font, 'text-size': 11, 'text-offset': [0, 0.2] }, paint: { 'text-color': c.rail, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6 } },
      { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 11, filter: ['match', ['get', 'class'], ['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet'], true, false], layout: { 'text-field': NAME, 'text-font': c.fontReg, 'text-size': 12, 'text-letter-spacing': nier ? 0.25 : 0.05 }, paint: { 'text-color': c.label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6, 'text-opacity': 0.85 } },
      { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 7, filter: ['match', ['get', 'class'], ['town'], true, false], layout: { 'text-field': NAME, 'text-font': c.font, 'text-size': zw([[7, 11], [14, 16]]) }, paint: { 'text-color': c.city, 'text-halo-color': c.labelHalo, 'text-halo-width': 2 } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 3, filter: ['match', ['get', 'class'], ['city'], true, false], layout: { 'text-field': NAME, 'text-font': c.font, 'text-size': zw([[4, 12], [12, 22]]), 'text-letter-spacing': nier ? 0.3 : 0.08 }, paint: { 'text-color': c.city, 'text-halo-color': c.labelHalo, 'text-halo-width': 2.4 } },
      { id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 7, filter: ['==', ['get', 'class'], 'country'], layout: { 'text-field': NAME, 'text-font': c.font, 'text-size': 14, 'text-letter-spacing': 0.4 }, paint: { 'text-color': c.city, 'text-halo-color': c.labelHalo, 'text-halo-width': 2 } },
    ];
    return {
      version: 8,
      glyphs: GLYPHS,
      sources: { omt: { type: 'vector', url: SRC, attribution: ATTR } },
      layers,
    };
  }

  /** 在畫布上畫紋理：日系＝波浪海、葉點；NieR＝斜線、細點 */
  function patterns(theme) {
    const mk = (w, h, draw) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d'); draw(g, w, h);
      return g.getImageData(0, 0, w, h);
    };
    if (theme === 'illust') {
      return {
        'illust-water': mk(48, 24, (g) => {
          g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(4, 9); g.quadraticCurveTo(10, 4, 16, 9); g.quadraticCurveTo(22, 14, 28, 9); g.stroke();
          g.beginPath(); g.moveTo(28, 20); g.quadraticCurveTo(34, 15, 40, 20); g.stroke();
        }),
        'illust-park': mk(24, 24, (g) => {
          g.fillStyle = 'rgba(79,125,85,.35)';
          [[6, 6], [18, 15]].forEach(([x, y]) => { g.beginPath(); g.ellipse(x, y, 2.4, 1.6, -0.6, 0, Math.PI * 2); g.fill(); });
        }),
      };
    }
    return {
      'nier-water': mk(12, 12, (g) => {
        g.strokeStyle = 'rgba(74,70,59,.45)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(0, 12); g.lineTo(12, 0); g.stroke();
      }),
      'nier-park': mk(10, 10, (g) => { g.fillStyle = 'rgba(74,70,59,.45)'; g.fillRect(4, 4, 1.2, 1.2); }),
    };
  }

  window.TripMapStyle = { build, patterns, VECTOR: Object.keys(PAL), ATTR };
})();

// The look of the map: which "bright" layers show, and in which colors.
// Reprise de archivir.ch (noms des cours d'eau conservés, relief renforcé).
import * as maplibregl from 'maplibre-gl';
import { setTextures } from './map-textures.js?v=109';

export const DEFAULT_PALETTE = {
  paper: '#f2f0e9',
  water: '#b6d1d8',
  wood: '#cfd6b8',
  farmland: '#efead7',
  grass: '#ebe8d6',
  park: '#f4f6ea',
  zone: '#8e5e3e',
  zoneOpacity: 0.13,
  road: '#fffcf4',
  boundary: '#d7ccc1',
  building: '#34312f',
  buildingLine: '#a39f97',
  reliefShadow: '#6b5a47',
  relief: 0.2,
  vegetation: 0.15,
};

// strip "bright" down to just city names on a plain white-roads base —
// no POI icons, no route-number shields, no street/water names, no
// admin-region or country labels. Layer ids are OpenMapTiles' own,
// read straight off the fetched style (openfreemap.org/…/bright).
const HIDE_LAYERS = [
  // POI / shop / transit / airport icons
  'poi_r20', 'poi_r7', 'poi_r1', 'poi_transit', 'airport',
  // route-number shields (A9, "9", …)
  'highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us',
  // street and path name labels
  'highway-name-path', 'highway-name-minor', 'highway-name-major',
  // protected areas, not parks: OSM draws nature reserves and whole
  // regional parks here, which covered large parts of the map in one tint
  'park',
  // ferry routes
  'ferry',
  // dashed footpaths and underground rail
  'tunnel-path', 'highway-path', 'bridge-path-casing', 'bridge-path', 'tunnel-railway',
  // one-way arrows
  'road_oneway', 'road_oneway_opposite',
  // every place label except city/town/village
  'label_other', 'label_state', 'label_country_1', 'label_country_2', 'label_country_3',
];
const WHITE_ROAD_LAYERS = [
  'tunnel-service-track-casing', 'tunnel-motorway-link-casing', 'tunnel-minor-casing',
  'tunnel-link-casing', 'tunnel-secondary-tertiary-casing', 'tunnel-trunk-primary-casing',
  'tunnel-motorway-casing', 'tunnel-motorway-link', 'tunnel-service-track', 'tunnel-link',
  'tunnel-minor', 'tunnel-secondary-tertiary', 'tunnel-trunk-primary', 'tunnel-motorway',
  'highway-motorway-link-casing', 'highway-link-casing', 'highway-minor-casing',
  'highway-secondary-tertiary-casing', 'highway-primary-casing', 'highway-trunk-casing',
  'highway-motorway-casing', 'highway-motorway-link', 'highway-link', 'highway-minor',
  'highway-secondary-tertiary', 'highway-primary', 'highway-trunk', 'highway-motorway',
  'bridge-motorway-link-casing', 'bridge-link-casing', 'bridge-secondary-tertiary-casing',
  'bridge-trunk-primary-casing', 'bridge-motorway-casing', 'bridge-minor-casing',
  'bridge-motorway-link', 'bridge-link', 'bridge-minor', 'bridge-secondary-tertiary',
  'bridge-trunk-primary', 'bridge-motorway',
];
const WATER_LINE_LAYERS = [
  'waterway_tunnel', 'waterway-other', 'waterway-other-intermittent',
  'waterway-stream-canal', 'waterway-stream-canal-intermittent',
  'waterway-river', 'waterway-river-intermittent',
];
const ZONE_LAYERS = [
  'landuse-residential', 'landuse-suburb', 'landuse-commercial', 'landuse-industrial',
  'landuse-cemetery', 'landuse-hospital', 'landuse-school', 'landuse-railway',
];
const BOUNDARY_LAYERS = ['boundary_2', 'boundary_3', 'boundary_disputed'];
const RELIEF_LAYER = 'relief';
const FARMLAND_LAYER = 'farmland';
const VEGETATION_LAYER = 'vegetation-low-zoom';

// Natural Earth bakes its hill shading into the image. Shading is a change
// of brightness, so giving every pixel the same brightness leaves only the
// color of the vegetation; the smaller canvas smooths what remains.
const VEGETATION_PROTOCOL = 'flat-vegetation';
const NATURAL_EARTH = 'https://tiles.openfreemap.org/natural_earth/ne2sr/';
const FLAT_SIZE = 64;
const FLAT_BRIGHTNESS = 200;

async function flatVegetationTile(params, abort){
  const response = await fetch(params.url.replace(`${VEGETATION_PROTOCOL}://`, NATURAL_EARTH), { signal: abort.signal });
  if (!response.ok) throw new Error(`Natural Earth : ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const small = document.createElement('canvas');
  small.width = small.height = FLAT_SIZE;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, FLAT_SIZE, FLAT_SIZE);
  const image = ctx.getImageData(0, 0, FLAT_SIZE, FLAT_SIZE);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4){
    const scale = FLAT_BRIGHTNESS / Math.max(1, 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = Math.min(255, d[i] * scale);
    d[i + 1] = Math.min(255, d[i + 1] * scale);
    d[i + 2] = Math.min(255, d[i + 2] * scale);
  }
  ctx.putImageData(image, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = bitmap.width;
  const output = canvas.getContext('2d');
  output.imageSmoothingQuality = 'high';
  output.drawImage(small, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { data: await blob.arrayBuffer() };
}

let protocolAdded = false;

function rgba(hex, alpha){
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function setPaint(map, id, props){
  if (!map.getLayer(id)) return;
  Object.entries(props).forEach(([prop, value]) => map.setPaintProperty(id, prop, value));
}

// Everything the sliders can change. "bright" tints its zoning categories
// with candy colors that mean nothing here, so they collapse into one wash.
// Urban parks, wood and grass stay opaque because OSM stacks these polygons: a
// see-through fill would show every overlap as a darker hard-edged shape.
export function paintMap(map, palette){
  setTextures(map, palette);
  setPaint(map, 'background', { 'background-pattern': 'pencil-paper' });
  setPaint(map, 'water', { 'fill-pattern': 'pencil-water' });
  setPaint(map, 'water-intermittent', { 'fill-pattern': 'pencil-water', 'fill-opacity': 1 });
  setPaint(map, 'building', { 'fill-pattern': 'pencil-building' });
  setPaint(map, 'road_area_pier', { 'fill-color': palette.paper });
  setPaint(map, 'landcover-sand', { 'fill-color': palette.paper });
  setPaint(map, 'landcover-grass', { 'fill-color': palette.grass, 'fill-opacity': 1 });
  setPaint(map, 'landcover-grass-park', { 'fill-color': palette.park, 'fill-opacity': 1 });
  setPaint(map, 'landcover-wood', { 'fill-color': palette.wood, 'fill-opacity': 1, 'fill-outline-color': palette.wood });
  ZONE_LAYERS.forEach((id) => setPaint(map, id, { 'fill-color': rgba(palette.zone, palette.zoneOpacity) }));
  BOUNDARY_LAYERS.forEach((id) => setPaint(map, id, { 'line-color': palette.boundary }));
  WATER_LINE_LAYERS.forEach((id) => setPaint(map, id, { 'line-color': palette.water }));
  // casing + main line share one color so a road reads as a single pale
  // stroke; slightly see-through so the paper grain carries on under it
  WHITE_ROAD_LAYERS.forEach((id) => setPaint(map, id, { 'line-color': rgba(palette.road, 0.85) }));
  setPaint(map, 'building-pencil-line', { 'line-color': palette.buildingLine });
  setPaint(map, FARMLAND_LAYER, { 'fill-color': palette.farmland });
  // hidden at 0 so its image tiles aren't downloaded for nothing
  if (map.getLayer(VEGETATION_LAYER)) map.setLayoutProperty(VEGETATION_LAYER, 'visibility', palette.vegetation > 0 ? 'visible' : 'none');
  setPaint(map, VEGETATION_LAYER, {
    'raster-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, palette.vegetation, 9, 0],
  });
  setPaint(map, RELIEF_LAYER, {
    'hillshade-exaggeration': palette.relief,
    'hillshade-shadow-color': palette.reliefShadow,
  });
}

export function applyMapStyle(map, palette){
  HIDE_LAYERS.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
  // "bright" fakes a 3D roof with a second copy of every building
  // ('building-top') shifted 2px up-left from z16, which just looks like
  // every building is drawn twice once they are dark
  if (map.getLayer('building-top')) map.setLayoutProperty('building-top', 'visibility', 'none');

  // a pattern fill draws no outline of its own
  map.addLayer({
    id: 'building-pencil-line', type: 'line', source: 'openmaptiles', 'source-layer': 'building',
    minzoom: 14,
    paint: { 'line-opacity': 0.75, 'line-width': 0.6 },
  }, 'building-top');

  // the tiles carry no forests below zoom 7, so a Natural Earth image
  // brings the green at small scales and fades out as the real data arrives
  if (!protocolAdded){
    maplibregl.addProtocol(VEGETATION_PROTOCOL, flatVegetationTile);
    protocolAdded = true;
  }
  map.addSource(VEGETATION_LAYER, {
    type: 'raster',
    tiles: [`${VEGETATION_PROTOCOL}://{z}/{x}/{y}.png`],
    tileSize: 256,
    maxzoom: 6,
  });
  map.addLayer({
    id: VEGETATION_LAYER, type: 'raster', source: VEGETATION_LAYER, maxzoom: 9,
  }, 'landcover-glacier');
  // the tiles carry farmland but "bright" has no layer to draw it
  map.addLayer({
    id: FARMLAND_LAYER, type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
    filter: ['==', ['get', 'class'], 'farmland'],
  }, 'landuse-residential');

  // hill shading over the land colors, under water, roads and buildings
  map.addSource(RELIEF_LAYER, {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 12,
    attribution: 'Relief : Mapzen Terrain Tiles',
  });
  map.addLayer({
    id: RELIEF_LAYER, type: 'hillshade', source: RELIEF_LAYER,
    paint: { 'hillshade-highlight-color': 'rgba(255, 255, 255, 0.5)', 'hillshade-accent-color': 'rgba(0, 0, 0, 0)' },
  }, 'waterway_tunnel');

  paintMap(map, palette);
}

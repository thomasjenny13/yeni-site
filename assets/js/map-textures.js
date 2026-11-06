// Paper and building textures for the map, drawn once on a canvas at load.
// Seeded, so the map looks the same on every visit, and seamless, so
// MapLibre can repeat them as fill patterns: every stroke that crosses
// an edge is drawn again on the opposite side.

function seeded(seed){
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strokes(ctx, size, rand, o){
  const between = (range) => range[0] + rand() * (range[1] - range[0]);
  ctx.lineCap = 'round';
  for (let i = 0; i < o.count; i++){
    const x = rand() * size;
    const y = rand() * size;
    const angle = o.angle + (rand() - 0.5) * o.wobble;
    const half = between(o.length) / 2;
    const dx = Math.cos(angle) * half;
    const dy = Math.sin(angle) * half;
    const bow = (rand() - 0.5) * half * 0.08;
    ctx.strokeStyle = o.color;
    ctx.globalAlpha = between(o.alpha);
    ctx.lineWidth = between(o.width);
    for (const ox of [-size, 0, size]){
      for (const oy of [-size, 0, size]){
        const left = x + ox - Math.abs(dx);
        const top = y + oy - Math.abs(dy);
        if (left > size || top > size || left + 2 * Math.abs(dx) < 0 || top + 2 * Math.abs(dy) < 0) continue;
        ctx.beginPath();
        ctx.moveTo(x + ox - dx, y + oy - dy);
        ctx.quadraticCurveTo(x + ox - dy / half * bow, y + oy + dx / half * bow, x + ox + dx, y + oy + dy);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

// per-pixel tooth of the paper: only touches pixels that have some ink
function grain(ctx, size, rand, amount){
  const image = ctx.getImageData(0, 0, size, size);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4){
    if (!d[i + 3]) continue;
    const n = (rand() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

// soft clouds, as in polished stone; each is drawn again across the
// edges so the tile stays seamless
function mottle(ctx, size, rand, o){
  for (let i = 0; i < o.count; i++){
    const x = rand() * size;
    const y = rand() * size;
    const radius = o.radius[0] + rand() * (o.radius[1] - o.radius[0]);
    for (const ox of [-size, 0, size]){
      for (const oy of [-size, 0, size]){
        const gradient = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, radius);
        gradient.addColorStop(0, o.color);
        gradient.addColorStop(1, o.transparent);
        ctx.fillStyle = gradient;
        ctx.fillRect(x + ox - radius, y + oy - radius, radius * 2, radius * 2);
      }
    }
  }
}

function mix(hex, target, amount){
  const channel = (i) => parseInt(hex.slice(i, i + 2), 16);
  const rgb = [1, 3, 5].map((i) => Math.round(channel(i) + (target - channel(i)) * amount));
  return (alpha) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function texture(size, seed, draw){
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  draw(ctx, seeded(seed));
  return ctx.getImageData(0, 0, size, size);
}

// MapLibre copies every pattern a tile uses into that tile's own image
// atlas, so large patterns multiply GPU memory by the number of tiles.
// Tile patterns stay at 256 px. Only the paper, which fills the background
// layer and isn't in any tile atlas, can afford more pixels.
const TILE = 256;
const PAPER = 512;
// water covers the largest areas, so its clouds need a longer repeat
const WATER = 512;

const TEXTURES = {
  paper: { pixelRatio: 2, make: (color) => texture(PAPER, 11, (ctx, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, PAPER, PAPER);
    // only the tooth: strokes or stains would repeat visibly
    grain(ctx, PAPER, rand, 15);
  }) },
  // pale stone: flat from afar, soft clouds and fine grain up close
  water: { pixelRatio: 1, make: (color) => texture(WATER, 23, (ctx, rand) => {
    const dark = mix(color, 0, 0.3);
    const light = mix(color, 255, 0.35);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, WATER, WATER);
    mottle(ctx, WATER, rand, { count: 26, radius: [50, 150], color: dark(0.1), transparent: dark(0) });
    mottle(ctx, WATER, rand, { count: 22, radius: [40, 130], color: light(0.14), transparent: light(0) });
    grain(ctx, WATER, rand, 9);
  }) },
  // photocopied poché: near-black, grainy, faint vertical formwork
  building: { pixelRatio: 1, make: (color) => texture(TILE, 53, (ctx, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, TILE, TILE);
    strokes(ctx, TILE, rand, { count: 150, angle: 1.57, wobble: 0.03, length: [20, 90], width: [0.5, 1.2], alpha: [0.2, 0.5], color: mix(color, 0, 0.6)(1) });
    grain(ctx, TILE, rand, 34);
  }) },
};

const drawn = new Map();

// draws each texture in its palette color, skipping those already in it
export function setTextures(map, palette){
  Object.entries(TEXTURES).forEach(([name, { pixelRatio, make }]) => {
    const id = `pencil-${name}`;
    if (drawn.get(id) === palette[name] && map.hasImage(id)) return;
    drawn.set(id, palette[name]);
    if (map.hasImage(id)) map.updateImage(id, make(palette[name]));
    else map.addImage(id, make(palette[name]), { pixelRatio });
  });
}

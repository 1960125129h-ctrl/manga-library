'use strict';

// 工作台取色主进程模块
// 渲染进程的 file:// canvas 可能被污染，不能直接读取像素；由这里通过 sharp 解码本地图片。

const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

const BOARD_BG = '#101013';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function byteHex(v) {
  return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
}

function rgbHex(r, g, b) {
  return '#' + byteHex(r) + byteHex(g) + byteHex(b);
}

function colorObject(r, g, b) {
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), hex: rgbHex(r, g, b) };
}

function colorDistance(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
}

function registerRefColorIpc(opts) {
  const ipcMain = opts.ipcMain;
  const getLib = () => (typeof opts.libRoot === 'function' ? opts.libRoot() : opts.libRoot);
  const loadSharp = opts.loadSharp;
  const log = opts.logLine || function () {};

  ipcMain.handle('ref:imageColors', async (event, src, options) => {
    try {
      const LIB = getLib();
      const file = resolveImageFile(LIB, src);
      const sharp = loadSharp();
      if (!sharp) return { ok: false, msg: '没有可用的图片库(sharp)' };

      const meta = await sharp(file).metadata();
      const orientation = meta.orientation || 1;
      const swapped = orientation >= 5 && orientation <= 8;
      const width = swapped ? meta.height : meta.width;
      const height = swapped ? meta.width : meta.height;
      if (!width || !height) return { ok: false, msg: '图片尺寸无效' };

      let color = null;
      if (options && typeof options.x === 'number' && typeof options.y === 'number') {
        const px = Math.round(clamp(options.x, 0, 1) * (width - 1));
        const py = Math.round(clamp(options.y, 0, 1) * (height - 1));
        const sample = 5;
        const left = Math.max(0, Math.floor(px - (sample - 1) / 2));
        const top = Math.max(0, Math.floor(py - (sample - 1) / 2));
        const sw = Math.min(sample, width - left);
        const sh = Math.min(sample, height - top);
        const out = await sharp(file)
          .rotate()
          .extract({ left, top, width: sw, height: sh })
          .flatten({ background: BOARD_BG })
          .raw()
          .toBuffer({ resolveWithObject: true });

        const data = out.data, info = out.info, ch = info.channels;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < sw * sh; i++) {
          const o = i * ch;
          r += data[o]; g += data[o + 1]; b += data[o + 2];
        }
        const n = sw * sh;
        color = colorObject(r / n, g / n, b / n);
        color.x = px; color.y = py; color.sample = sw + 'x' + sh;
      }

      const palette = await buildPalette(sharp, file);
      return { ok: true, width, height, color, palette };
    } catch (err) {
      const msg = String((err && err.message) || err);
      log('工作台', '[取色] ' + msg);
      return { ok: false, msg: '取色失败: ' + msg.slice(0, 120) };
    }
  });
}

function resolveImageFile(LIB, src) {
  let p = String(src || '');
  if (!p) throw new Error('缺少图片地址');
  if (/^file:\/\//i.test(p)) {
    p = fileURLToPath(p);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    throw new Error('不支持网络图片地址');
  } else {
    const rel = decodeURIComponent(p).split(/[?#]/)[0].replace(/^\/+/, '');
    p = path.resolve(LIB, rel);
  }

  p = path.normalize(p);
  const rel = path.relative(LIB, p);
  if (!rel || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) {
    throw new Error('图片不在书库目录内');
  }
  if (!fs.existsSync(p)) throw new Error('图片文件不存在');
  return p;
}

async function buildPalette(sharp, file) {
  const out = await sharp(file)
    .rotate()
    .resize(128, 128, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: BOARD_BG })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = out.data, info = out.info, ch = info.channels;
  const pixels = [];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * ch;
      pixels.push([data[o], data[o + 1], data[o + 2]]);
    }
  }

  const buckets = medianCut(pixels, 8);
  let swatches = buckets.map(function (bucket) {
    let r = 0, g = 0, b = 0;
    for (const p of bucket) { r += p[0]; g += p[1]; b += p[2]; }
    const c = colorObject(r / bucket.length, g / bucket.length, b / bucket.length);
    c.weight = Number((bucket.length / pixels.length).toFixed(4));
    return c;
  });

  swatches = mergeSimilar(swatches);
  swatches.sort((a, b) => b.weight - a.weight);
  return swatches;
}

function medianCut(pixels, count) {
  let buckets = [pixels];

  while (buckets.length < count) {
    let idx = -1, channel = 0, bestRange = -1;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (bucket.length < 2) continue;
      const ranges = [0, 1, 2].map(function (ch) {
        let min = 255, max = 0;
        for (const p of bucket) {
          const v = p[ch];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        return max - min;
      });
      const range = Math.max.apply(null, ranges);
      if (range > bestRange) {
        bestRange = range; idx = i; channel = ranges.indexOf(range);
      }
    }

    if (idx < 0 || bestRange <= 0) break;
    buckets[idx].sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(buckets[idx].length / 2);
    const left = buckets[idx].slice(0, mid);
    const right = buckets[idx].slice(mid);
    buckets.splice(idx, 1, left, right);
  }

  return buckets.filter((bucket) => bucket.length);
}

function mergeSimilar(swatches) {
  const out = [];
  for (const s of swatches) {
    const hit = out.find((o) => colorDistance(o, s) < 18);
    if (!hit) {
      out.push(Object.assign({}, s));
      continue;
    }
    const w = hit.weight + s.weight;
    hit.r = Math.round((hit.r * hit.weight + s.r * s.weight) / w);
    hit.g = Math.round((hit.g * hit.weight + s.g * s.weight) / w);
    hit.b = Math.round((hit.b * hit.weight + s.b * s.weight) / w);
    hit.weight = Number(w.toFixed(4));
    hit.hex = rgbHex(hit.r, hit.g, hit.b);
  }
  return out;
}

module.exports = { registerRefColorIpc };

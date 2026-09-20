const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'icon-d2.svg');
const icoPath = path.join(__dirname, 'icon.ico');

// 生成 256x256 PNG buffer
sharp(svgPath, { density: 384 })
  .resize(256, 256)
  .png()
  .toBuffer()
  .then(png => {
    // ICO file format: header + directory entry + PNG data
    // ICONDIR: 6 bytes
    // ICONDIRENTRY: 16 bytes per image
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // count: 1 image

    const entry = Buffer.alloc(16);
    entry[0] = 0; // width 0 = 256
    entry[1] = 0; // height 0 = 256
    entry[2] = 0; // colors
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8); // size
    entry.writeUInt32LE(22, 12); // offset (6 + 16)

    fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
    console.log('ICO written:', icoPath, png.length, 'bytes');
  })
  .catch(e => { console.error(e); process.exit(1); });

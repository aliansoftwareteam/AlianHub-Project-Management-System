#!/usr/bin/env node
/* Draws the installed app's icons from frontend/public/logo.png. Run it after the logo changes and
 * commit the PNGs: the frontend build only copies them, so it needs neither sharp nor a network. */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const LOGO = path.join(PUBLIC, 'logo.png');
const OUT = path.join(PUBLIC, 'icons');
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
// A launcher may crop a maskable icon to a circle 80% of its width; the mark's corners reach 87% of the logo.
const MASKABLE_MARK_SHARE = 0.8;

const PLAIN = [['icon-192.png', 192], ['icon-512.png', 512]];
const MASKABLE = [['icon-maskable-192.png', 192], ['icon-maskable-512.png', 512]];
// iOS draws its own rounded corners and shows transparency as black.
const OPAQUE = [['apple-touch-icon.png', 180]];

const plain = (size) => sharp(LOGO).resize(size, size).png();

const opaque = (size) => sharp(LOGO).resize(size, size).flatten({ background: WHITE }).png();

const maskable = async (size) => {
    const mark = Math.round(size * MASKABLE_MARK_SHARE);
    const logo = await sharp(LOGO).resize(mark, mark).flatten({ background: WHITE }).toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } }).composite([{ input: logo, gravity: 'centre' }]).png();
};

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const jobs = [
        ...PLAIN.map(([name, size]) => [name, plain(size)]),
        ...OPAQUE.map(([name, size]) => [name, opaque(size)]),
        ...await Promise.all(MASKABLE.map(async ([name, size]) => [name, await maskable(size)])),
    ];
    for (const [name, image] of jobs) {
        await image.toFile(path.join(OUT, name));
        console.log(`frontend/public/icons/${name}`);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});

// Prepare the final PR 2 picks, using existing full-size downloads before Wikimedia.
// Run: node tools/prepare-university-images.mjs [media-directory] [scratch-directory]
// The approved picks supersede the old 1200 px rule. Never upscale a source.
// Network reads are restricted to upload.wikimedia.org, at least five seconds between requests.
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { csvToObjects } from '../js/csv.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const retryDelay = (header, attempt, now = Date.now()) => {
  if (header != null) {
    if (/^\d+(?:\.\d+)?$/.test(header.trim())) return Number(header) * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return [60000, 180000, 600000][attempt];
};
const thumbnail = (pick) => {
  const url = new URL(pick.image_url);
  if (url.hostname === 'thumb.wikimedia.org') url.hostname = 'upload.wikimedia.org';
  if (url.hostname !== 'upload.wikimedia.org') throw new Error(`Disallowed download host for ${pick.id}`);
  const width = Math.min(1280, Number(pick.orig_width));
  assert(width >= 640, `Source too narrow: ${pick.id}`);
  if (url.pathname.includes('/thumb/')) {
    url.pathname = url.pathname.replace(/[^/]+$/, `${width}px-${url.pathname.split('/').at(-2)}`);
  } else {
    const file = url.pathname.split('/').at(-1);
    url.pathname = url.pathname.replace('/wikipedia/commons/', '/wikipedia/commons/thumb/') + `/${width}px-${file}`;
  }
  url.search = '';
  return url;
};
if (process.argv.includes('--self-test')) {
  assert.equal(retryDelay('12', 0), 12000);
  assert.equal(retryDelay('Fri, 13 Nov 2026 12:01:00 GMT', 0, Date.parse('2026-11-13T12:00:00Z')), 60000);
  assert.deepEqual([0, 1, 2].map((a) => retryDelay(null, a)), [60000, 180000, 600000]);
  assert.equal(thumbnail({ id: 'x', orig_width: '960', image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg' }).pathname, '/wikipedia/commons/thumb/a/ab/Example.jpg/960px-Example.jpg');
  assert.equal(thumbnail({ id: 'x', orig_width: '3000', image_url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1920px-Example.jpg?x=1' }).href, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1280px-Example.jpg');
  console.log('Image preparation self-tests passed.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const media = resolve(process.argv[2] || '/Users/leon/projects/ib-research-media');
const scratch = resolve(process.argv[3] || '/Users/leon/projects/ib-research-expansion/pr2/wave/tmp/build');
const out = join(root, 'img/universities');
mkdirSync(scratch, { recursive: true });
mkdirSync(out, { recursive: true });
const read = (p) => csvToObjects(readFileSync(p, 'utf8'), p).rows;
const picks = read(join(media, 'picks.csv'));
const dimensions = (p) => {
  const text = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf8' });
  return ['pixelWidth', 'pixelHeight'].map((key) => Number(new RegExp(`${key}: (\\d+)`).exec(text)?.[1]));
};
// Match filenames through their manifests, never by the university id alone:
// a cached "current" image may have been replaced by a later pick.
const local = new Map();
const add = (title, path) => {
  if (!title || !existsSync(path)) return;
  const [w, h] = dimensions(path);
  if (w >= 640 && h >= 360 && (!local.has(title) || w > local.get(title).w)) local.set(title, { path, w });
};
for (const [round, suffix] of [['', ''], ['2', '2'], ['3', '3']]) {
  for (const r of read(join(media, `chrome${round}-vetted.csv`))) {
    add(r.title, join(media, `chrome${round}-thumbs`, `${r.id}-${r.rank}.jpg`));
  }
  const previous = join(media, `picks.before-chrome${suffix}.csv`);
  if (existsSync(previous)) for (const r of read(previous)) add(r.file_title, join(media, `chrome${round}-thumbs`, `cur-${r.id}.jpg`));
}
for (const id of ['reading', 'ceu']) add(`images-other/${id}.jpg`, join(media, 'images-other', `${id}.jpg`));
let lastRequest = 0;
const report = { written: [], retained: [], omitted: [], downloaded: 0, reused: 0, largest: { bytes: 0 } };
async function download(pick, destination) {
  let url = thumbnail(pick);
  for (let attempt = 0; attempt < 4; attempt++) {
    await delay(Math.max(0, 5000 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    let response;
    try {
      response = await fetch(url, { redirect: 'error', headers: { 'User-Agent': 'IB-University-Finder-Image-Preparation/1.0 (educational static catalogue)' }, signal: AbortSignal.timeout(60000) });
      if (response.ok) {
        if (!/^image\/(jpeg|png|webp|tiff)/.test(response.headers.get('content-type') || '')) throw new Error('response is not an image');
        writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
        report.downloaded++;
        return true;
      }
      await response.body?.cancel();
      // Commons rejects some same-size thumbnails with HTTP 400. The
      // approved original is the same image, without thumbnail generation.
      if (attempt < 3 && response.status === 400 && +pick.orig_width <= 1280 && url.pathname.includes('/thumb/')) {
        url = new URL(url);
        url.pathname = url.pathname.replace('/thumb/', '/').replace(/\/[^/]+$/, '');
        console.log(`${pick.id}: same-size thumbnail rejected; trying the approved original`);
        continue;
      }
      if (![429, 503].includes(response.status)) {
        report.omitted.push({ id: pick.id, reason: `HTTP ${response.status} fetching ${url}` });
        return false;
      }
    } catch (error) {
      if (attempt === 3) { report.omitted.push({ id: pick.id, reason: `four download failures: ${error.message}` }); return false; }
      console.log(`${pick.id}: ${error.message}; attempt ${attempt + 1}/4 failed`);
    }
    if (attempt === 3) {
      report.omitted.push({ id: pick.id, reason: `HTTP ${response.status} after four attempts at ${url}` });
      return false;
    }
    const wait = retryDelay(response?.headers.get('retry-after'), attempt);
    console.log(`${pick.id}: ${response ? `HTTP ${response.status}` : 'network error'}; retry ${attempt + 2}/4 in ${wait / 1000} seconds`);
    await delay(wait);
  }
}
const recordSize = (id, file) => {
  const bytes = statSync(file).size;
  assert(bytes <= 120000, `${id}: JPEG is ${bytes} bytes (over 120 KB)`);
  if (bytes > report.largest.bytes) report.largest = { id, bytes };
};
for (const p of picks) {
  if (!['ok', 'replace'].includes(p.verdict)) { report.omitted.push({ id: p.id, reason: `verdict ${p.verdict}` }); continue; }
  const dest = join(out, `${p.id}.jpg`);
  if (existsSync(dest)) {
    const [w, h] = dimensions(dest);
    assert(w === 640 && h === 360, `${p.id}: existing output has incorrect dimensions`);
    recordSize(p.id, dest);
    report.retained.push(p.id);
    console.log(`${p.id}: retained existing 640 × 360 JPEG`);
    continue;
  }
  if (+p.orig_width < 640 || +p.orig_height < 360) {
    report.omitted.push({ id: p.id, reason: `original ${p.orig_width} × ${p.orig_height}; would need upscaling` });
    continue;
  }
  let source = local.get(p.file_title)?.path;
  if (source) report.reused++;
  else {
    source = join(scratch, `${p.id}-source`);
    if (!existsSync(source)) {
      if (!await download(p, source)) continue;
    }
  }
  const [width, height] = dimensions(source);
  if (width < 640 || height < 360) { report.omitted.push({ id: p.id, reason: `source ${width} × ${height}; would need upscaling` }); continue; }
  // Cover the frame without distortion; very wide pictures need height-based
  // resizing so sips crops rather than pads the image with a border.
  const resized = join(scratch, `${p.id}-resized.jpg`);
  const resize = width / height > 16 / 9 ? ['--resampleHeight', '360'] : ['--resampleWidth', '640'];
  execFileSync('sips', [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', '90', source, '--out', resized]);
  execFileSync('sips', ['--cropToHeightWidth', '360', '640', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', resized, '--out', dest]);
  let size = statSync(dest).size;
  if (size > 120000) {
    execFileSync('sips', ['--cropToHeightWidth', '360', '640', '-s', 'format', 'jpeg', '-s', 'formatOptions', '60', resized, '--out', dest]);
    size = statSync(dest).size;
  }
  if (size > 120000) throw new Error(`${p.id}: JPEG is ${size} bytes (over 120 KB)`);
  const [w, h] = dimensions(dest);
  if (w !== 640 || h !== 360) throw new Error(`${p.id}: incorrect output dimensions`);
  report.written.push(p.id);
  recordSize(p.id, dest);
  console.log(`${p.id}: ${width} × ${height} → 640 × 360, ${size} bytes`);
}
writeFileSync(join(scratch, 'photos-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));

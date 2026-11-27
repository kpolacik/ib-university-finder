import { closeSync, copyFileSync, lstatSync, mkdtempSync, openSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const markerPath = (dataDir) => join(dataDir, '.reword-pending');
const recovery = (marker) => `Recovery required: ${marker}. Restore the recorded originals before retrying (see MAINTENANCE.md).`;

export function checkPending(dataDir) {
  const marker = markerPath(dataDir);
  if (lstatSync(marker, { throwIfNoEntry: false })) throw new Error(recovery(marker));
}

export function replaceSheets(dataDir, outputs) {
  if (!outputs.length) return;
  const marker = markerPath(dataDir);
  const files = [];
  let ownsMarker = false;
  const clean = () => files.forEach(({ dir }) => rmSync(dir, { recursive: true, force: true }));
  try {
    for (const { path: target, text, next } of outputs) {
      const dir = mkdtempSync(join(dirname(target), '.reword-'));
      const file = { dir, target, original: join(dir, 'original'), replacement: join(dir, 'replacement') };
      files.push(file);
      const mode = statSync(target).mode & 0o777;
      writeFileSync(file.original, text, { mode });
      writeFileSync(file.replacement, next, { mode });
    }
    const fd = openSync(marker, 'wx');
    ownsMarker = true;
    try {
      writeFileSync(fd, JSON.stringify(files, null, 2) + '\n');
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    // If the marker could not be filled in, no targets were touched. Report
    // the complete file list anyway, and preserve its originals.
    if (ownsMarker) {
      throw new Error(`${e.message}\n${recovery(marker)}\n${JSON.stringify(files, null, 2)}`);
    }
    clean();
    if (e.code === 'EEXIST') checkPending(dataDir);
    throw e;
  }
  const replaced = [];
  let failure;
  try {
    for (const file of files) {
      renameSync(file.replacement, file.target);
      replaced.push(file);
    }
  } catch (e) {
    failure = e;
    const errors = [];
    for (const file of replaced.reverse()) {
      try {
        const restore = join(file.dir, 'restore');
        copyFileSync(file.original, restore);
        renameSync(restore, file.target);
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (errors.length) throw new Error(`${failure.message}\nRollback failed: ${errors.join('; ')}\n${recovery(marker)}\n${JSON.stringify(files, null, 2)}`);
  }
  try {
    unlinkSync(marker);
  } catch (e) {
    throw new Error(`${e.message}\n${recovery(marker)}\n${JSON.stringify(files, null, 2)}`);
  }
  clean();
  if (failure) throw new Error(`${failure.message}\nRolled back all replacements; original CSVs restored.`);
}

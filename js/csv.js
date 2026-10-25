// A small RFC 4180 CSV parser.
//
// We cannot use text.split(',') because fields like ib_hl_requirements are
// full of commas ("HL Maths AA 6, HL Physics 5"). Google Sheets quotes those
// fields properly on export, so we just have to honour the quoting rules.

export function parseCsv(text) {
  return parse(text).rows;
}

// The parser itself. Besides the rows it says whether the text ended inside a
// quoted field: a file cut off mid-download, or one stray quote mark, used to
// swallow every row after it into one cell without a word (L03). `open` is the
// row that quote is in and the line it starts on.
function parse(text) {
  // Strip a UTF-8 byte order mark if the file has one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let quoteLine = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';   // an escaped quote inside a quoted field
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;      // commas and newlines are literal in here
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      quoteLine = line;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      line++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  row.push(field);
  rows.push(row);

  // Drop blank lines, including the one a trailing newline leaves behind.
  return {
    rows: rows.filter((r) => !(r.length === 1 && r[0].trim() === '')),
    open: inQuotes ? { row, line: quoteLine } : null,
  };
}

// Turns CSV text into objects keyed by the header row.
// A row with the wrong number of columns is reported and skipped rather than
// silently mangled — one bad edit should not take down the whole page.
// `header` is returned too, so the loader can tell a header-only file, or one
// whose columns were renamed, from a good one.
export function csvToObjects(text, label) {
  const { rows: grid, open } = parse(text);
  const issues = [];

  if (grid.length === 0) {
    return { rows: [], header: [], issues: [`${label}: the file is empty.`] };
  }

  const header = grid[0].map((h) => h.trim());
  const rows = [];
  const cutOff = `${label}: the file ends inside a quoted field that starts on line ${open ? open.line : 0}; ` +
    'rows after it may be missing. Check for a stray quote mark, or a file that did not finish downloading.';

  // The row holding the unclosed quote has the rest of the file in one cell,
  // so it is never shown, even when its column count happens to fit.
  if (open && grid.length > 1 && grid[grid.length - 1] === open.row) {
    grid.pop();
    issues.push(`${cutOff} That row (row ${grid.length + 1}) is skipped.`);
  } else if (open) {
    issues.push(cutOff);
  }

  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.length !== header.length) {
      issues.push(
        `${label} row ${i + 1}: expected ${header.length} columns but found ` +
        `${cells.length}. Row skipped — check for a stray quote mark.`
      );
      continue;
    }
    const obj = { __row: i + 1 };
    header.forEach((key, j) => { obj[key] = cells[j].trim(); });
    rows.push(obj);
  }

  return { rows, header, issues };
}

// Shared pieces for the six Irish importers (UCD, UCC, Galway, DCU, UL, Maynooth).
//
// import-tcd.mjs came first and inlines its own copies of all of this. It is
// left alone on purpose: it is the record of how the Trinity rows were made.
// Everything written after it shares this file instead of copying it six times.

const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
};

// UCD and Maynooth answer 403 to a bare Node fetch, so every request carries a
// browser user-agent. One retry, because a single dropped connection in the
// middle of 200 course pages should not lose the run.
export async function getHtml(url, tries = 2) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.text();
    } catch (err) {
      if (i >= tries) throw new Error(`${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** The same request, kept as bytes — Maynooth publishes its fees as a PDF. */
export async function getBuffer(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Tags stripped, entities unwrapped, whitespace collapsed. Every one of these
// sites states its numbers in running text, so a text view is enough and no
// HTML parser is needed.
export const toText = (html) =>
  html
    .replace(/<script[^]*?<\/script>/gi, ' ')
    .replace(/<style[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'")
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// CAO's official IB conversion, from the 2026 EU/EFTA guidelines document —
// the same table import-tcd.mjs uses, so Irish rows stay comparable.
const TABLE = [[45, 600], [44, 600], [43, 594], [42, 577], [41, 565], [40, 553], [39, 541], [38, 520],
               [37, 508], [36, 497], [35, 481], [34, 466], [33, 453], [32, 442], [31, 430], [30, 412],
               [29, 400], [28, 389], [27, 379], [26, 368], [25, 359], [24, 350]];

/** Lowest IB total whose CAO equivalent still reaches `need` points, or null. */
export const lowestIB = (need) => {
  const ok = TABLE.filter(([, p]) => p >= need).map(([ib]) => ib);
  return ok.length ? Math.min(...ok) : null;
};

const SUBJ = [
  [/comput|software|information systems|informat|data science|artificial intelligence/i, 'Computer Science'],
  [/engineer/i, 'Engineering'],
  [/mathemat|actuarial|statistic/i, 'Mathematics'],
  [/physic|astro|nanotech/i, 'Physics'],
  [/chemi/i, 'Chemistry'],
  [/biolog|biochem|botany|zoolog|genetic|immunolog|microbiolog|neuroscience|physiolog|biomedical sci|biotechnolog|bioscience|marine science/i, 'Biology & Life Sciences'],
  [/environment|geoscience|geography|earth|geolog|climate|agricultur|food science|forestry|equine|horticultur/i, 'Environmental Sciences'],
  [/medicine|dental|pharmac|nursing|health|nutrition|radiation|radiograph|therap|speech|midwifer|veterinar|paramedic|optometr/i, 'Medicine & Health'],
  [/psycholog/i, 'Psychology'],
  [/econom/i, 'Economics'],
  [/business|management|commerce|marketing|accounting|finance|entrepreneur/i, 'Business & Management'],
  [/\blaw\b|legal|llb|criminolog|criminal justice/i, 'Law'],
  [/politic|international relations|european studies|global|public policy|public administration/i, 'Politics & International Relations'],
  [/sociolog|social (work|studies|policy|science)|anthropol|youth work|community/i, 'Sociology & Anthropology'],
  [/histor|ancient|classic|archaeolog|celtic|heritage/i, 'History'],
  [/philosoph/i, 'Philosophy'],
  [/language|linguist|english|french|german|spanish|italian|russian|polish|literature|translat|japanese|chinese/i, 'Languages & Literature'],
  [/film|media|journalis|communicat|digital humanities/i, 'Media & Communication'],
  [/\bart\b|art history|music|drama|theatre|design|visual|creative|performance/i, 'Art & Design'],
  [/architect|planning|surveying|construction/i, 'Architecture'],
  [/education|teaching|\bsed\b/i, 'Education'],
  [/sport|exercise/i, 'Sports Science'],
];

/** Up to three subject areas keyword-mapped from a course title. */
export const areasFor = (name) =>
  [...new Set(SUBJ.filter(([re]) => re.test(name)).map(([, a]) => a))].slice(0, 3).join('; ') || 'Liberal Arts';

/** Admission hurdles a points total cannot express, spotted from the title. */
export const otherFor = (name) =>
  /\bmedicine\b|dental science/i.test(name) ? 'HPAT admission test'
  : /veterinar/i.test(name) ? 'Restricted entry — additional assessment'
  : /music|drama|theatre|acting|art & design|fine art|performance/i.test(name) ? 'Audition or portfolio'
  : '';

/**
 * The ib_points_min plus deadline_notes pair for a course whose only published
 * number is last year's CAO cutoff.
 *
 * Ireland's cutoffs are demand-driven, so they are not minimums, and the note
 * says so every time rather than trusting the reader to remember.
 */
export function fromCutoff(cao, year, code, { needsMaths = false, codeLabel = 'CAO code' } = {}) {
  const base = `Last year's CAO cutoff was ${cao} points (${year})${code ? `; ${codeLabel} ${code}` : ''}. `
    + 'Cutoffs are set by demand each August and move year to year — this is not a guaranteed minimum.';

  let ib = lowestIB(cao);
  if (ib === null && needsMaths) {
    ib = lowestIB(cao - 25);
    if (ib !== null) {
      return { ib, note: `${base} Reachable only with the 25 bonus points for HL Maths at grade 4 or better.` };
    }
  }
  if (ib === null) {
    return {
      ib: null,
      note: `${base} ABOVE the 625 points an IB student can reach (45 plus the maths bonus) because the cutoff `
        + 'includes a separate assessment such as the HPAT test or an audition, so no IB equivalent can be given.',
    };
  }
  return {
    ib,
    note: base + (needsMaths ? ' A grade 4+ in HL Maths adds 25 bonus points, so one point lower may suffice.' : ''),
  };
}

const esc = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export const COLUMNS = [
  'programme_id', 'university_id', 'city', 'programme', 'degree_type', 'subject_area', 'language',
  'ib_points_min', 'ib_subjects', 'other_requirements', 'admission', 'tuition_eu', 'tuition_noneu',
  'english_requirement', 'application_deadline', 'deadline_notes', 'official_url',
  'last_verified', 'verified_by', 'application_system',
];

/** One programmes.csv line from a partial object, missing fields left blank. */
export const toRow = (fields) => COLUMNS.map((c) => esc(fields[c] ?? '')).join(',');

/** A stable, readable programme_id: prefix plus a slugged title, deduped. */
export function idMaker(prefix) {
  const seen = new Set();
  return (title) => {
    const stem = `${prefix}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 44);
    let id = stem;
    for (let n = 2; seen.has(id); n++) id = `${stem}-${n}`;
    seen.add(id);
    return id;
  };
}

/** Titles no Slovak IB applicant can realistically take, or that are not degrees. */
export const SKIP_TITLE =
  /gaeilge|irish (language|studies)|as gaeilge|léann|ph\.?d|masters?\b|m\.?sc\b|postgrad|diploma|certificate|foundation|micro-?credential|part[- ]time|access course|mature/i;

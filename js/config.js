// Where the site gets its data.
//
// Once the Google Sheet exists, publish BOTH tabs to the web as CSV
// (File > Share > Publish to web > pick the tab > Comma-separated values)
// and paste the two URLs here. Until then these stay empty and the site
// reads data/universities.csv and data/programmes.csv (below).

export const SHEET_CSV_URLS = {
  universities: '',
  programmes: '',
};

// Used while SHEET_CSV_URLS is still empty. These are the real researched rows.
// The invented rows used to build the filters live in data/sample-*.csv and are
// no longer loaded — point these two lines at them if you want them back.
export const SAMPLE_CSV_URLS = {
  universities: 'data/universities.csv',
  programmes: 'data/programmes.csv',
};

// Last resort if every fetch above fails: a snapshot committed to the repo.
// The site says loudly when it is showing this.
export const SNAPSHOT_URL = 'data/fallback.json';

// A row gets a "check this" badge when nobody has verified it for this long.
export const STALE_AFTER_DAYS = 183;

// A deadline this close gets highlighted as urgent.
export const URGENT_WITHIN_DAYS = 60;

// Jakub enables whole-university rankings when ready.
export const SHOW_RANKINGS = false;

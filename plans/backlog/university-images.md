# University photos (F09)

State: backlog (Leon, 2026-11-12: "images we add later"). Nothing on the site uses
these yet. The research is done and kept outside this repo.

## What exists

Everything is in `/Users/leon/projects/ib-research-media/` (not in git):

- `images-index.csv` is one row per university. It holds the picked Wikimedia Commons file, image URL
  (1600 px thumbnail), licence, licence URL, author, Commons page, how many other
  candidates there are, the university homepage's own `og:image`, and a `flag` for
  problems. `scope` says whether the university is on the site, proposed in
  `ib-research-expansion/proposals/`, or dropped/held back.
- `images/<id>.json` holds every Commons candidate (up to 25) with licence, author, size,
  description and a score, plus the Wikidata item it came from.
- `images-official/<id>.json` holds the homepage `og:image`. **Reuse rights unknown**: no
  licence is stated, so do not use these without the university's permission.
- `images-openverse/` contains 159 Openverse lookups, mostly failed (HTTP 504). Ignore them.
- `tools/collect_images.py` does the lookup. It skips ids that already have a file, and
  deleting a record with `"status": "error…"` makes it retry. `tools/retry_names.py`
  retries with a plainer name (`name_override`). `tools/image_index.py` rebuilds
  the index. Run them with `python3 -I`. Wikimedia answers 429 when hit fast, so
  keep the pauses.

## Coverage (2026-11-12)

284 records, and 248 have a picked image.

| Group | Records | With image |
|---|---|---|
| On the site today | 158 of 159 (Utrecht has no record) | 146 |
| Proposed new universities | 123 | 101 |
| Dropped or held back (FH Salzburg, FH Wien WKW, SETU) | 3 | 1 |

There is no usable image for:

- **On site:** Bocconi, CEU, Dalarna, JKU, KIT, LMU, LUT, NMBU, TUHH, TUM, UCL,
  Milan (unimi). Most are famous, so this is the matcher failing (only logos, or no free
  licence in the category), not a lack of photos.
- **Proposed:** Amsterdam UAS, Centria, DHBW, EUBA, HAMK, Hanze, htw saar, Humak,
  HWG Wien, IMC Krems, Kajaani, KLU, Landshut, Novia, Oamk, Savonia, TAMK,
  TH Nürnberg, Trier, UCN, UTN, Worms. Hanze and TAMK failed on rate limits
  (429) in the retry, so try them again first.

The licences of the picked files are CC BY-SA 182, CC BY 33, public domain 21, CC0 11
and GFDL 1.

## Before using them

1. **A person picks every image.** The pick is an automatic score. Known bad
   picks: SAMK shows Pori railway station, and Aalto's fourth candidate is a
   1972 archive photo. Look at each one and choose from the other candidates where
   needed.
2. **Attribution.** CC BY and CC BY-SA need the author, the licence (with link) and
   the source shown next to the photo or on a credits page. BY-SA also means a
   cropped or edited version must stay BY-SA. GFDL is awkward to credit properly,
   so swap that one.
3. **Hosting.** Linking Commons directly sends every visitor's IP to Wikimedia
   and depends on their URLs. Copying the files into the repo means a resize
   (around 640 px wide) to keep the page light. The no-build, no-dependency rule
   applies: a resize with macOS `sips` or a one-off script, not an npm tool.
4. **Design.** The current look is one summary row per programme, with colour
   only for verdicts (STATUS.md "The look of it"). Photos change that, so where
   they appear (the card, a detail view only, or a university header) is a design
   decision for Leon and Jakub.
5. **Data.** The photo needs a home. Either add a university column (for example `image_url`,
   `image_credit`, `image_licence`) to the Supabase schema and the export, or keep a
   separate small file. Decide after the Supabase switch-over (STATUS.md:40).

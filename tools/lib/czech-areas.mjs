// areasFor (tools/lib/ireland.mjs) reads English course titles. Czech titles
// need their own stems — "informatika", "lékařství", "dějiny" — so this is the
// same idea in Czech, mapped onto the same subject vocabulary so Czech rows
// filter alongside Dutch and Irish ones.

import { areasFor } from './ireland.mjs';

export const CZ = Object.freeze([
  [/informati|informační|programov|počítač|kyber|softwar|umělá inteligence|datov|data analytics|data science/i, 'Computer Science'],
  [/inženýr|strojn|elektrotech|elektron|telekomunik|strojír|automatiz|polovodič|čip|stavebn|stavitel|technick|mechatron|robot|energet|kybernetik|mobilit|vozid|letad|pilot|dopravní/i, 'Engineering'],
  [/matemat|statisti|pojistn|algebr/i, 'Mathematics'],
  [/fyzik|astro|jadern|kvant/i, 'Physics'],
  [/chemi|biochem|toxikolog/i, 'Chemistry'],
  [/biolog|genet|mikrobio|ekolog|botanik|zoolog|bioinformat/i, 'Biology & Life Sciences'],
  // The forestry stem must start a word: tělesná means physical, not forestry.
  [/geograf|geolog|geotechnolog|životní\S* prostředí|přírodními zdroji|vědy o zemi|environment|zeměd|(?<!\p{L})lesn|meteorolog|kartograf/iu, 'Environmental Sciences'],
  [/lékař|léčiv|dentist|medic|zubní|stomatolog|farmac|ošetřov|porodní|fyzioterap|ergoterap|adiktolog|hygien|zdravot|nutri|radiolog|optometr|optik|záchran|laborator|ortopti/i, 'Medicine & Health'],
  [/psycholog/i, 'Psychology'],
  [/ekonom|financ|bankovnictv|pojišťovnictv|zdanění|daňov|hospodářstv/i, 'Economics'],
  [/management|marketing|obchod|podnik|účet|manažer/i, 'Business & Management'],
  [/právo|právní|práv/i, 'Law'],
  [/politolog|politi|diplomac|diplomat|mezinárodní vztahy|evropsk|veřejná správa|bezpečnost|teritoriální|areálov/i, 'Politics & International Relations'],
  [/sociolog|antropolog|sociální|etnolog|demograf|sociáln/i, 'Sociology & Anthropology'],
  [/histor|archeolog|archiv|dějiny|dějin|starověk|klasick|řeck|latin/i, 'History'],
  [/filozof|filosof|estetik|religio|teolog|theolog|logika/i, 'Philosophy'],
  [/jazyk|fonetik|filolog|literatur|lingvist|bohemist|anglist|germanist|romanist|slavist|sinolog|japanolog|koreanist|tibetanist|indolog|arabist|hebraist|asijsk|blízkovýchod|orientál|překlad|tlumoč|nordist|balkanist|italianist|hispanist|francouz|německ|rusk|polsk|maďar/i, 'Languages & Literature'],
  [/žurnal|médi|komunikační studia|film|mediáln|televiz/i, 'Media & Communication'],
  [/umění|umělec|hudeb|hudb|výtvarn|design|vizuáln|divadl|scénick|tanec|kultur/i, 'Art & Design'],
  [/architekt|urbanis/i, 'Architecture'],
  [/vzdělávání|pedagog|učitel|vychovatel|andragog/i, 'Education'],
  [/sport|coach|fitness|tělesn|trenér|kinantrop|tělovýchov|regenerac/i, 'Sports Science'],
]);

/** Up to three subject areas from a Czech title; an English title falls through to areasFor. */
export function areasForCz(title) {
  const cz = [...new Set(CZ.filter(([re]) => re.test(title)).map(([, a]) => a))].slice(0, 3);
  return cz.length ? cz.join('; ') : areasFor(title);
}

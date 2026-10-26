/**
 * Bill-of-quantities text, normalised so that the same work written by different estimators
 * lands on the same signature, and different work does not.
 *
 * "Stb.-Wand C30/37, d=24cm, herst." and "Stahlbetonwand aus Beton C30/37, Dicke 240 mm,
 * herstellen" describe the same priced work. Two things make that work: words are reduced to
 * the ones that change the price (filler like "liefern und einbauen" is dropped and
 * abbreviations are expanded), and the numbers that change the price (thickness, strength
 * class, format, nominal diameter) are lifted out as attributes that must agree exactly. A 17.5
 * cm wall and a 24 cm wall are similar texts and different prices.
 */

export type Attributes = Record<string, string>;

export interface NormalisedText {
  /** Content words, deduplicated and sorted: word order never changes a price. */
  words: string[];
  attributes: Attributes;
  /** words + attributes as one stable key; equal keys are the same priced work. */
  key: string;
}

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bstb\.?\s*-?\s*/g, "stahlbeton "],
  [/\bstahlbetonwand\b/g, "stahlbeton wand"],
  [/\bstahlbetondecke\b/g, "stahlbeton decke"],
  [/\bstahlbetonstuetze\b/g, "stahlbeton stuetze"],
  [/\bks\b\.?/g, "kalksandstein"],
  [/\bkalksandsteinmauerwerk\b/g, "kalksandstein mauerwerk"],
  [/\bmw\b\.?/g, "mauerwerk"],
  [/\bgk\b\.?/g, "gipskarton"],
  [/\bgipskartonwand\b/g, "gipskarton wand"],
  [/\btrockenbauwand\b/g, "trockenbau wand"],
  [/\bbew\b\.?/g, "bewehrung"],
  [/\bbetonstahlmatten?\b/g, "betonstahl matte"],
  [/\bbodenfliesen?\b/g, "boden fliese"],
  [/\bwandfliesen?\b/g, "wand fliese"],
  [/\bfliesenbelag\b/g, "fliese belag"],
  [/\bzementestrich\b/g, "zement estrich"],
  [/\bdispersionsfarbe\b/g, "dispersion farbe"],
  [/\bdispersionsanstrich\b/g, "dispersion anstrich"],
  [/\binnenputz\b/g, "innen putz"],
  [/\baussenputz\b/g, "aussen putz"],
  [/\bbodenaushub\b/g, "boden aushub"],
  [/\bbaugrubenaushub\b/g, "baugrube aushub"],
  // Standard abbreviations in German bills of quantities.
  [/\bhlz\b\.?/g, "hochlochziegel"],
  [/\bze\b\.?/g, "zement estrich"],
  [/\bwt\b\.?/g, "waschtisch"],
  [/\buv\b\.?/g, "unterverteilung"],
  [/\bcu\b\.?/g, "kupfer"],
  [/\bkpl\b\.?/g, "komplett"],
  [/\baiv\b\.?/g, "abdichtung verbund"],
  [/\bunterdecken?\b/g, "abgehaengt decke"],
  [/\binkl\.?/g, "inklusive"],
  [/\bzzgl\.?/g, "zuzueglich"],
  [/\bca\.?/g, ""],
];

/** Words that never change what a position costs. */
const FILLER = new Set([
  "und",
  "unter",
  "auf",
  "im",
  "u",
  "oder",
  "mit",
  "ohne",
  "fuer",
  "aus",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einer",
  "eines",
  "in",
  "im",
  "am",
  "an",
  "auf",
  "zum",
  "zur",
  "nach",
  "von",
  "vom",
  "als",
  "bei",
  "bis",
  "je",
  "pro",
  "gem",
  "gemaess",
  "lt",
  "laut",
  "sowie",
  "alle",
  "allen",
  "aller",
  "erforderlichen",
  "liefern",
  "lief",
  "einbauen",
  "einb",
  "herstellen",
  "herst",
  "ausfuehren",
  "ausf",
  "einschl",
  "inklusive",
  "nebenarbeiten",
  "fachgerecht",
  "vollstaendig",
  "betriebsfertig",
  "beschreibung",
  "nach",
  "angabe",
  "planer",
  "bauleitung",
  "vorgaben",
  "position",
  "pos",
  "wie",
  "vor",
  "beschrieben",
  "stueck",
  "art",
  "typ",
  "dicke",
  "staerke",
  "nennweite",
  "mm",
  "cm",
  "m",
  "d",
  "dn",
  "x",
  "format",
]);

/**
 * Heads of German compounds that name the work: "Montagewand" is a kind of "Wand",
 * "Geschossdecke" a kind of "Decke". Splitting them lets differently compounded wordings meet.
 */
const HEADS = [
  "tragschicht",
  "wand",
  "decke",
  "putz",
  "estrich",
  "fliesen",
  "fliese",
  "rohr",
  "leitung",
  "stuetze",
  "platte",
  "platten",
  "anstrich",
  "farbe",
  "tapete",
  "abdichtung",
  "schalung",
  "bewehrung",
  "aushub",
  "steckdose",
  "sturz",
  "mauerwerk",
  "verteilung",
  "belag",
  "schicht",
];

/** Words estimators use interchangeably. */
const SYNONYMS: Record<string, string> = {
  gipsplatte: "gipskarton",
  gipsplatten: "gipskarton",
  gipskartonplatte: "gipskarton",
  gipskartonplatten: "gipskarton",
  gkb: "gipskarton",
  gipsbauplatten: "gipskarton",
  montage: "trockenbau",
  staender: "trockenbau",
  metallstaender: "trockenbau",
  abhang: "abgehaengt",
  abgehaengte: "abgehaengt",
  waende: "wand",
  fluessigfolie: "abdichtung verbund",
  verbundabdichtung: "abdichtung verbund",
  mischbatterie: "armatur",
  einhandmischer: "armatur",
  einhebelmischer: "armatur",
  kalksandsteinen: "kalksandstein",
  kalksandsteine: "kalksandstein",
  planziegeln: "planziegel",
  ziegeln: "ziegel",
  hochlochziegel: "ziegel",
  kupferrohr: "kupfer rohr",
  kg: "pvc",
  stabstahl: "betonstahl",
  baustahl: "betonstahl",
  mantelleitung: "kabel",
  installations: "kabel",
  zementestrich: "zement estrich",
  fertigsturz: "sturz",
  flachsturz: "sturz",
  schuko: "schutzkontakt",
  raufasertapete: "raufaser tapete",
  grundleitung: "abwasser rohr",
  grundleitungen: "abwasser rohr",
};

/**
 * Light stemming: plural and infinitive endings, and past participles, so that "verlegen",
 * "verlegt" and "verlegte" meet ("verdichten", "verdichtet" likewise).
 */
function stem(w: string): string {
  if (w.length < 5) return w;
  for (const suffix of ["en", "et", "e"])
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) return w.slice(0, -suffix.length);
  if (w.length >= 6 && /[glkrh]t$/.test(w)) return w.slice(0, -1);
  return w;
}

/** A synonym also applies to longer forms of its word ("metallstaenderwerk"), if the word is long. */
function synonym(w: string): string {
  const exact = SYNONYMS[w];
  if (exact) return exact;
  if (w.length >= 10)
    for (const [k, v] of Object.entries(SYNONYMS))
      if (k.length >= 8 && w.startsWith(k)) return w.length - k.length >= 3 ? `${v} ${w.slice(k.length)}` : v;
  return w;
}

function splitCompound(w: string): string[] {
  for (const head of HEADS) {
    if (w.length > head.length + 2 && w.endsWith(head)) return [w.slice(0, -head.length), head];
  }
  return [w];
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[²]/g, "2")
    .replace(/[³]/g, "3");
}

function num(raw: string): number {
  return Number(raw.replace(",", "."));
}

function extract(text: string): { rest: string; attributes: Attributes } {
  const attributes: Attributes = {};
  let rest = text;
  const take = (re: RegExp, f: (m: RegExpMatchArray) => [string, string] | null) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      const kv = f(m);
      if (kv) attributes[kv[0]] = kv[1];
      return " ";
    });
  };
  // Concrete strength class: C25/30, C 30/37
  take(/\bc\s?(\d{2})\s?\/\s?(\d{2})\b/g, (m) => ["concrete", `c${m[1]}/${m[2]}`]);
  // Nominal diameter: DN 100
  take(/\bdn\s?(\d{2,4})\b/g, (m) => ["dn", String(Number(m[1]))]);
  // Cable cross-section: NYM-J 3x1,5 (mm²)
  // (a decimal second number is a cross-section even without the unit: tile formats are whole cm)
  take(/\b(\d{1,2})\s?x\s?(\d{1,3}(?:[.,]\d)?)\s?(?:mm2|qmm)\b|\b(\d{1,2})\s?x\s?(\d{1,2}[.,]\d)\b/g, (m) => [
    "section",
    `${m[1] ?? m[3]}x${num((m[2] ?? m[4])!)}`,
  ]);
  // Thickness: d=24 cm, d = 240 mm, Dicke 17,5 cm, 24 cm dick, st. 11,5 cm
  take(
    /\b(?:d|[a-z]*dicke|[a-z]*staerke|st\.?)\s?[=:]?\s?(\d{1,3}(?:[.,]\d{1,2})?)\s?(mm|cm)\b|\b(\d{1,3}(?:[.,]\d{1,2})?)\s?(mm|cm)\s+(?:dick|stark)\b/g,
    (m) => {
      const value = num((m[1] ?? m[3])!);
      const unit = (m[2] ?? m[4])!;
      const mm = unit === "cm" ? value * 10 : value;
      return ["thickness_mm", String(Math.round(mm * 10) / 10)];
    },
  );
  // Format: 30x60 cm, 60 x 60, 20/40 cm (tiles, slabs)
  take(/\b(\d{1,3})\s?[x/]\s?(\d{1,3})\s?(cm)?\b/g, (m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return ["format_cm", `${Math.min(a, b)}x${Math.max(a, b)}`];
  });
  // Lengths of pieces: Länge 1,25 m, l = 2,0 m
  take(/(?:\b(?:laenge|l)\s?[=:]?\s?|\s)(\d{1,2}(?:[.,]\d{1,2})?)\s?m\b(?!\d)/g, (m) => [
    "length_cm",
    String(Math.round(num(m[1]!) * 100)),
  ]);
  // Drywall systems (W111, W112, W115), slip resistance (R9..R13), soil classes (Bodenklasse 3-5)
  take(/\bw\s?(11\d|62\d)\b/g, (m) => ["system", `w${m[1]}`]);
  take(/\br\s?(9|1[0-3])\b/g, (m) => ["slip", `r${m[1]}`]);
  // Soil classes (DIN 18300 before 2015): "Bodenklasse 3-5", "Bodenkl. 3 bis 5", "BK 3-5", "BKL 6-7"
  const soil = "\\b(?:bodenklassen?|bodenkl\\.?|bkl?)\\s?";
  take(new RegExp(`${soil}(\\d)\\s?(?:-|bis)\\s?(\\d)\\b`, "g"), (m) => ["soil", `${m[1]}-${m[2]}`]);
  take(new RegExp(`${soil}(\\d)\\b`, "g"), (m) => ["soil", `${m[1]}`]);
  // A bare "17,5 cm" left over (not a format, not a length in m) is a thickness when it is plausible.
  if (!attributes["thickness_mm"])
    take(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s?cm\b/g, (m) => {
      const mm = num(m[1]!) * 10;
      return mm >= 20 && mm <= 500 ? ["thickness_mm", String(Math.round(mm * 10) / 10)] : null;
    });
  return { rest, attributes };
}

export function normalise(text: string): NormalisedText {
  let s = fold(text);
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  const { rest, attributes } = extract(s);
  const words = [
    ...new Set(
      rest
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .flatMap((w) => synonym(w).split(" "))
        .flatMap(splitCompound)
        .flatMap((w) => synonym(w).split(" "))
        .filter((w) => w.length > 1 && !FILLER.has(w) && !/^\d+$/.test(w))
        .map(stem),
    ),
  ].sort();
  const attrs = Object.keys(attributes)
    .sort()
    .map((k) => `${k}=${attributes[k]}`);
  return { words, attributes, key: [...words, ...attrs].join(" ") };
}

/**
 * How well a candidate's attributes fit the query's: 0 when any shared attribute disagrees (a
 * different product), otherwise a weight that is lower when one side is less specific.
 */
export function attributeFit(query: Attributes, candidate: Attributes): number {
  let fit = 1;
  for (const [k, v] of Object.entries(query)) {
    const c = candidate[k];
    if (c === undefined) fit *= 0.5;
    else if (c !== v) return 0;
  }
  for (const k of Object.keys(candidate)) if (!(k in query)) fit *= 0.7;
  return fit;
}

/** Trigram similarity of two word lists, the same measure pg_trgm uses (for tests and offline use). */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Set<string>();
    for (const w of s.split(/\s+/).filter(Boolean)) {
      const p = `  ${w} `;
      for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  const union = ga.size + gb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * How well a candidate's words explain a query's words, weighted by how informative each word
 * is (inverse document frequency over the price history). Words match exactly or, to survive
 * typos, within one edit (two for long words: a swapped pair of letters counts as one edit). A candidate whose every word appears in the query
 * scores high even when the query says more ("..., einschl. Schalung"), which pure trigram
 * similarity punishes; the query's unexplained words still lower the score.
 */
export function wordScore(
  query: readonly string[],
  candidate: readonly string[],
  idf: (w: string) => number,
): number {
  if (query.length === 0 || candidate.length === 0) return 0;
  const matches = (w: string, pool: readonly string[]) => pool.some((p) => sameWord(p, w));
  const sum = (ws: readonly string[]) => ws.reduce((s, w) => s + idf(w), 0);
  const candCovered = sum(candidate.filter((w) => matches(w, query))) / sum(candidate);
  const queryCovered = sum(query.filter((w) => matches(w, candidate))) / sum(query);
  return 0.6 * candCovered + 0.4 * queryCovered;
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions), capped. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  // A word and its longer form or compound: "grundier" / "grundierung",
  // "spuelkast" / "unterputzspuelkast".
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 6 && (long.startsWith(short) || long.endsWith(short))) return true;
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  return editDistance(a, b, 2) <= (n >= 9 ? 2 : 1);
}

/**
 * A position is identified by its short text (Kurztext); the long text (Langtext) is mostly
 * boilerplate ("Ausführung nach DIN ...") that would drown the words that matter, so it only
 * contributes attributes the short text does not state.
 */
export function normalisePosition(shortText: string, longText = ""): NormalisedText {
  const s = normalise(shortText);
  if (!longText.trim()) return s;
  const l = normalise(longText);
  const attributes = { ...l.attributes, ...s.attributes };
  const attrs = Object.keys(attributes)
    .sort()
    .map((k) => `${k}=${attributes[k]}`);
  return { words: s.words, attributes, key: [...s.words, ...attrs].join(" ") };
}

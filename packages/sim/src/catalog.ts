/**
 * The simulated construction market: kinds of work, what drives their price, and how
 * estimators write them down.
 *
 * Every family has a national base price (2021 = index 100, € per unit as written) and
 * attributes whose values move the price. Phrasings are kept apart on purpose: `history` is how
 * the past tenders in the price database were written; `dev` is other wording, used while
 * developing the matcher; and blind/phrasings.json was written by someone who saw neither this
 * file's history wordings nor the matcher, and is used only to evaluate it.
 */
export type Rng = () => number;

export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

export interface AttrSpec {
  key: string;
  values: readonly (string | number)[];
  factor: (v: string | number) => number;
}

export interface Family {
  id: string;
  trade: Trade;
  /** Unit as estimators write it (variants are drawn per tender). */
  units: readonly string[];
  /** € per written unit, national average, index 2021 = 100. */
  base: number;
  attrs: readonly AttrSpec[];
  history: (a: Record<string, string | number>, r: Rng) => string;
  /** Wording used to develop and tune matching (never stored in the price history). */
  dev: (a: Record<string, string | number>, r: Rng) => string;
}

export type Trade =
  | "earthworks"
  | "concrete"
  | "masonry"
  | "drywall"
  | "screed_plaster"
  | "tiling"
  | "painting"
  | "electrical"
  | "plumbing";

export const TRADES: Record<Trade, string> = {
  earthworks: "Erdarbeiten",
  concrete: "Beton- und Stahlbetonarbeiten",
  masonry: "Mauerarbeiten",
  drywall: "Trockenbauarbeiten",
  screed_plaster: "Putz- und Estricharbeiten",
  tiling: "Fliesen- und Plattenarbeiten",
  painting: "Maler- und Lackierarbeiten",
  electrical: "Elektroinstallation",
  plumbing: "Sanitärinstallation",
};

const cm = (mm: string | number) => String(Number(mm) / 10).replace(".", ",");
const linear = (ref: number, slope: number) => (v: string | number) => 1 + ((Number(v) - ref) / ref) * slope;
const table = (t: Record<string, number>) => (v: string | number) => t[String(v)] ?? 1;

const FILLER = [
  "",
  " liefern und einbauen",
  ", herstellen",
  " inkl. Nebenarbeiten",
  ", fachgerecht ausführen",
  " gem. Statik",
  " im EG",
  " im OG",
  ", Bauteil A",
];
const tail = (r: Rng) => pick(r, FILLER);

export const FAMILIES: readonly Family[] = [
  // Earthworks
  {
    id: "excavation",
    trade: "earthworks",
    units: ["m3", "m³", "cbm"],
    base: 14,
    attrs: [{ key: "soil", values: ["3-5", "6-7"], factor: table({ "3-5": 1, "6-7": 2.4 }) }],
    history: (a, r) =>
      pick(r, [
        `Bodenaushub Bodenklasse ${a.soil}${tail(r)}`,
        `Baugrubenaushub BK ${a.soil}, laden und abfahren`.replace(/BK (\S+)/, "Bodenklasse $1"),
        `Boden lösen Bodenklasse ${a.soil}, laden${tail(r)}`,
      ]),
    dev: (a) =>
      `Aushub der Baugrube, Bodenklassen ${String(a.soil).replace("-", " bis ")}, inkl. Abtransport`,
  },
  {
    id: "backfill",
    trade: "earthworks",
    units: ["m3", "m³"],
    base: 22,
    attrs: [],
    history: (_a, r) =>
      pick(r, [
        `Arbeitsraum verfüllen, verdichten${tail(r)}`,
        `Verfüllung Arbeitsraum mit Kiessand, lagenweise verdichten`,
      ]),
    dev: () => `Hinterfüllung des Arbeitsraums mit Kiessand, lagenweise verdichtet`,
  },
  {
    id: "gravel_base",
    trade: "earthworks",
    units: ["m2", "m²"],
    base: 9.5,
    attrs: [{ key: "d", values: [150, 200, 300], factor: linear(200, 0.8) }],
    history: (a, r) =>
      pick(r, [
        `Schottertragschicht d=${cm(a.d)} cm${tail(r)}`,
        `Frostschutzschicht Schotter, Dicke ${a.d} mm`,
      ]),
    dev: (a) => `Tragschicht aus Schotter ${cm(a.d)} cm dick einbauen und verdichten`,
  },
  // Concrete
  {
    id: "rc_wall",
    trade: "concrete",
    units: ["m2", "m²", "qm"],
    base: 128,
    attrs: [
      { key: "d", values: [180, 200, 240, 300], factor: linear(200, 0.55) },
      {
        key: "c",
        values: ["C25/30", "C30/37", "C35/45"],
        factor: table({ "C25/30": 0.95, "C30/37": 1, "C35/45": 1.08 }),
      },
    ],
    history: (a, r) =>
      pick(r, [
        `Stb.-Wand ${a.c}, d=${cm(a.d)}cm${tail(r)}`,
        `Stahlbetonwand ${a.c}, d = ${a.d} mm${tail(r)}`,
        `Stahlbetonwand aus Beton ${a.c}, Dicke ${cm(a.d)} cm, herstellen`,
      ]),
    dev: (a) => `Wand aus Stahlbeton, Festigkeitsklasse ${a.c}, ${cm(a.d)} cm dick, einschl. Schalung`,
  },
  {
    id: "rc_slab",
    trade: "concrete",
    units: ["m2", "m²"],
    base: 112,
    attrs: [
      { key: "d", values: [180, 200, 220, 250], factor: linear(200, 0.5) },
      { key: "c", values: ["C25/30", "C30/37"], factor: table({ "C25/30": 0.96, "C30/37": 1 }) },
    ],
    history: (a, r) =>
      pick(r, [
        `Stb.-Decke ${a.c}, d=${cm(a.d)} cm${tail(r)}`,
        `Stahlbetondecke ${a.c} d=${a.d} mm${tail(r)}`,
      ]),
    dev: (a) => `Geschossdecke aus Stahlbeton ${a.c}, Plattendicke ${cm(a.d)} cm dick`,
  },
  {
    id: "rc_column",
    trade: "concrete",
    units: ["m3", "m³"],
    base: 690,
    attrs: [{ key: "c", values: ["C30/37", "C35/45"], factor: table({ "C30/37": 1, "C35/45": 1.07 }) }],
    history: (a, r) => pick(r, [`Stb.-Stütze ${a.c}${tail(r)}`, `Stahlbetonstütze Beton ${a.c}, rechteckig`]),
    dev: (a) => `Rechteckstütze aus Stahlbeton ${a.c}, inkl. Schalung`,
  },
  {
    id: "foundation_slab",
    trade: "concrete",
    units: ["m3", "m³"],
    base: 245,
    attrs: [{ key: "c", values: ["C25/30", "C30/37"], factor: table({ "C25/30": 0.96, "C30/37": 1 }) }],
    history: (a, r) =>
      pick(r, [`Bodenplatte Stahlbeton ${a.c}${tail(r)}`, `Stb.-Bodenplatte ${a.c}, WU-Beton`]),
    dev: (a) => `Fundamentplatte aus WU-Stahlbeton ${a.c}`,
  },
  {
    id: "rebar",
    trade: "concrete",
    units: ["t", "to"],
    base: 1480,
    attrs: [],
    history: (_a, r) =>
      pick(r, [
        `Betonstahl B500B liefern, schneiden, biegen, verlegen`,
        `Bewehrung Betonstahl B500B${tail(r)}`,
        `Bew. B500B Stabstahl`,
      ]),
    dev: () => `Stabstahlbewehrung BSt 500 B, geschnitten und gebogen, eingebaut`,
  },
  {
    id: "rebar_mesh",
    trade: "concrete",
    units: ["t", "to"],
    base: 1390,
    attrs: [],
    history: (_a, r) =>
      pick(r, [`Betonstahlmatten B500A verlegen${tail(r)}`, `Bewehrung Betonstahlmatten B500A`]),
    dev: () => `Mattenbewehrung B500A, Lagermatten, verlegt`,
  },
  {
    id: "formwork_wall",
    trade: "concrete",
    units: ["m2", "m²"],
    base: 42,
    attrs: [],
    history: (_a, r) => pick(r, [`Schalung Wand, glatt${tail(r)}`, `Wandschalung herstellen und beseitigen`]),
    dev: () => `Systemschalung für Wände, glatt, vorhalten und entfernen`,
  },
  // Masonry
  {
    id: "ks_wall",
    trade: "masonry",
    units: ["m2", "m²"],
    base: 68,
    attrs: [{ key: "d", values: [115, 175, 240], factor: linear(175, 0.6) }],
    history: (a, r) =>
      pick(r, [
        `KS-Mauerwerk d=${cm(a.d)} cm${tail(r)}`,
        `Kalksandsteinmauerwerk, d=${cm(a.d)} cm`,
        `KS Mauerwerk ${a.d} mm${tail(r)}`.replace(/(\d+) mm/, "d=$1 mm"),
      ]),
    dev: (a) =>
      `Mauerwerk aus Kalksandsteinen KS 20-2,0, Wanddicke ${cm(a.d)} cm`.replace("Wanddicke", "Dicke"),
  },
  {
    id: "brick_wall",
    trade: "masonry",
    units: ["m2", "m²"],
    base: 74,
    attrs: [{ key: "d", values: [240, 300, 365], factor: linear(300, 0.6) }],
    history: (a, r) =>
      pick(r, [
        `Ziegelmauerwerk Planziegel d=${cm(a.d)} cm${tail(r)}`,
        `Mauerwerk Hochlochziegel d=${a.d} mm`,
      ]),
    dev: (a) => `Außenwand aus Planziegeln, Dicke ${cm(a.d)} cm, gedämmt`,
  },
  {
    id: "lintel",
    trade: "masonry",
    units: ["St", "Stk", "Stück"],
    base: 58,
    attrs: [{ key: "len", values: [1.25, 1.5, 2.0], factor: linear(1.5, 0.9) }],
    history: (a, r) =>
      pick(r, [
        `Flachsturz Länge ${String(a.len).replace(".", ",")} m${tail(r)}`,
        `KS-Flachsturz ${String(a.len).replace(".", ",")} m einbauen`,
      ]),
    dev: (a) => `Fertigsturz für Öffnungen, Länge ${String(a.len).replace(".", ",")} m`,
  },
  // Drywall
  {
    id: "drywall_partition",
    trade: "drywall",
    units: ["m2", "m²", "qm"],
    base: 54,
    attrs: [
      { key: "sys", values: ["W111", "W112", "W115"], factor: table({ W111: 0.85, W112: 1, W115: 1.35 }) },
    ],
    history: (a, r) =>
      pick(r, [
        `GK-Wand ${a.sys}, Metallständer${tail(r)}`,
        `Trockenbauwand ${a.sys} herstellen`,
        `Gipskartonwand System ${a.sys}${tail(r)}`,
      ]),
    dev: (a) => `Montagewand aus Gipsplatten, Knauf ${a.sys}, Ständerwerk aus Metall`,
  },
  {
    id: "suspended_ceiling",
    trade: "drywall",
    units: ["m2", "m²"],
    base: 48,
    attrs: [],
    history: (_a, r) => pick(r, [`Abgehängte Decke GK${tail(r)}`, `Unterdecke Gipskarton, abgehängt`]),
    dev: () => `Abhangdecke aus Gipsplatten auf Metallunterkonstruktion`,
  },
  {
    id: "drywall_lining",
    trade: "drywall",
    units: ["m2", "m²"],
    base: 32,
    attrs: [],
    history: (_a, r) => pick(r, [`Vorsatzschale GK${tail(r)}`, `Wandbekleidung Gipskarton auf UK`]),
    dev: () => `Vorsatzschale mit Gipsplatten, freistehend`,
  },
  // Screed and plaster
  {
    id: "screed",
    trade: "screed_plaster",
    units: ["m2", "m²"],
    base: 24,
    attrs: [{ key: "d", values: [45, 50, 65, 80], factor: linear(50, 0.5) }],
    history: (a, r) =>
      pick(r, [
        `Zementestrich CT-C25-F4, d=${cm(a.d)} cm${tail(r)}`,
        `Zementestrich ${cm(a.d)} cm dick${tail(r)}`,
        `Estrich CT d=${a.d} mm schwimmend`,
      ]),
    dev: (a) => `Schwimmender Estrich aus Zement, Nenndicke ${cm(a.d)} cm dick`,
  },
  {
    id: "interior_plaster",
    trade: "screed_plaster",
    units: ["m2", "m²", "qm"],
    base: 19,
    attrs: [
      { key: "layers", values: ["einlagig", "zweilagig"], factor: table({ einlagig: 1, zweilagig: 1.45 }) },
    ],
    history: (a, r) =>
      pick(r, [
        `Innenputz Kalkgips ${a.layers}${tail(r)}`,
        `Kalkgipsputz innen, ${a.layers}`,
        `Innenputz ${a.layers} Q2`,
      ]),
    dev: (a) => `Wandputz innen aus Kalk-Gips, ${a.layers}, Qualitätsstufe Q2`,
  },
  {
    id: "exterior_plaster",
    trade: "screed_plaster",
    units: ["m2", "m²"],
    base: 38,
    attrs: [],
    history: (_a, r) => pick(r, [`Außenputz mineralisch${tail(r)}`, `Aussenputz Kalkzement, gerieben`]),
    dev: () => `Fassadenputz mineralisch, Kalkzement, geriebene Struktur`,
  },
  // Tiling
  {
    id: "floor_tiles",
    trade: "tiling",
    units: ["m2", "m²"],
    base: 72,
    attrs: [
      {
        key: "fmt",
        values: ["30x30", "30x60", "60x60"],
        factor: table({ "30x30": 0.9, "30x60": 1, "60x60": 1.18 }),
      },
      { key: "slip", values: ["R9", "R10", "R11"], factor: table({ R9: 0.96, R10: 1, R11: 1.06 }) },
    ],
    history: (a, r) =>
      pick(r, [
        `Bodenfliesen ${a.fmt} cm, ${a.slip}${tail(r)}`,
        `Bodenfliesen Feinsteinzeug ${a.fmt}, ${a.slip}, verlegen`,
        `Fliesenbelag Boden ${a.fmt} cm ${a.slip}`,
      ]),
    dev: (a) =>
      `Feinsteinzeug-Fliesen als Bodenbelag, Format ${String(a.fmt).split("x").reverse().join(" x ")} cm, Rutschhemmung ${a.slip}`,
  },
  {
    id: "wall_tiles",
    trade: "tiling",
    units: ["m2", "m²"],
    base: 66,
    attrs: [{ key: "fmt", values: ["20x40", "30x60"], factor: table({ "20x40": 0.95, "30x60": 1.05 }) }],
    history: (a, r) =>
      pick(r, [`Wandfliesen ${a.fmt} cm${tail(r)}`, `Wandfliesen Steingut ${a.fmt} verlegen`]),
    dev: (a) =>
      `Fliesenbelag an Wänden, Steingut, Format ${String(a.fmt).replace("x", " x ")} cm`.replace(
        "Fliesenbelag an Wänden",
        "Wandbelag Fliesen",
      ),
  },
  {
    id: "waterproofing",
    trade: "tiling",
    units: ["m2", "m²"],
    base: 34,
    attrs: [],
    history: (_a, r) => pick(r, [`Verbundabdichtung Dusche${tail(r)}`, `Abdichtung im Verbund, zweilagig`]),
    dev: () => `Flüssige Verbundabdichtung in Nassbereichen, zweilagig`,
  },
  // Painting
  {
    id: "emulsion_paint",
    trade: "painting",
    units: ["m2", "m²", "qm"],
    base: 6.8,
    attrs: [
      { key: "coats", values: ["einmalig", "zweimalig"], factor: table({ einmalig: 0.7, zweimalig: 1 }) },
    ],
    history: (a, r) =>
      pick(r, [
        `Dispersionsanstrich ${a.coats} auf Putz${tail(r)}`,
        `Dispersionsfarbe weiß, ${a.coats} streichen`,
        `Innenanstrich Dispersion ${a.coats}`,
      ]),
    dev: (a) => `Wände ${a.coats} mit Dispersionsfarbe streichen, weiß, Nassabrieb Klasse 2`,
  },
  {
    id: "primer",
    trade: "painting",
    units: ["m2", "m²"],
    base: 2.6,
    attrs: [],
    history: (_a, r) => pick(r, [`Grundierung Tiefgrund${tail(r)}`, `Tiefengrund auftragen`]),
    dev: () => `Grundieren der Wandflächen mit Tiefgrund, lösemittelfrei`,
  },
  {
    id: "wallpaper",
    trade: "painting",
    units: ["m2", "m²"],
    base: 11.5,
    attrs: [],
    history: (_a, r) => pick(r, [`Raufasertapete kleben${tail(r)}`, `Tapezierarbeiten Raufaser`]),
    dev: () => `Wandflächen mit Raufaser tapezieren, mittlere Körnung`,
  },
  // Electrical
  {
    id: "cable",
    trade: "electrical",
    units: ["m", "lfm"],
    base: 6.4,
    attrs: [
      {
        key: "sec",
        values: ["3x1,5", "5x1,5", "5x2,5"],
        factor: table({ "3x1,5": 1, "5x1,5": 1.35, "5x2,5": 1.75 }),
      },
    ],
    history: (a, r) =>
      pick(r, [`Kabel NYM-J ${a.sec} mm²${tail(r)}`, `Mantelleitung NYM-J ${a.sec} mm² verlegen`]),
    dev: (a) => `Installationsleitung NYM-J ${a.sec} mm² in Rohr verlegen`,
  },
  {
    id: "socket",
    trade: "electrical",
    units: ["St", "Stk"],
    base: 38,
    attrs: [],
    history: (_a, r) =>
      pick(r, [`Schutzkontaktsteckdose UP${tail(r)}`, `Steckdose Schuko unterputz, komplett`]),
    dev: () => `Unterputz-Schuko-Steckdose inklusive Abdeckung und Dose`,
  },
  {
    id: "distribution_board",
    trade: "electrical",
    units: ["St", "Stk"],
    base: 1650,
    attrs: [],
    history: (_a, r) =>
      pick(r, [`Unterverteilung UP 4-reihig${tail(r)}`, `Stromkreisverteiler UV 4-reihig, bestückt`]),
    dev: () => `Unterverteilung für Wohnung, 4 Reihen, mit FI und Sicherungsautomaten`,
  },
  // Plumbing
  {
    id: "drain_pipe",
    trade: "plumbing",
    units: ["m", "lfm"],
    base: 34,
    attrs: [{ key: "dn", values: [100, 125, 150], factor: linear(125, 0.6) }],
    history: (a, r) => pick(r, [`KG-Rohr DN ${a.dn}${tail(r)}`, `Abwasserrohr KG DN ${a.dn} verlegen`]),
    dev: (a) => `Grundleitung aus PVC-KG, Nennweite DN ${a.dn}, im Graben verlegt`,
  },
  {
    id: "wc",
    trade: "plumbing",
    units: ["St", "Stk", "Stück"],
    base: 640,
    attrs: [],
    history: (_a, r) =>
      pick(r, [`Wand-WC komplett mit Vorwandelement${tail(r)}`, `WC wandhängend inkl. Spülkasten UP`]),
    dev: () => `Hänge-WC aus Keramik mit Unterputzspülkasten und Betätigungsplatte`,
  },
  {
    id: "washbasin",
    trade: "plumbing",
    units: ["St", "Stk"],
    base: 420,
    attrs: [],
    history: (_a, r) => pick(r, [`Waschtisch komplett${tail(r)}`, `Waschtisch Keramik mit Armatur`]),
    dev: () => `Waschtischanlage aus Keramik einschließlich Einhebelmischer`,
  },
  {
    id: "copper_pipe",
    trade: "plumbing",
    units: ["m", "lfm"],
    base: 29,
    attrs: [{ key: "dn", values: [15, 22, 28], factor: linear(22, 0.7) }],
    history: (a, r) =>
      pick(r, [`Trinkwasserleitung Kupfer DN ${a.dn}${tail(r)}`, `Kupferrohr DN ${a.dn} verlegen`]),
    dev: (a) => `Leitung aus Kupfer für Trinkwasser, Nennweite DN ${a.dn}, gedämmt`,
  },
];

export const REGIONS = [
  "BW",
  "BY",
  "BE",
  "BB",
  "HB",
  "HH",
  "HE",
  "MV",
  "NI",
  "NW",
  "RP",
  "SL",
  "SN",
  "ST",
  "SH",
  "TH",
] as const;
export type Region = (typeof REGIONS)[number];

/** True regional price levels (hidden from the platform, which estimates its own). */
export const TRUE_REGION_FACTOR: Record<Region, number> = {
  BW: 1.08,
  BY: 1.12,
  BE: 1.03,
  BB: 0.93,
  HB: 0.99,
  HH: 1.1,
  HE: 1.05,
  MV: 0.9,
  NI: 0.96,
  NW: 1.0,
  RP: 0.97,
  SL: 0.95,
  SN: 0.9,
  ST: 0.87,
  SH: 0.98,
  TH: 0.88,
};

/**
 * Synthetic construction price index (2021 = 100), shaped like the German construction price
 * index for residential buildings: flat before 2021, steep in 2021-2022, flattening since.
 */
export const PRICE_INDEX: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  const anchors: [number, number][] = [
    [2019.0, 91.5],
    [2020.0, 94.0],
    [2021.0, 97.0],
    [2021.75, 104.5],
    [2022.5, 116.0],
    [2023.0, 120.5],
    [2024.0, 124.5],
    [2025.0, 128.0],
    [2026.0, 131.0],
    [2026.75, 133.0],
  ];
  for (let y = 2019; y <= 2026; y++) {
    for (let q = 1; q <= 4; q++) {
      const t = y + (q - 1) / 4;
      let v = anchors.at(-1)![1];
      for (let i = 1; i < anchors.length; i++) {
        const [t0, v0] = anchors[i - 1]!;
        const [t1, v1] = anchors[i]!;
        if (t <= t1) {
          v = v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
          break;
        }
      }
      out[`${y}Q${q}`] = Math.round(v * 100) / 100;
    }
  }
  return out;
})();

export function quarters(): string[] {
  return Object.keys(PRICE_INDEX);
}

/** The true market price (€ per written unit) of a family with attributes, in a region and quarter. */
export function truePrice(
  f: Family,
  attrs: Record<string, string | number>,
  region: Region,
  quarter: string,
): number {
  let p = f.base;
  for (const a of f.attrs) p *= a.factor(attrs[a.key]!);
  return p * TRUE_REGION_FACTOR[region] * (PRICE_INDEX[quarter]! / 100);
}

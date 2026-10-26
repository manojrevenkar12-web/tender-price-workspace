# Writing blind position texts

You are a German construction estimator (Kalkulator / AVA). For each kind of work below, write
**four** short texts (Kurztexte) for a bill of quantities (Leistungsverzeichnis), the way four
different estimators at four different general contractors would write them. Vary them as
real estimators do: full words or abbreviations (Stb., KS, GK, inkl., d=), different word
order, different trade vocabulary, with or without "liefern und einbauen", with norm or
product references. Each text must still describe exactly this work and nothing else.

Put each attribute value into the text with a placeholder in braces, e.g. `{thickness}`. Write
the value where a German estimator would write it; units are given below and must appear in
your text the way you would write them (e.g. "d = {thickness} cm"). Do not invent prices.

Do not look at any other file in this repository. Write only `blind/phrasings.json`:

```json
{ "family_id": ["text with {placeholder}", "...", "...", "..."], ... }
```

| family_id          | work                                                             | unit  | placeholders (values)                                                  |
| ------------------ | ---------------------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| excavation         | excavating a building pit, load and haul away                    | m³    | {soil}: soil class range as "3-5" or "6-7"                             |
| backfill           | backfilling the working space next to a basement wall, compacted | m³    | none                                                                   |
| gravel_base        | gravel base course under a slab                                  | m²    | {thickness}: 15, 20 or 30 (cm)                                         |
| rc_wall            | reinforced concrete wall                                         | m²    | {concrete}: C25/30, C30/37, C35/45; {thickness}: 18, 20, 24 or 30 (cm) |
| rc_slab            | reinforced concrete floor slab                                   | m²    | {concrete}: C25/30, C30/37; {thickness}: 18, 20, 22 or 25 (cm)         |
| rc_column          | reinforced concrete column, rectangular                          | m³    | {concrete}: C30/37, C35/45                                             |
| foundation_slab    | reinforced concrete ground slab, watertight concrete             | m³    | {concrete}: C25/30, C30/37                                             |
| rebar              | reinforcing steel bars B500B, cut, bent and placed               | t     | none                                                                   |
| rebar_mesh         | reinforcing steel mesh B500A, placed                             | t     | none                                                                   |
| formwork_wall      | wall formwork, smooth                                            | m²    | none                                                                   |
| ks_wall            | calcium silicate masonry wall                                    | m²    | {thickness}: 11.5, 17.5 or 24 (cm, write with comma)                   |
| brick_wall         | masonry wall from clay blocks                                    | m²    | {thickness}: 24, 30 or 36.5 (cm, write with comma)                     |
| lintel             | prefabricated flat lintel over openings                          | piece | {length}: 1.25, 1.5 or 2.0 (m, write with comma)                       |
| drywall_partition  | drywall partition on metal studs                                 | m²    | {system}: W111, W112, W115 (Knauf system)                              |
| suspended_ceiling  | suspended plasterboard ceiling                                   | m²    | none                                                                   |
| drywall_lining     | plasterboard wall lining                                         | m²    | none                                                                   |
| screed             | floating cement screed                                           | m²    | {thickness}: 4.5, 5, 6.5 or 8 (cm, write with comma)                   |
| interior_plaster   | interior lime-gypsum plaster                                     | m²    | {layers}: "einlagig" or "zweilagig"                                    |
| exterior_plaster   | exterior mineral plaster                                         | m²    | none                                                                   |
| floor_tiles        | porcelain floor tiles                                            | m²    | {format}: 30x30, 30x60, 60x60 (cm); {slip}: R9, R10, R11               |
| wall_tiles         | ceramic wall tiles                                               | m²    | {format}: 20x40, 30x60 (cm)                                            |
| waterproofing      | liquid-applied waterproofing under tiles in showers              | m²    | none                                                                   |
| emulsion_paint     | emulsion paint on interior walls                                 | m²    | {coats}: "einmalig" or "zweimalig"                                     |
| primer             | primer coat on walls                                             | m²    | none                                                                   |
| wallpaper          | woodchip wallpaper                                               | m²    | none                                                                   |
| cable              | installation cable NYM-J                                         | m     | {section}: 3x1,5 / 5x1,5 / 5x2,5 (mm²)                                 |
| socket             | flush-mounted shock-proof socket, complete                       | piece | none                                                                   |
| distribution_board | flush-mounted sub-distribution board, 4 rows, equipped           | piece | none                                                                   |
| drain_pipe         | PVC sewer pipe (KG) laid in trench                               | m     | {dn}: 100, 125, 150 (DN)                                               |
| wc                 | wall-hung WC with concealed cistern, complete                    | piece | none                                                                   |
| washbasin          | ceramic washbasin with mixer tap, complete                       | piece | none                                                                   |
| copper_pipe        | copper drinking-water pipe                                       | m     | {dn}: 15, 22, 28 (DN)                                                  |

# Western Ghats Ecologically Sensitive Area (ESA) — spatial extraction

**v3.** Source: MoEFCC draft notification **S.O. 3060(E), 31 July 2024**.
Village list and boundary coordinates read from the **text layer of the MoEFCC-published
PDF** (`https://moef.gov.in/storage/tender/1723024218.pdf`) — no OCR.
Village polygons: **all-India census village boundaries** (`Village_boundary_india.shp`,
661,194 features, EPSG:3857 → reprojected to **EPSG:4326**).

## Files
| File | Contents |
|---|---|
| `WG_ESA_2024.gpkg` | Main deliverable. Layers: `esa_villages`, `kerala_esa_official`, `esa_state_outline` |
| `WG_ESA_2024_villages.geojson` | Same as `esa_villages` layer |
| `WG_ESA_2024_kerala_official.geojson` | Kerala state-published ESA KML, converted |
| `WG_ESA_2024_attributes.csv` | Attribute table, no geometry |
| `UNMATCHED_needs_review.csv` | 64 gazette rows with no polygon |
| `area_comparison.csv` | Extracted area vs. notification Annexure-A area |

## Attributes (`esa_villages`, 4,338 features)
`gz_state, gz_district, gz_taluka, gz_village` — as printed in Annexure C.
`gz_village_raw` — verbatim incl. the `*` bifurcation marker. `gz_sno` — gazette serial no.
`cen_village, cen_subdistrict, cen_district` — the matched census record.
`censuscode` — 2011 Census village code. `lgd_villagecode` — Local Govt. Directory code.
`score` (0–100 name similarity), `scope` (`dist+tal` / `dist` / `state` — how wide the
search had to go). `area_km2` — polygon area, EPSG:7755.

### `esa_category`
| value | count | meaning |
|---|---|---|
| `whole_village` | 4135 | Entire revenue village in ESA |
| `kerala_village` | 122 | Kerala rows; Kerala's ESA is defined village-**portion**-wise by the State, so use `kerala_esa_official` for the true boundary |
| `notified_forest` | 53 | Tamil Nadu / Karnataka Reserve Forests and forest blocks |
| `bifurcated_village` | 26 | Gazette marks `*` — only **part** of the village is in ESA; polygon is the whole village and is therefore an **over-estimate** |
| `kerala_bifurcated_village` | 2 | Both of the above |
| `kerala_official_kml` | (separate layer) | Kerala's own published ESA polygons |

## Extraction method
The gazette PDF supplied locally is a "Print to PDF" copy with all text converted to vector
outlines — zero extractable text — which forced OCR in v1. The copy published on the MoEFCC
site is the same 279-page notification **with a full text layer**, so v3 reads it exactly
(`work/parse_text.py`).

- **Annexure C**: 4,402 rows. All six state serial runs are contiguous with no gaps —
  Goa 108, Gujarat 64, Karnataka 1449, Kerala 131, Maharashtra 2515, Tamil Nadu 135.
- **Annexure B**: 401 boundary points. All 402 coordinate pairs printed are accounted for;
  the one excluded is a gazette typo (Karnataka pt 45 reads 71.2007, 31.6736 — in Punjab).

Names were matched to census records hierarchically (district+taluka → district → state) with
RapidFuzz under a **1:1 constraint** (no polygon assigned twice). Each census village
contributes three romanised spellings (`name`, `censusname`, `lgd_villagename`) as match
aliases, and both sides are additionally compared under a **transliteration folding**
(`oo→u`, `ee→i`, doubled consonants collapsed, trailing vowels dropped) that makes
Marayur/Marayoor and Kottiyur/Kottiyoor compare as near-identical instead of ~80.
Because district+taluka already narrows the pool to a handful of villages, that scope runs a
looser threshold (72) than district-wide (85) or state-wide (93).

**4338 / 4402 (98.5%)** matched.

## Verification
### 1 — Gazette boundary coordinates (Annexure B1–B5)
All 401 "prominent points on the outer boundary", measured against the dissolved ESA
boundary in EPSG:7755:

| State | pts | median dist | within 500 m | within 2 km | within 5 km |
|---|---|---|---|---|---|
| Goa | 39 | **101 m** | 39 | 39 | 39 |
| Gujarat | 61 | **249 m** | 47 | 60 | 61 |
| Tamil Nadu | 109 | 414 m | 59 | 92 | 100 |
| Maharashtra | 135 | 495 m | 68 | 127 | 135 |
| Karnataka | 57 | 536 m | 28 | 48 | 56 |

These are boundary points, so the correct expectation is that they land *on* the polygon
edge, not inside it — hence distance-to-edge rather than point-in-polygon. Roughly half
falling inside is the expected signature of points sitting on a boundary.

### 2 — Kerala state-published KML
**98.1 %** of the official Kerala ESA area falls inside the extracted village polygons;
67 / 98 official polygons are >99 % covered, 86 / 98 are >95 %, 90 / 98 are >90 %.
Reverse coverage is 66.7 % — expected, because Kerala's ESA is village *portions* while
`esa_villages` holds whole villages.

### 3 — Area vs. Annexure A
| State | extracted km² | notification km² | ratio |
|---|---|---|---|
| Maharashtra | 17,140 | 17,340 | **0.99** |
| Goa | 1,436 | 1,461 | **0.98** |
| Gujarat | 458 | 449 | 1.02 |
| Tamil Nadu | 6,276 | 6,914 | 0.91 |
| Karnataka | 17,844 | 20,668 | 0.86 |
| Kerala | 13,041 | 9,994 | 1.30 (whole vs. partial villages) |
| **Total** | **56,196** | **56,826** | **0.99** |

## Change history
| | matched | Kerala KML coverage | total area ratio | Karnataka median boundary dist |
|---|---|---|---|---|
| v1 (OCR + SOI boundaries) | 4119 / 4402 (93.6%) | 90.3 % | 0.93 | 1043 m |
| v3 (text layer + census boundaries) | **4338 / 4402 (98.5%)** | **98.1 %** | **0.99** | **536 m** |

v2 established that the OCR used in v1 was 99.5 % accurate at row level but had 24 wrong
rows, 7 of which caused unmatched villages, and 2 of 347 boundary points had wrong
coordinates (one by ~200 km).

## Known limitations
- **The 64 unmatched rows are mostly structural, not name-matching failures.** They are
  composite cells naming two features (`Amravathi R.F./Anamalai R.F.`), gazette rows
  repeated for different survey blocks (`Valparai (TP)` appears four times, and the 1:1
  constraint gives the polygon to the first), placeholder text (`Area Under Forest`), and
  small Raigad hamlets (`*`-marked *wadis*) below census village granularity.
- **`bifurcated_village` polygons are whole villages** and over-state the ESA. Only the
  State Governments' physical-verification maps can resolve the partial extents. This is
  the main reason Kerala's ratio is 1.30.
- **Karnataka remains the weakest state** at 0.86 of notified area — now a coverage gap
  rather than a matching gap, since 1430 of 1449 rows are matched.
- Areas are computed in EPSG:7755; the notification does not state its own area basis.

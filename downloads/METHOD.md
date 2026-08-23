# Western Ghats Ecologically Sensitive Area (ESA) — spatial extraction

Source: MoEFCC draft notification **S.O. 3060(E), 31 July 2024**
(`https://moef.gov.in/storage/tender/1723024218.pdf`).
Village polygons: **all-India census village boundaries** (`Village_boundary_india.shp`,
661,194 features, EPSG:3857 → reprojected to **EPSG:4326**).

## Files
| File | Contents |
|---|---|
| `WG_ESA_2024.gpkg` | Main deliverable. Layers: `esa_villages`, `kerala_esa_official`, `esa_state_outline` |
| `WG_ESA_2024_villages.geojson` | Same as `esa_villages` layer |
| `WG_ESA_2024_kerala_official.geojson` | Kerala state-published ESA KML, converted |
| `WG_ESA_2024_attributes.csv` | Attribute table, no geometry |
| `UNMATCHED_needs_review.csv` | 71 gazette rows with no polygon |
| `area_comparison.csv` | Extracted area vs. notification Annexure-A area |

## Attributes (`esa_villages`, 4,331 features)
`gz_state, gz_district, gz_taluka, gz_village` — as printed in Annexure C.
`gz_village_raw` — verbatim incl. the `*` bifurcation marker. `gz_sno` — gazette serial no.
`cen_village, cen_subdistrict, cen_district` — the matched census record.
`censuscode` — 2011 Census village code. `lgd_villagecode` — Local Govt. Directory code.
`score` (0–100 name similarity), `scope` (`dist+tal` / `dist` / `state` — how wide the
search had to go). `area_km2` — polygon area, EPSG:7755.

### `esa_category`
These record **how a village was mapped**, not a level of legal protection. The notification
defines a single, undivided ESA — there is no Zone 1/2/3.

| value | count | meaning |
|---|---|---|
| `whole_village` | 4131 | Entire revenue village in ESA |
| `kerala_village` | 122 | Kerala rows; Kerala's ESA is defined village-**portion**-wise by the State, so use `kerala_esa_official` for the true boundary |
| `notified_forest` | 51 | Reserve Forests and forest blocks rather than revenue villages |
| `bifurcated_village` | 26 | Gazette marks `*` — only **part** of the village is in ESA; polygon is the whole village and is therefore an **over-estimate** |
| `kerala_bifurcated_village` | 1 | Both of the above |
| `kerala_official_kml` | (separate layer) | Kerala's own published ESA polygons |

## Extraction method
The village list and boundary coordinates are read directly from the text layer of the
notification (`work/parse_text.py`), so every name and coordinate is taken exactly as printed.

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

A **geographic gate** then rejects confident matches in the wrong place: villages matched at
district+taluka scope define each state's ESA core, and any wider-scope match landing more
than 50 km outside it is rejected and retried against its remaining candidates. Without it,
gazette `Khadi` (Surat) scored 100 against `Khada` in Junagadh, 295 km away in Saurashtra.

**4331 / 4402 (98.4%)** matched.

## Verification
### 1 — Gazette boundary coordinates (Annexure B1–B5)
All 401 "prominent points on the outer boundary", measured against the dissolved ESA
boundary in EPSG:7755:

| State | pts | median dist | within 500 m | within 2 km | within 5 km |
|---|---|---|---|---|---|
| Goa | 39 | **101 m** | 39 | 39 | 39 |
| Gujarat | 61 | **244 m** | 48 | 60 | 61 |
| Tamil Nadu | 109 | 404 m | 61 | 94 | 101 |
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
| Maharashtra | 17,117 | 17,340 | **0.99** |
| Goa | 1,436 | 1,461 | **0.98** |
| Gujarat | 464 | 449 | 1.03 |
| Tamil Nadu | 6,422 | 6,914 | 0.93 |
| Karnataka | 17,785 | 20,668 | 0.86 |
| Kerala | 13,030 | 9,994 | 1.30 (whole vs. partial villages) |
| **Total** | **56,254** | **56,826** | **0.99** |

## Known limitations
- **The 71 unmatched rows are mostly structural, not name-matching failures.** They are
  composite cells naming two features (`Amravathi R.F./Anamalai R.F.`), gazette rows
  repeated for different survey blocks (`Valparai (TP)` appears four times, and the 1:1
  constraint gives the polygon to the first), placeholder text (`Area Under Forest`), and
  small Raigad hamlets (`*`-marked *wadis*) below census village granularity.
- **`bifurcated_village` polygons are whole villages** and over-state the ESA. Only the
  State Governments' physical-verification maps can resolve the partial extents. This is
  the main reason Kerala's ratio is 1.30.
- **Karnataka remains the weakest state** at 0.86 of notified area — a coverage gap rather
  than a matching gap, since 1429 of 1449 rows are matched.
- **Population excludes urban local bodies.** The census workbook used holds only rural
  village records, so the 22 gazette entries that are Town Panchayats, Municipal Councils or
  Census Towns (Valparai, Coonoor, Gudalur, Mahabaleshwar, Matheran, Sawantwadi and others,
  1,455 km²) have no population figure and are excluded from every total. They are flagged
  `population_status`, never counted as zero. `uninhabited` means the Census recorded zero
  people, not that the figure is missing.
- Areas are computed in EPSG:7755; the notification does not state its own area basis.
- This is an independent reconstruction for reference and research. It has **no legal
  standing** and must not be used to determine whether a specific parcel falls inside the ESA.

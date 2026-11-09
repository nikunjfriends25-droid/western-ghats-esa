# Western Ghats ESA Atlas — project description

Copy for a project page, directory listing or portfolio entry.
Figures current as of the v3.11 build, 20 September 2026.

---

## What it is

The Western Ghats ESA Atlas is an interactive map and open dataset of the villages named in
India's draft Ecologically Sensitive Area notification for the Western Ghats — currently
**S.O. 4106(E) of 27 July 2026**, which reissues S.O. 3060(E) of 31 July 2024 unchanged.

The notification lists **4,402 villages** across Goa, Gujarat, Karnataka, Kerala, Maharashtra
and Tamil Nadu, covering a proposed 56,825.7 km². It names them in a table. It publishes no
map. This atlas reconstructs one: **4,331 of those 4,402 rows (98.4%) now have a mapped
boundary**, carrying their 2011 Census and LGD codes, and together covering 56,254 km² across
47 districts and 154 talukas.

It is for anyone who needs to know what the notification actually covers — residents and
panchayats checking whether their village is listed, journalists and researchers working on
Western Ghats policy, ecologists and planners who want the extent as a GIS layer, and
officials comparing the draft against their own records.

A visitor can search for a village by its gazette or census name, filter by state, district
or taluka, and open any village to see how it was matched and what it contains. The map can
be shaded by any of fifteen indicators — population density, natural forest, protected area,
recorded forest, composite scores — and overlaid with protected areas, tiger reserves,
corridors and recorded forest. Any selection, from a single village to all six states, can be
exported as a PDF report with its map and statistics. The whole dataset downloads as GeoJSON,
Shapefile, KML or CSV, and is also served as a free JSON API with no key and no rate limit.

## Why it exists

A draft notification that restricts land use across 56,825.7 km² and names 4,402 villages was
circulated with **no spatial data at all** — no map, no shapefile, no boundary list. The
village names sit in a 257-page PDF annexure.

That gap is not academic. A resident cannot tell from a list of names whether their land is
inside. A panchayat cannot see where the boundary runs. A journalist cannot show readers what
is proposed. A researcher cannot measure what the notification would protect. The states have
been objecting to the extent for over a decade, and every round of that argument has been
conducted without a public map to argue about.

The analysis itself had never been done publicly either: how much of the proposed area is
already protected, how much is already recorded forest and therefore already under state
control, how many people live inside, and which villages carry the most forest against the
least development pressure.

Worth being clear about what this is not. It is an independent reconstruction for reference
and research. **It has no legal standing and must not be used to determine whether a specific
parcel falls inside the ESA.** For that, consult the notification and the relevant State
Government.

## How it was built

**Reading the gazette.** Village names and boundary coordinates are read directly from the
notification's text layer with PyMuPDF — taken exactly as printed, not recognised from an
image. The parser handles fixed column positions, rows that wrap onto two lines with the
serial number vertically centred between them, state banners appearing mid-page, and two
side-by-side coordinate tables per page. Two checks confirm nothing was dropped: all six state
serial runs reconcile exactly to 4,402, and all 402 coordinate pairs in Annexure B are
accounted for — the one excluded is a typo in the gazette itself, a Karnataka point that plots
in Punjab.

**Matching names to boundaries.** Each gazette village is matched to the all-India census
village boundary layer, hierarchically: district-and-taluka first, then district, then
state-wide, under a strict 1:1 constraint so no polygon is ever assigned twice. Three things
made the difference over naive fuzzy matching — each census village offers three romanised
spellings as aliases; both sides are additionally compared under a transliteration folding
(oo→u, ee→i, doubled consonants collapsed) without which Marayur against Marayoor scores only
80 and is rejected; and thresholds scale with how far the search had to widen. A geographic
gate then rejects any wider-scope match landing more than 50 km outside its state's ESA core,
which caught thirty outliers — one Gujarat village had matched a perfect-score namesake 295 km
away in Saurashtra.

**Three independent verifications**, chosen so they do not share a failure mode:

1. *Against the gazette's own coordinates.* Annexure B gives 401 boundary points. Median
   distance from the reconstructed polygon edge is 101 m in Goa, 244 m in Gujarat, and under
   550 m in every state.
2. *Against Kerala's published boundary.* Kerala is the one state that released its own ESA as
   KML. **98.1% of that official area falls inside these village polygons**, with the 170 km²
   residue spread across 833 slivers rather than any missing region.
3. *Against the notified areas.* Annexure A states an area per state; the reconstruction
   totals 56,254 km² against 56,825.7 — a ratio of 0.99 overall.

**The analysis layer** joins those polygons to census, land-cover, protection and hydrology
data. Areas are measured in EPSG:7755, an equal-area projection for India, never in degrees.
Every source layer is unioned before measurement, because several self-overlap — recorded
forest reached 154% of a single village before that fix. Two composite scores rank each
village by percentile: conservation value (natural forest and recorded forest) and human
pressure (population density, built-up, highway density, land-dependent workers), designed so
the two axes share no variable; they correlate −0.49.

**The stack is deliberately plain.** Python with GeoPandas, Shapely, rasterio and rasterstats
for the pipeline; MapLibre GL JS and vanilla JavaScript for the site. No framework, no build
step, no backend. The whole portal is static files on GitHub Pages, which is what lets the
JSON API be free and keyless — it is just JSON at addressable paths.

## Data & sources

| Layer | Source | Used for |
|---|---|---|
| Draft notification S.O. 4106(E) | MoEFCC | The village list and boundary coordinates |
| All-India village boundaries | Census of India / Survey of India lineage | The polygon for every named village |
| Primary Census Abstract 2011 | Registrar General & Census Commissioner | Population, households, SC/ST, literacy, workers |
| Protected areas | India-WRIS, Ministry of Jal Shakti | Existing statutory protection; tiger reserves |
| Eco-Sensitive Zones, wildlife corridors | Parivesh / Bharatmaps, MoEFCC | Notified buffers; connectivity |
| Recorded Forest Area | Bharatmaps | Land already under forest administration |
| LULC 250K 2017-18, Wasteland Atlas 2015-16 | NRSC / ISRO | Land-cover composition |
| Forest circles, divisions, ranges | Forest Survey of India | Administrative setting |
| River basins, sub-basins, watersheds | India-WRIS | Hydrological setting |
| National highways | MoRTH via PM GatiShakti | Infrastructure pressure |
| Kerala ESA (KML) | Government of Kerala | Independent verification |
| Basemap | OpenStreetMap contributors, via OpenMapTiles | Geographic context |

Several layers were obtained through **India Geodata**, a consolidated repository of India's
openly-licensed geospatial data, released under CC BY 4.0.

**The atlas itself is CC BY 4.0** — use it freely with attribution to *Western Ghats ESA
Atlas, Nikunj Jambu*, and a link back. The underlying government datasets keep their own
terms; where a figure rests on a single dataset, cite that dataset directly rather than this
site. Full citations, a BibTeX block and every licence are on the Method & caveats page.

Everything is disclosed, including what is weak. Bifurcated villages and all Kerala villages
are whole-village polygons standing in for partial extents, so population is an upper bound
and every percentage-of-area figure is an under-estimate. The protected-area layer is a
government portal's republication and stops at 2021 notifications. Land cover is mapped at
1:250,000, which is unreliable below about 25 km². Land outside Recorded Forest Area is not
private land.

## What is next

**Evaluating the selection, not just mapping it.** The atlas currently describes only the
villages that were chosen. The obvious next question — is the selection well founded? — needs
the villages that were *not*. There are **18,469 of them in the same 202 subdistricts**, which
gives a like-for-like comparison: same administration, same terrain, differing only in whether
the gazette named them. That would show how many high-forest villages were left out and how
many low-forest, high-pressure ones were pulled in.

**Comparing the two expert reports properly.** The Gadgil (2011) and Kasturirangan (2013)
reports are endlessly compared in prose and almost never in geometry. Volume II of the
Kasturirangan report carries its own list of ESA villages, so a 2013-against-2026 diff can be
done now; a full spatial comparison additionally needs the Gadgil panel's zone grid, which has
never been published in a machine-readable form.

**An Open Natural Ecosystems layer.** About 11,600 km² inside the proposed ESA — roughly a
fifth of it — is officially classed as "wasteland": scrub, degraded forest, degraded pasture.
Much of that is likely savanna and montane grassland, which are ecosystems in their own right,
not degraded anything. Showing the same ground under both framings would make that visible.

**Open questions I would welcome help with.** Whether the 71 unmatched gazette rows can be
resolved against state revenue records. Whether any state has published its physical-
verification maps for bifurcated villages, which are the largest source of over-statement
here. And whether a biodiversity layer — endemism or threatened-species occurrence — can be
joined at village level, which would let the conservation score measure something ecological
rather than forest cover and tenure.

**Corrections are the most useful contribution.** If you know a village that is mapped wrongly,
or one the atlas missed, that is worth more than any feature request — every check so far has
found something real. Raise it on the GitHub repository, or get in touch through the link in
the footer.

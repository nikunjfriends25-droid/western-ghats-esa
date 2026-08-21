# Western Ghats ESA Atlas

Interactive atlas and open data for the **Western Ghats Ecologically Sensitive Area**
draft notification **[S.O. 3060(E)](https://moef.gov.in/storage/tender/1723024218.pdf)** of 31 July 2024.

**→ [Open the atlas](https://nikunjfriends25-droid.github.io/western-ghats-esa/)**

The notification lists 4,402 villages across six states but publishes no boundaries.
This reconstructs them: every village named in Annexure C matched to its polygon in the
all-India census village boundary dataset, giving **4,331 of 4,402 rows (98.4%)** a mapped
extent carrying its 2011 Census code.

## Verification

Three independent checks, because a village-name match can be confidently wrong.

| Check | Result |
|---|---|
| Gazette's own boundary coordinates (Annexure B, 401 points) | median 101 m (Goa) to 536 m (Karnataka) from the reconstructed edge |
| Kerala's official state-published ESA KML | **98.1%** of its area falls inside these polygons |
| Notified areas (Annexure A) | 56,254 km² reconstructed vs 56,826 km² notified — **ratio 0.99** |

## Source document

The notification itself: **[S.O. 3060(E), 31 July 2024](https://moef.gov.in/storage/tender/1723024218.pdf)**
(PDF, 4.9 MB, 279 pages), hosted by MoEFCC. Everything in this atlas is derived from that file.

## Data

Per-state **GeoJSON, Shapefile, KML and CSV** are in [`downloads/`](downloads/).
Full-resolution GeoPackage and merged GeoJSON are attached to the
[latest release](../../releases/latest).

## API

Static JSON served with `Access-Control-Allow-Origin: *` — no key, no rate limit,
callable from anywhere. Read-only and addressed by path.

```
api/v1/summary.json                  per-state counts, areas, notified comparison
api/v1/states/{GA|GJ|KA|KL|MH|TN}.json   all villages in a state, attributes only
api/v1/villages/{censuscode}.json    one village, full-resolution GeoJSON Feature
api/v1/boundary-points.json          the 401 Annexure B boundary points
api/v1/unmatched.json                gazette rows with no polygon, with reasons
```

```bash
curl https://nikunjfriends25-droid.github.io/western-ghats-esa/api/v1/villages/626770.json
```

## Important limits

- **Bifurcated villages are drawn whole.** The gazette's `*` marks villages only partly
  inside the ESA; no partial extent is published, so those polygons over-state the area.
- **Kerala is portion-wise by design** — its ratio is 1.30 for that reason. Treat the
  official Kerala KML layer as authoritative there.
- **Karnataka is the least complete state**, at 0.86 of its notified area.
- This is an independent reconstruction for reference and research. It has **no legal
  standing** and must not be used to determine whether a specific parcel falls inside the ESA.

Method and full verification detail: [`downloads/METHOD.md`](downloads/METHOD.md).

## Licence

Reconstruction released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Underlying government data remains under its own terms. Basemap © OpenStreetMap
contributors, tiles by CARTO.

# OpticForge

An optical-engineering knowledge base and calculator toolkit for DeepSeek Harness (DSH).

Pure Node.js. Zero runtime dependencies. Works as soon as it is installed.

> 中文文档见 [README.zh.md](README.zh.md)。

---

## What it is

Optical design, alignment and acceptance work is rarely blocked by formulas. It is blocked by **specific engineering criteria scattered across vendor manuals**: how a clear aperture is defined, which number to read off a tolerance report, how many pixels a spectrometer needs, which confocal sensor range actually fits.

OpticForge turns those into retrievable fact entries, so the model cites a source instead of guessing. Five recurring calculations are packaged as calculators that print the full derivation for review.

---

## Tools

| Tool | Purpose |
|---|---|
| `opticforge_docs` | List sections and entries; look here before searching |
| `opticforge_search` | BM25 retrieval; returns chunk_id, score, matched terms, excerpt, source, page |
| `opticforge_get` | Full 9-field entry for one chunk_id |
| `opticforge_calc` | Five calculators: formula → substitution → steps → result with units |

All knowledge-base tools share one envelope: `{ ok, kb_version, action, ... }`. Search supports `top_k`, `offset`, `max_per_doc`, `doc_filter` and reports `total_matched` / `has_more`.

---

## Knowledge base

9 sections (A01–E01), 67 entries, **51 usable** (`status=present`):

| Section | Topic | Entries / usable |
|---|---|---|
| A01 | Confocal chromatic sensors (Micro-Epsilon) | 13 / 12 |
| A02 | Building a spectrometer | 9 / 7 |
| A03 | Peak-localization review | 1 / 0 |
| B01 | Sequential tolerance analysis (Zemax KB) | 11 / 11 |
| B02 | DOE / metalens design | 4 / 4 |
| C01 | White-light interferometry (ZYGO CSI) | 5 / 0 |
| C02 | RCWA grating diffraction efficiency | 7 / 7 |
| D01 | Hamamatsu Si photodiodes | 11 / 9 |
| E01 | Metrology standards (JJF / ISO / GB) | 6 / 1 |

The remaining 16 entries are **declared gaps**: 11 `missing_source` (full text unavailable), 5 `substitute` (a comparable public source, explicitly marked as not the original).

Gaps are a feature, not a bug: the model is told "no source here" instead of inventing one.

### Accuracy rules

Every `present` entry is a rewritten fact entry, not a verbatim excerpt:

- `is_original_excerpt = false` for all entries
- Text starts with `【title】`, then `field: value` lines
- **Every number must appear verbatim in the corresponding source chunk** — if the source says "three cycles", the entry says 三个循环, never `3`
- No cross-chunk merging, no marketing language, no conclusions absent from the source
- Zero verbatim vendor text ships in this repository

These rules are enforced by `scripts/build-kb.mjs`, not by good intentions:

```bash
node scripts/build-kb.mjs --doc A02    # validate one section
node scripts/build-kb.mjs --all        # validate all + emit kb-data.json / kb-meta.json
node scripts/build-kb.mjs --check      # CI: artefact consistency only
```

---

## Install

**From the plugin market** (once listed): search `OpticForge`.

**Local link install** (development):

```bash
node scripts/install-local.mjs            # profile dependency + bundle entry + directory link
node scripts/install-local.mjs --dry-run
node scripts/install-local.mjs --uninstall
```

Restart DSH afterwards. Editing this repo and restarting is enough to pick up changes — no reinstall.

---

## Calculators

| type | Computes | Acceptance value |
|---|---|---|
| `diffraction_limit` | diffraction-limited spot radius | 706.3158 nm |
| `coating_thermal_drift` | coating thermal drift Δλ | 0.4469 nm |
| `confocal_range_select` | confocal sensor range selection | recommends IFS2402-1.5 |
| `tolerance_rss` | RSS tolerance stack-up | 0.6164 µm |
| `na_resolution` | NA / resolution | 353.1579 nm (confocal 249.7203 nm) |

When inputs are missing or invalid, the tool says what is missing and what range is reasonable. It never fills in a number.

---

## Development

```bash
node test/run.mjs             # integration tests
node scripts/verify-all.mjs   # release gate (package contract, data, pack list, versions)
node scripts/build-kb.mjs --all --version 0.1.0
```

Editing the knowledge base: edit `data/kb/<section>.json` → `--doc` validate → `--all` rebuild → run tests.

`.github/workflows/test.yml` runs the same gates on Ubuntu and Windows for Node 20 and 22.

---

## Boundaries

- Only the nine sections above are covered; quantum optics, COMSOL, thermal optics and similar topics return nothing, by design
- Fact entries are engineering rewrites of public material — verify against the `source` field before citing externally
- Calculators are engineering estimates, not final designs
- Gap entries tell you something is missing; they are not evidence

## License

MIT. Third-party material remains the property of its authors; this repository contains rewritten engineering facts with source attribution only.

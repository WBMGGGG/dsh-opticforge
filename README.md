# OpticForge

An optical-engineering knowledge base plugin for DeepSeek Harness (DSH).

Pure Node.js. Zero runtime dependencies. Works as soon as it is installed. **Since 0.2.0 this is a knowledge base only — the calculators are gone. 0.2.1 adds scenario-focused sections.**

> 中文文档见 [README.zh.md](README.zh.md)。

---

## What it is

Optical design, alignment and acceptance work is rarely blocked by formulas. It is blocked by **specific engineering criteria scattered across vendor manuals, standards and papers**: how a clear aperture is defined, which number to read off a tolerance report, how many pixels a spectrometer needs, which confocal range actually fits, why a metalens has chromatic aberration.

OpticForge turns those into retrievable fact entries, so the model cites a source instead of guessing.

---

## Three tools

| Tool | Purpose |
|---|---|
| `opticforge_docs` | List 34 sections and every entry title. Look here before searching |
| `opticforge_search` | BM25 retrieval; returns chunk_id, score, matched terms, excerpt, source, section |
| `opticforge_get` | Full 9-field entry for one chunk_id |

All three share one envelope: `{ ok, kb_version, action, ... }`. Search supports `top_k`, `offset`, `max_per_doc`, `doc_filter` and reports `total_matched` / `has_more`.

---

## Knowledge base (0.2.1)

**40 sections, 324 entries, 308 of them usable** (`status=present`):

| Series | Sections | Content | Entries |
|---|---|---|---|
| A–E | 9 | Rewritten from vendor documents: confocal sensors, spectrometer build, tolerancing, DOE, white-light interferometry, RCWA gratings, photodiodes, metrology standards | 67 (51 present) |
| F | 10 | Foundations: geometric optics, interference/diffraction, polarization, lasers, radiometry & colorimetry, thin films, detection & noise, spectroscopy, interferometry, materials & fabrication | 83 |
| G | 7 | Engineering: opto-mechanics, tolerance & uncertainty, thermal optics, spectral/radiometric calibration, inspection & image processing, COMSOL, SolidWorks | 53 |
| H | 8 | Frontier: metasurfaces & DOEs, waveguides & photonic integration, quantum optics, hyperspectral imaging, laser triangulation/confocal/lidar, field failures, frontier topics, semiconductor sources | 61 |
| I | 6 | Scenario-focused (0.2.1): aberration judgement, physical optics & transfer functions, optical testing, optical design, hyperspectral pushbroom/snapshot, Czerny-Turner and Offner spectrometer design | 60 |

A–E also carry 16 **declared gaps**: 11 `missing_source` (full text unavailable), 5 `substitute` (a comparable public source, explicitly marked as not the original).

Gaps are a feature: the model is told "no source here" instead of inventing one.

### Accuracy rules

Two section types, two rule sets, both enforced by `scripts/build-kb.mjs`:

**A–E (source-backed, 67 entries)**

- `chunk_id` set must equal the vendor snapshot exactly — citation anchors cannot drift
- Rewritten as fact entries (`is_original_excerpt = false`), text starts with `【title】`
- **Every number must appear verbatim in the source chunk** — if the source says "three cycles", the entry says 三个循环, never `3`
- No verbatim vendor text ships publicly; `_kb-raw/` stays local

**F/G/H/I (compiled, 257 entries)**

- No single source; content is the consensus of textbooks, standards and reviews, each `source` field naming a real, checkable reference
- Text ≥ 300 chars, at least three field lines (definition / formula / criterion / limits / engineering notes), `disclaimer` must state "非原文摘录"
- **No product model numbers or vendor specifications** — those appear only in A–E, where a snapshot backs them

---

## Install

**From the plugin market** (listing submitted): search `OpticForge`.

**Local link install** (development):

```bash
node scripts/install-local.mjs            # profile dependency + bundle entry + directory link
node scripts/install-local.mjs --dry-run
node scripts/install-local.mjs --uninstall
```

Restart DSH afterwards. Editing this repo and restarting is enough to pick up changes — no reinstall.

---

## Development

```bash
node test/run.mjs                                  # integration tests
node scripts/verify-all.mjs                        # release gate
node scripts/build-kb.mjs --all --version 0.2.0    # rebuild artefacts
```

Editing the knowledge base: edit `data/kb/<section>.json` → `--doc` validate → `--all` rebuild → run tests.

`docs/KB-OUTLINE.zh.md` is the section/entry contract; `docs/KB-SPEC.zh.md` and `docs/KB-SPEC-COMPILED.zh.md` are the two writing specs.

`.github/workflows/test.yml` runs the same gates on Ubuntu and Windows for Node 20 and 22.

---

## Boundaries

- Only the 40 sections above; lithography process and space optics are explicitly not covered, and any unlisted topic is treated the same way — no answer is invented for it
- Compiled entries are engineering summaries of textbook consensus — verify against the `source` field before citing externally
- Vendor numbers appear only where a snapshot exists
- Gap entries tell you something is missing; they are not evidence

## License

MIT. Third-party material remains the property of its authors; this repository contains rewritten engineering facts with source attribution only.

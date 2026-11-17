# OpticForge

> Optical engineering tasks are not blocked by "finding one paragraph". They are blocked by four questions: which dimensions must be answered, whether each dimension has evidence, what to do next, and how to verify before delivery.
>
> OpticForge turns that into an executable work package. It does not calculate, browse, or write files for you. It tells the execution layer **what to retrieve, how to prove each dimension, when browsing is allowed, and which gates a deliverable must pass**.

Built for DeepSeek Harness (DSH). Pure Node.js, zero runtime dependencies. Current version **3.1.1**.

> 中文: [README.zh.md](README.zh.md)

---

## 0. One architecture, two numbering systems

This is the most misunderstood point, so it comes first.

**OpticForge has only one KB architecture: the v3 architecture defined by `OpticForge知识库-v3纯净版`. The runtime KB is not a second architecture; it is the filled subset of that architecture.**

| What you see | What it actually is | What it is not |
|---|---|---|
| v3 baseline: 8 domains / 54 families / ~470 leaf topics | **L1 coverage baseline**: the skeleton, families, leaf topics and required dimensions | Not a legacy library that only exists on paper |
| 40 source sections / 324 entries / 308 present (A–I) | **L2 filled subset**: source-backed, citable partitions under the v3 architecture | Not a second KB, and not 40 v3 families |
| 308 concept cards | **L3 atomic layer**: one card per present chunk, mapped to v3 domains/families | Not a separate index, and not a replacement for 470 full entries |

One sentence: **v3 is the map; the 40 source sections are the districts already built on it. The A–I labels are construction-document numbers, not new city districts.**

---

## 1. What it solves

| Bottleneck | OpticForge response |
|---|---|
| Evidence is scattered across manuals, standards and papers; you cannot prove "nothing exists" | **Evidence layer**: per-dimension retrieval; every hit has a source and excerpt; internal IDs stay internal; a missing dimension is marked as a gap, never invented |
| You do not know what to retrieve, calculate, draw or write first | **Routing layer**: multi-playbook activation, dimension fusion, local Skill/MCP/workspace discovery, a staged plan with `dimension_id` and `coordinates_with` |
| A deliverable looks right until citations, units, assumptions and gaps are checked | **Verification layer**: citation, quantity, structure, formula trace, dimension coverage, adoption gate and five-section presentation |

Three "nots" distinguish it from a Q&A knowledge base:

- **No browsing first**: establish the KB baseline; browse only for KB gaps, standard versions, vendor parameters, or price/freshness.
- **No hidden gaps**: mark `gap`, list source-level gaps, label second-hand sources `untrusted`; never fill a missing dimension with a neighbouring one.
- **No internal fields dumped on the user**: since 3.1.1 the answer is five sections — conclusion ≤3 sentences, one severity table, one branch criterion, ≤3 routes, ≤3 verifications + ≤4 open parameters.

The user-facing explanation always follows **one-sentence principle → key formula/criterion → concrete approach → operating steps**. No KB layer or entry numbers; sources are named as documents, standards, manuals or URLs. Images are optional aids, never a substitute for evidence.

---

## 2. Architecture

### 2.1 Three layers

```
L1  v3 coverage baseline    8 domains / 54 families / ~470 leaf topics / 16 playbooks / 34 formula cards (target)
         │  defines skeleton, families, leaf topics, required dimensions per topic
         ▼
L2  runtime evidence layer  40 source sections (A–I) / 324 entries / 308 present
         │  only source-backed, citable content; BOARD_MAP maps it to v3 domains/families
         ▼
L3  concept cards           308 cards, one per present chunk, extracted verbatim
            each has domain (one of 8) + v3_boards (mapped v3 families) + applies_to
```

**L1 is a coverage baseline, not a queryable corpus.** It says what should be covered. L2 says what can actually be cited now. L3 compresses L2 into non-duplicated atoms for dimension evidence and topic cards.

### 2.2 How 40 maps to 54

The 40 source sections are **source partitions**, numbered by origin: A–E are vendor-material rewrites, F is fundamentals, G is engineering systems, H is frontier/cross-domain, I is scenario depth. They map to 8 domains / 54 families **many-to-many**: one source section can feed 2–3 families; one family can be fed by several sections.

`BOARD_MAP` in `scripts/build-concept-cards.mjs` is the single source of truth. Mapping stops at family level, never forced down to leaf topics. Examples:

| Source section | Mapped v3 families | Why |
|---|---|---|
| `A01` confocal sensors | `IM04` / `DT02` / `TF02` | Confocal content feeds imaging, metrology and theory |
| `C01` tolerance analysis | `DT02` / `IM05` / `TF02` | Metrology, imaging chain and theory |
| `I05` hyperspectral pushbroom | `IM03` / `DS03` / `TF02` | Imaging, design and theory |
| `F01` geometrical optics | `TF01` | Fundamentals, single family |
| `G01` opto-mechanical assembly | `DS04` | Design and simulation |

Therefore:

- **40 is not a replacement for 54, and not a second partition.** 40 = source sections with content today; 54 = the full v3 family set.
- One source section spanning several families is the source of cross-coverage, not an architectural conflict.
- The domain distribution of 308 cards (IM53 / QE33 / MT65 / DT26 / TF67 / EL3 / DS53 / AL8) is the distribution of **filled content**, not the v3 coverage target.

### 2.3 Why "the architecture looks completely different"

Three numbering systems coexist because they answer different questions:

| Numbering | Example | Question answered | Not |
|---|---|---|---|
| v3 domain/family | `IM04`, `DT02`, `TF02` | Where this content sits in the v3 architecture | Not a chunk ID, not a source-section ID |
| Source section | `A01`, `C01`, `I05` | Which source partition this content comes from | Not a v3 family; no one-to-one requirement |
| Runtime chunk | `A01-01`, `I01-07` | Which specific fact is citable | Not an architecture level |

Mistaking a source-section ID for an architecture partition makes 40 and 54 look incompatible. Mistaking the v3 baseline for another runtime library makes it look like two KBs. In reality it is **one v3 architecture: L1 baseline + L2 filled subset + L3 atomic cards**.

### 2.4 Current coverage and gaps

`BOARD_MAP` currently covers **39/54 v3 families**:

| Domain | v3 families | Mapped | Concept cards |
|---|---:|---:|---:|
| TF fundamentals | 9 | 7 | 67 |
| MT materials/devices | 7 | 7 | 65 |
| DS design/simulation | 8 | 6 | 53 |
| IM imaging/spectroscopy | 7 | 5 | 53 |
| AL algorithms/signal | 7 | 2 | 8 |
| EL electronics | 6 | 4 | 3 |
| DT metrology | 4 | 4 | 26 |
| QE quality/reliability | 6 | 4 | 33 |
| **Total** | **54** | **39** | **308** |

The remaining 15 families (TF04/TF08, DS05/DS06, IM01/IM06, AL01/02/03/05/07, EL04/06, QE03/06) have no runtime entries yet; they are treated as gaps, not filled with generic prose. 3.1.1 does not rewrite 324 entries into 470. That is a content migration, not a mechanics release. The skeleton, dimensions, topic cards and mapping are in place.

### 2.5 Three read-only layers on top of the runtime KB

| File | Contents | Role |
|---|---|---|
| `data/assist-playbooks.json` | 16 topic cards, 98 dimension declarations, `relations` + `cross_check`, `dimension_id` on every step | Cross-domain coverage is declared, not left to retrieval luck |
| `data/concept-cards.json` | 308 atomic cards, one per present chunk, verbatim; 8 domains IM53/QE33/MT65/DT26/TF67/EL3/DS53/AL8, each with `applies_to` | Compresses v3 leaves into reusable atoms without duplicating the KB |
| `data/cross-dimensions.json` | 6 generic dimensions: principle / design / calc / implementation / verification / risk | Fallback when no topic card matches |

---

## 3. Task flow

```
Problem
 │
 ├─ opticforge_assist ── intake & routing (offline)
 │    ├─ brief              goal / deliverable / constraints / questions / active_playbooks
 │    ├─ alignment          KB queries / matched / unmatched / verdict (per dimension)
 │    ├─ dimensions         evidence / hit_chunk_ids / concept_cards / gap_reason / source_matrix
 │    ├─ relations          cross-domain relations + cross_checks
 │    ├─ web_gate           closed by default; opens only for KB gap / version / vendor params / price
 │    ├─ plan               staged steps; dimension_id, blocked_by, coordinates_with
 │    ├─ report_outline     five-section skeleton + source names + key-value hints
 │    ├─ search_pack        KB queries + external groups per gap dimension
 │    └─ acceptance         acceptance list + risks + handoff Markdown
 │
 ├─ execution layer (DSH agent)
 │    ├─ Skills: opticforge-task / sheet / word / ppt / browser …
 │    ├─ MCP: desktop / browser / GitHub …
 │    ├─ local: PowerShell / Python / files
 │    └─ search: only after web_gate opens
 │
 └─ opticforge_verify ── delivery self-check (offline)
      ├─ citations / quantities / structure / wording
      ├─ KB-first: alignment section, verdict, URL dates and source detail
      ├─ cross: dimensions complete, each evidenced, coupling consistent
      ├─ adoption: source tier, multi-source, KB conflict, freshness
      ├─ calc: formula_id, inputs, units, outputs, recheck path
      └─ presentation: five sections, ≤3 tables, no internal fields/layer codes, open params only in §5
```

`assist` and `verify` are advisory and read-only. They never browse, write files, or execute commands. The execution layer does.

### 3.1 Five-section delivery

`assist.report_outline` gives the skeleton. The user-facing answer follows this order and does not dump internal fields:

1. **Conclusion** — ≤3 sentences: judgement, decisive branch, immediate action.
2. **Severity fit** — one table: condition, criterion/magnitude, margin, action.
3. **Branch test** — one experiment or criterion that separates two routes.
4. **Route recommendation** — ≤3 routes, one-line applicability each, then a clear recommendation.
5. **Verification and open parameters** — ≤3 verifications; ≤4 open parameters, only in this section.

Hard rules: ≤3 tables; no `alignment` / `web_gate` / `source_matrix` / `coverage_matrix` / `blocked_by` / `active_playbooks` in the body; no `chunk_id`, `A01-01`, `IM04` or similar KB layer/entry numbers; sources are named as documents, standards, manuals or URLs. Explanation order: one-sentence principle → key formula/criterion → concrete approach → operating steps. Images are optional aids only.

### 3.2 Web gate

Call `assist` first, execute `alignment.kb_queries`, record matched/unmatched and `verdict`, then read `web_gate`. `alignment.verdict` **describes coverage only and never opens the gate**.

`web_gate` is closed by default; it opens only on `kb_gap`, `standard_version`, `vendor_params`, or `price_timeliness`. Even then, each external query still needs its own `granted` condition and its `blocked_by` resolved; web steps never run in parallel with evidence collection. The bundled `skills/opticforge-task/SKILL.md` enforces the same flow.

**Explicit gap expression**: when a dimension has zero KB hits, `source_matrix.web.status = "required"`, and bilingual `缺口·X` external query groups are produced. The deliverable must mark `covered_by_web` and source tier. This closes the gap between "retrieval returned nothing" and "the plugin quietly invented something".

### 3.3 Adoption gate

The web gate decides whether browsing is allowed. The adoption gate decides whether retrieved knowledge is trustworthy enough to count as coverage. A dated URL is not automatically correct.

| Criterion | Rule |
|---|---|
| Source tier | Primary sources (standards, vendor datasheets, official manuals, papers) are citable; secondary sources (blogs, forums, aggregators, self-media) are `untrusted` — leads only, not evidence |
| Multi-source | Key numbers (bandwidth, efficiency, temperature, precision) need ≥2 independent primary sources, or one primary source labelled "single-source pending" |
| KB conflict | If an external fact conflicts with a present KB entry, mark `conflict_with_kb`; prefer KB, or explain the difference (test conditions / version / model) |
| Freshness | Price, model, standard version and lead time need an access date; beyond threshold (e.g. price 30 days) mark `stale` |

Only evidence passing adoption flips a dimension from `gap` to `covered_by_web` and counts toward coverage. Secondary/conflicting sources stay `unverified`. `verify` returns `adoption` (four criteria + pass); in strict mode failure is an error.

---

## 4. Five tools

| Tool | Layer | Purpose |
|---|---|---|
| `opticforge_assist` | Advisory | **Main entry**. Problem → brief + evidence + routing + plan + search pack + acceptance + five-section outline + handoff |
| `opticforge_verify` | Advisory | Delivery self-check. Pass `text` or a `.md/.txt/.json/.csv` path; 0–100 score and issue list. Optional `dimensions`, `relations`, `now`, `presentation` |
| `opticforge_search` | Evidence | BM25 retrieval; chunk_id, score, matched terms, excerpt, source, section |
| `opticforge_get` | Evidence | Fetch a full entry by chunk_id (9 fields) |
| `opticforge_docs` | Evidence | List 40 sections and their titles |

All tools share the envelope `{ ok, kb_version, action, ... }`.

### 4.1 Typical call

```json
{
  "problem": "Design a 400–1000 nm pushbroom hyperspectral imager: 5 nm spectral resolution, 0.5 m@1 km spatial resolution, 30 km swath. Give the dispersion scheme, budget and calibration flow.",
  "deliverable": "design report",
  "workspace": "D:/AI/projects/hyperspectral",
  "known_capabilities": ["sheet", "word", "general_search"]
}
```

`assist` activates up to three topic cards (typically hyperspectral + spectrometer + optical design), fuses their required dimensions (dispersion / aberration / detector / algorithm / electronics / calibration), and returns:

- `brief` — goal, deliverable, constraints, open questions, `active_playbooks`
- `alignment` — `kb_queries`, `matched` / `unmatched`, `coverage_matrix`, `verdict` (`covered` / `partial` / `gap`), all per dimension
- `dimensions` — one row per dimension: evidence, `hit_chunk_ids`, `concept_cards`, `gap_reason`, `source_matrix` (`kb`: covered/gap; `web`: not_required/required)
- `relations` / `cross_checks` — cross-domain constraints and the points that must be answered explicitly
- `plan.steps[]` — `capability`, `actions`, `routing`, `output`, `dimension_id`, `blocked_by`; coupled steps carry `coordinates_with` and are excluded from `parallelizable`
- `report_outline` / `report_style` — five-section skeleton and style rules
- `search_pack` — KB queries + external groups with `trigger` / `gated` / `gate_id` / `blocked_by` / `dimension_id`
- `handoff`, `acceptance`, `risks`

### 4.2 Calculation and self-check

`calc_specs` selects from 19 formula cards (formula, variables, units, assumptions, sanity range, worked example, KB source ID). The plugin does not calculate; the execution layer calculates and records `formula_id`, inputs, outputs, units and a recheck path.

For docx/pdf, export to `.md` / `.txt` with the word/pdf Skill first, then call `verify`. Reports/proposals should pass `presentation: true` to enforce the five sections.

---

## 5. Runtime knowledge base

### 5.1 Content

40 sections / 324 entries / 308 `present`:

| Series | Sections | Content | Entries |
|---|---|---|---|
| A–E | 9 | Vendor-material rewrites: confocal sensors, spectrometer builds, tolerance analysis, DOE, white-light interferometry, RCWA gratings, photodiodes, metrology specs | 67 (51 present) |
| F | 10 | Fundamentals: geometrical optics, interference/diffraction, polarization, lasers, radiometry/color, thin films, detection/noise, spectroscopy, interferometry, materials | 83 |
| G | 7 | Engineering systems: opto-mechanical assembly, tolerance/uncertainty, athermalization, spectral/radiometric calibration, inspection/image processing, COMSOL, SolidWorks | 53 |
| H | 8 | Frontier/cross-domain: metasurfaces/DOE, waveguides/photonics, quantum optics, hyperspectral, laser triangulation/confocal/lidar, failure cases, frontier topics, semiconductor sources | 61 |
| I | 6 | Scenario depth: aberration reading, physical optics/MTF, optical testing, optical design, hyperspectral pushbroom/snapshot, Czerny–Turner/Offner | 60 |

### 5.2 Accuracy rules

Enforced by `scripts/build-kb.mjs`:

**A–E (source-based, 67 entries)** — `chunk_id` sets match vendor snapshots exactly; entries are rewritten facts (`is_original_excerpt = false`), start with `【title】`; every number is found verbatim in the same source block; no long verbatim excerpts in the public repo (`_kb-raw/` stays local).

**F/G/H/I (compiled, 257 entries)** — no single source; based on textbooks, standards and reviews; `source` is a real, checkable reference; ≥300 characters, ≥3 field lines; `disclaimer` marks "not a source excerpt"; no product models or vendor claims.

### 5.3 Gaps and conventions

Three source-level gaps: A03 (peak-location review, 1 entry), C01 (ZYGO CSI white paper, 5), E01 (JJF 1990-2022, 6). Of 16 non-present entries: 11 `missing_source`, 5 `substitute` (similar public material, explicitly labelled non-original). `assist` lists them separately as `library_gaps`; `verify` treats citing a non-present entry as an error. Lithography process and space optics are intentionally out of scope. Empty retrieval means no evidence, not permission to invent.

Depth-of-focus convention: `I01-07` uses `±λ/NA²` while `G02-07` uses `±λ/(2NA²)`; the 2× difference comes from half- vs full-depth definitions. The library defaults to `G02-07`'s `±λ/(2NA²)` (full depth `4λF²`, conservative). It changes alignment margin, not route decisions.

---

## 6. Install and marketplace

### 6.1 Install

npm publication is currently on hold. Install from the GitHub repository:

```bash
git clone https://github.com/WBMGGGG/dsh-opticforge.git
cd dsh-opticforge
node scripts/install-local.mjs            # profile dependency + bundles + directory links
node scripts/install-local.mjs --dry-run  # preview only
node scripts/install-local.mjs --uninstall
```

Restart DSH after install. The installer links `skills/opticforge-task` to `~/.dsh/skills/opticforge-task`; it will not overwrite a real directory, and uninstall removes only links.

### 6.2 Why dsh-market does not list it

dsh-market only reads `https://awesome-dsh-plugin.com/plugins.json`. OpticForge's awesome entry is still PR **#15752**, status OPEN, not merged. Until merge, that JSON has no such entry, so the marketplace cannot find it. Both checks (`check`, `Submission gate`) pass and `mergeable=MERGEABLE`; after merge it is usually indexed within one day. Marketplace listing depends only on the awesome entry, not on npm publication.

---

## 7. Development and tests

```bash
node test/run.mjs                              # integration (30)
node test/assist-contract.test.mjs             # assist/verify contracts (26)
node test/entry-contract.test.mjs              # entry contracts (5)
node scripts/verify-all.mjs                    # release gate (61)
node eval/run-kb-first.mjs                     # 13 task classes + cross contract + structure compliance
node scripts/build-kb.mjs --all --version 3.1.1
node scripts/build-kb.mjs --check
node eval/run-kb-first.mjs --trace <trace.jsonl>
```

To change KB content: edit `data/kb/<section>.json` → `--doc` self-check → `--all` rebuild → tests. Rebuild also refreshes concept cards and `kb_version`.

To change topic cards: edit `data/assist-playbooks.json`; no code change.

To change mapping: edit `BOARD_MAP` in `scripts/build-concept-cards.mjs`, then rebuild concept cards. Mapping stays at v3 family level, never forced to leaves.

CI (`.github/workflows/test.yml`) runs the same checks on Ubuntu + Windows, Node 20 + 22.

---

## 8. Boundaries

- Covers only the 40 sections in §5; lithography process and space optics are out of scope.
- Compiled entries are engineering syntheses; check the `source` before external citation.
- Vendor numbers appear only in A–E with source snapshots.
- Gap entries mean "no evidence here", never citable facts.
- The plugin never browses or executes; external retrieval and Skill/MCP calls belong to the execution layer.
- `verify` is text-level only; docx/pdf must be exported to text first.
- `alignment.verdict` reports coverage, not permission to browse; `web_gate` decides that.
- 40 source sections are not 54 v3 families; the mapping is many-to-many. Do not force one-to-one.

## License

MIT. Third-party material remains with its original authors; this repository stores rewritten engineering facts with source attribution.

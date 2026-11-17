# OpticForge

A **task-assistant plugin** for optical engineers, built for DeepSeek Harness (DSH). Give it one concrete optics problem and it returns an executable work package: task brief, dimension-based evidence, cross-domain relations, capability routing, a staged plan, targeted search queries and acceptance checks.

Pure Node.js, zero runtime dependencies. It never accesses the network and never performs external actions — it decides *how* the work should be done; the DSH agent does the work.

> 中文文档见 [README.zh.md](README.zh.md)。

---

## 1. What it is

Most optical-engineering tasks are not blocked by formulas. They are blocked by three things, and OpticForge addresses each with a dedicated layer.

| Problem | OpticForge response |
|---|---|
| Evidence is scattered across manuals, standards and papers | **Evidence layer** — 40 sections / 324 source-attributed entries (308 usable), retrieved per required dimension; every hit carries `chunk_id`, source and excerpt; no basis is stated as such |
| The work path is unclear — what to search, compute, draw, write, and in what order | **Routing layer** — multi-playbook activation, dimension fusion, local Skill / MCP / workspace discovery, a capability-tagged plan with `dimension_id` and cross-step `coordinates_with` |
| Deliverables look right until someone checks citations, units, assumptions and gaps | **Verification layer** — citation, quantity, structure, formula-trace, dimension-coverage and adoption-gate checks before delivery |

The plugin is an **advisory layer**, not an executor. Everything in `plan` is carried out by the DSH execution layer.

---

## 2. Version and knowledge-base truth

This section is the authoritative description of **what actually ships in 3.1.0**. Read it before assuming the knowledge base changed.

### 2.1 Version

| Item | Value |
|---|---|
| `package.json` version | `3.1.0` |
| `data/kb-meta.json` `kb_version` | `3.1.0` |
| Tool `kb_version` echo | `3.1.0` (all five tools) |

Version is checked in three places by the entry-contract test; changing one without the others fails CI.

### 2.2 What changed in 3.1.0 — mechanics, not content

**The knowledge entries did not change.** 3.1.0 is a mechanics release: cross-coverage became an inspectable contract (multi-playbook activation, per-dimension evidence, dimension×source coverage matrix, cross-checks, adoption gate). The fact base is still the same 40 sections / 324 entries / 308 present.

### 2.3 Two different things both called "knowledge base"

Confusing these two is the single most common source of wrong expectations:

| | Runtime KB (what the plugin queries) | v3 content map (a planning baseline) |
|---|---|---|
| Where | `data/kb/*.json` → `data/kb-data.json` | A design target, not shipped as queryable entries |
| Shape | 40 sections (A–E, F, G, H, I), 324 entries | 8 domains × 54 families, ~470 leaf topics |
| Role | The only citable source; `status=present` only | Defines *what should be covered* and which dimensions a cross-domain task must answer |
| Used at | Every `assist` / `search` call | Designing topic cards and evaluation coverage |

**The v3 map is a coverage baseline and search-term pool, not 470 fully written chunks.** It is not abandoned — it is the source from which the 16 topic cards derive their required dimensions. Exhaustively enumerating a *catalogue* of topics is finite and useful; exhaustively writing a *full entry* for every leaf would explode storage and dilute BM25 precision. 3.1.0 deliberately does only the former.

### 2.4 The three read-only layers added on top of the runtime KB

| File | Contents | Role |
|---|---|---|
| `data/assist-playbooks.json` | 16 topic cards, 98 dimension declarations, `relations` + `cross_check`, `dimension_id` on every step | Cross-domain coverage is declared here, not left to retrieval luck |
| `data/concept-cards.json` | 308 atomic cards, one per present chunk, extracted verbatim (no rewriting, no added numbers); 8 domains IM53/QE33/MT65/DT26/TF67/EL3/DS53/AL8, each with `applies_to` | Turns v3 leaves into compact, reusable atoms without duplicating the KB |
| `data/cross-dimensions.json` | 6 generic dimensions: principle / design / calc / implementation / verification / risk | Fallback so cross-coverage still happens when no topic card matches |

---

## 3. How the three layers work

```
Problem
 │
 ├─ opticforge_assist ── intake & routing (no network)
 │    ├─ brief           goal / deliverable / constraints / questions / active_playbooks
 │    ├─ alignment       KB queries / matched / unmatched / verdict — per dimension
 │    ├─ web_gate        closed by default; opens on gap / version / vendor / freshness
 │    ├─ dimensions      per-dimension evidence + concept cards + gap_reason + source_matrix
 │    ├─ relations       cross relations + cross_checks
 │    ├─ evidence        KB chunks + dimension×source matrix + gaps
 │    ├─ capabilities    local Skills / MCP / workspace assets
 │    ├─ calc_specs      formula cards, never a calculator
 │    ├─ plan            staged steps; dimension_id, blocked_by, coordinates_with
 │    ├─ search_pack     KB queries + conditional external queries, grouped per gap dimension
 │    └─ acceptance      checklist + risks + handoff Markdown
 │
 ├─ execution layer (DSH agent) ── follows the plan
 │    ├─ Skills: opticforge-task / sheet / word / ppt / browser …
 │    ├─ MCP: desktop / browser / GitHub …
 │    ├─ Local: PowerShell / Python / file I/O
 │    └─ Search: general_search + web_fetch, only after web_gate opens
 │
 └─ opticforge_verify ── pre-delivery check (no network)
      ├─ citations / quantities / structure / wording
      ├─ KB-first: alignment verdict, URL dates and source detail
      ├─ cross: dimensions complete, each evidenced, coupling stated
      ├─ adoption: source tier, corroboration, KB conflict, staleness
      └─ calculation: formula_id, inputs, units, outputs, reproduction
```

**Boundary**: `assist` and `verify` are advisory and read-only. They do not search the web, write files or run commands. The execution layer does.

---

## 4. Five tools

| Tool | Layer | Purpose |
|---|---|---|
| `opticforge_assist` | assist | **Primary entry**. Problem → brief + evidence + routing + plan + search pack + acceptance + handoff |
| `opticforge_verify` | assist | Pre-delivery check. Accepts `text` or a `.md/.txt/.json/.csv` path; 0–100 score plus issue list. New inputs: `dimensions`, `relations`, `now` |
| `opticforge_search` | evidence | BM25 retrieval; chunk_id, score, matched terms, excerpt, source, section |
| `opticforge_get` | evidence | Full 9-field entry for one chunk_id |
| `opticforge_docs` | evidence | Catalogue of 40 sections and entry titles |

All tools share the envelope `{ ok, kb_version, action, ... }`.

### 4.1 A typical call

```json
{
  "problem": "Design a 400–1000 nm pushbroom hyperspectral imager: 5 nm spectral resolution, 0.5 m @ 1 km GSD, 30 km swath. Cover dispersion architecture, budgets and calibration.",
  "deliverable": "design report",
  "workspace": "D:/AI/projects/hyperspectral",
  "known_capabilities": ["sheet", "word", "general_search"]
}
```

`assist` activates up to three topic cards (here typically hyperspectral + spectrometer + optical design), fuses their required dimensions (spectrometer / aberration / detector / algorithm / circuit / calibration), and returns:

- `brief` — goal, deliverable, constraints, questions, `active_playbooks`
- `alignment` — `kb_queries`, `matched` / `unmatched`, `coverage_matrix`, `verdict` (`covered` / `partial` / `gap`) — all per dimension
- `dimensions` — one row per dimension with evidence, `hit_chunk_ids`, `concept_cards`, `gap_reason` and `source_matrix` (`kb`: covered/gap; `web`: not_required/required)
- `relations` / `cross_checks` — cross-domain constraints and points to address explicitly
- `plan.steps[]` — each with `capability`, `actions`, `routing`, `output`, `dimension_id`, `blocked_by`; coupled steps carry `coordinates_with` and are excluded from `parallelizable`
- `search_pack` — KB queries plus external query groups tagged `trigger` / `gated` / `gate_id` / `blocked_by` / `dimension_id`
- `handoff`, `acceptance`, `risks`

### 4.2 KB-first and the web gate

Call `assist` first. Run `alignment.kb_queries`, record matched/unmatched and `verdict`, then inspect `web_gate`. `alignment.verdict` describes **coverage only** — it never grants network access.

`web_gate` defaults to deny. One of four conditions must be met: `kb_gap`, `standard_version`, `vendor_params`, `price_timeliness`. Even then, a web query runs only when its condition is granted and the step's `blocked_by` is cleared. Web steps are never parallel with evidence collection. The bundled `skills/opticforge-task/SKILL.md` fixes the same workflow for DSH.

**Cross-dimension gaps are explicit.** A dimension with zero KB hits gets `source_matrix.web.status = "required"` and a bilingual `缺口·X` external query group; the deliverable must mark `covered_by_web` and the source tier. This closes the gap between "a query returned nothing" and "the plugin silently guessed".

### 4.3 Calculation and verification

`calc_specs` selects from 19 formula cards (formula, variables, units, assumptions, sanity range, worked example, KB source IDs). The plugin does not calculate. The execution layer computes and records `formula_id`, inputs, outputs, units and a reproduction path.

Export docx/pdf to `.md` / `.txt` with the word/pdf Skills before calling `verify`.

---

## 5. Adoption gate — the second gate

The web gate decides **whether** to search. The adoption gate decides **whether to trust and count** what came back. A cited URL with a date is not evidence of correctness.

| Criterion | Rule |
|---|---|
| Source tier | Primary sources (standard text, vendor datasheet, official manual, paper) are admissible. Secondary sources (blog, forum, aggregator, self-media) are marked `untrusted` — a lead, not a basis |
| Corroboration | Key figures (bandwidth, efficiency, temperature, accuracy) need ≥2 independent primary sources, or 1 primary source explicitly labelled "single source, to verify" |
| KB conflict | If a web fact conflicts with a present KB entry, mark `conflict_with_kb`; prefer the KB or explain the difference (test conditions / version / model) |
| Freshness | Price, model, standard-version and lead-time facts require an access date; beyond a threshold (e.g. 30 days for price) they are `stale` |

Only adopted web evidence flips a dimension from `gap` to `covered_by_web` and counts toward coverage. Untrusted or conflicting evidence is marked `unverified` and does not count. `verify` emits `adoption` with all four criteria and a pass flag; strict mode turns failures into errors.

`assist` pushes the requirement upstream: external query groups carry `require_source_tier: "primary"` and `min_corroborations: 2` for key figures, so retrieval looks for admissible sources instead of being rejected at delivery time.

---

## 6. Capability discovery

`assist` performs three read-only scans and degrades to empty lists with a note on failure:

1. **Skills** — common roots (`~/.dsh/skills`, `~/.agents/skills`, `~/Doubao/skills`, workspace `.skills` / `.user_skills`); reads `name` / `description` from `SKILL.md`.
2. **MCP** — common `.mcp.json` / `mcp.json` files; server names only, never credentials.
3. **Local assets** — with `workspace`, scans two levels for drawings, data, code and documents; names and sizes only.

DSH built-in Skills inside `app.asar` are not visible to filesystem scans. Pass `known_capabilities` (and `known_mcp`) to declare what is actually available this session; declared names rank first in routing.

---

## 7. Runtime knowledge base

### 7.1 Contents

40 sections / 324 entries / 308 `present`, organized by source type (A–E) or engineering theme (F–I):

| Series | Sections | Content | Entries |
|---|---|---|---|
| A–E | 9 | Rewritten from vendor documents: confocal sensors, spectrometer build, tolerancing, DOE, white-light interferometry, RCWA gratings, photodiodes, metrology standards | 67 (51 present) |
| F | 10 | Foundations: geometric optics, interference/diffraction, polarization, lasers, radiometry & colorimetry, thin films, detection & noise, spectroscopy, interferometry, materials & fabrication | 83 |
| G | 7 | Engineering: opto-mechanics, tolerance & uncertainty, thermal optics, spectral/radiometric calibration, inspection & image processing, COMSOL, SolidWorks | 53 |
| H | 8 | Frontier: metasurfaces & DOEs, waveguides & photonic integration, quantum optics, hyperspectral imaging, laser triangulation/confocal/lidar, field failures, frontier topics, semiconductor sources | 61 |
| I | 6 | Scenarios: aberration judgement, physical optics & transfer functions, optical testing, optical design, hyperspectral pushbroom/snapshot, Czerny–Turner and Offner spectrometers | 60 |

Concept cards are grouped into 8 domains: IM53 / QE33 / MT65 / DT26 / TF67 / EL3 / DS53 / AL8. These domain IDs are the bridge to the v3 content map described in §2.3.

### 7.2 Accuracy rules

Enforced by `scripts/build-kb.mjs`:

**A–E (source-backed, 67 entries)** — `chunk_id` set equals the vendor snapshot exactly; entries are rewritten facts (`is_original_excerpt = false`) beginning with `【title】`; every number appears verbatim in the source chunk; no verbatim vendor text ships publicly (`_kb-raw/` stays local).

**F/G/H/I (compiled, 257 entries)** — no single source; consensus of textbooks, standards and reviews; `source` names a real reference; text ≥300 chars with at least three field lines; `disclaimer` states "非原文摘录"; no product model numbers or vendor specifications.

### 7.3 Gaps

Three source-level gaps: A03 (peak-localization review, 1), C01 (ZYGO CSI white paper, 5), E01 (JJF 1990-2022, 6). In total 16 non-present entries: 11 `missing_source`, 5 `substitute` (comparable public material, explicitly marked as not the original). `assist` lists these as `library_gaps`; `verify` treats citing a non-present entry as an error. Two topics are intentionally out of scope: lithography process and space optics. An empty result means no basis — nothing is invented.

---

## 8. Layout

```
lib/index.js                tool registration (5 tools)
lib/assist.js               intake, evidence, routing, plan, acceptance
lib/capabilities.js         read-only Skill / MCP / asset scan
lib/verify.js               pre-delivery check + adoption gate
lib/kb-engine.js            BM25 engine
lib/kb-data.js              data loading
data/kb/                    40 section files (human-readable, git-diffable)
data/kb-data.json           merged runtime artefact
data/kb-meta.json           version, sha256, sections, gap topics (generated)
data/assist-playbooks.json  16 topic cards
data/concept-cards.json     308 atomic concept cards
data/cross-dimensions.json  6 generic fallback dimensions
data/formula-cards.json     19 formula cards, no calculator
skills/opticforge-task/     KB-first DSH workflow Skill
eval/                       KB-first + cross contract evaluation; real-trace scoring
docs/ARCHITECTURE.zh.md     architecture and extension points
```

---

## 9. Install

**From the plugin market** (listing submitted): search `OpticForge`.

**Local link install** (development):

```bash
node scripts/install-local.mjs            # write profile dependency + bundles + directory link
node scripts/install-local.mjs --dry-run  # preview only
node scripts/install-local.mjs --uninstall
```

Restart DSH afterwards. Editing this repo and restarting picks up changes. The installer links `skills/opticforge-task` to `~/.dsh/skills/opticforge-task`; it never overwrites a real directory, and uninstall removes only the link.

---

## 10. Development

```bash
node test/run.mjs                              # integration tests
node test/assist-contract.test.mjs             # assist contract (24 cases)
node test/entry-contract.test.mjs              # entry contract (5 cases)
node scripts/verify-all.mjs                    # release gate (57 checks)
node eval/run-kb-first.mjs                     # 13 task classes + cross contracts
node scripts/build-kb.mjs --all --version 3.1.0
node scripts/build-kb.mjs --check
node eval/run-kb-first.mjs --trace <trace.jsonl>   # real tool-trace scoring
```

Edit knowledge: `data/kb/<section>.json` → `--doc` validate → `--all` rebuild → tests. Rebuild regenerates concept cards and `kb_version`.
Edit topic cards: `data/assist-playbooks.json` — no code change needed.

`.github/workflows/test.yml` runs the same gates on Ubuntu and Windows, Node 20 and 22.

---

## 11. Boundaries

- Only the 40 sections in §7; lithography process and space optics are not covered.
- Compiled entries are engineering summaries — check `source` before external citation.
- Vendor numbers appear only where a source snapshot exists.
- Gap entries state what is missing; they are not evidence.
- The plugin does not access the network or perform actions.
- `verify` is text-level only; export docx/pdf to text first.
- `alignment.verdict` reports coverage, not permission to search; web access follows `web_gate`.

## License

MIT. Third-party material remains the property of its authors; this repository contains rewritten engineering facts with source attribution only.

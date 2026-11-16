# OpticForge

A **task assistant plugin** for optical engineers, built for DeepSeek Harness (DSH).
Give it one concrete problem; it returns an executable package: brief, knowledge evidence, capability routing, staged plan, targeted search queries and acceptance checks.

Pure Node.js, zero runtime dependencies. **1.2.0 makes KB-first an inspectable execution contract and adds a DSH Skill plus formula cards; the plugin still performs no network or external actions.**

> 中文文档见 [README.zh.md](README.zh.md)。

---

## Why it exists

Optical design, alignment and acceptance work is blocked less by formulas than by three things:

1. **Scattered evidence** — clear-aperture conventions, which tolerance number matters, pixel count for a spectrometer, confocal range selection: all buried in manuals, standards and papers.
2. **Unclear path** — you know you need to search, compute, draw and write, but not in what order, with which Skill, or what can run in parallel.
3. **Weak delivery** — a report that looks right until someone checks citations, units, assumptions and gaps.

OpticForge handles all three:

- **Evidence layer**: 40 sections, 324 source-attributed fact entries; hits carry chunk_id, source and excerpt; no basis is stated as such.
- **Routing layer**: classify the problem, inspect local Skills / MCP / workspace assets, and produce a capability-tagged plan. `alignment` fixes KB queries and coverage first; `web_gate` controls when external search is allowed.
- **Verification layer**: check citations, quantities, the KB-alignment section, external-source dates, formula-card traces, assumptions, gaps and reproducibility.

---

## Three layers

```
Problem
 │
 ├─ opticforge_assist ── intake & routing
 │    ├─ brief           goal / deliverable / constraints / questions
 │    ├─ alignment       KB queries / matched / unmatched / verdict
 │    ├─ web_gate        closed by default; opens for gaps, versions, vendors, freshness
 │    ├─ evidence        KB chunks + coverage matrix + gaps
 │    ├─ capabilities    local Skills / MCP / workspace assets
 │    ├─ calc_specs      formula cards, never a calculator
 │    ├─ plan            staged steps; web steps carry blocked_by
 │    ├─ search_pack     KB queries + conditional external queries
 │    └─ acceptance      checklist + risks + handoff Markdown
 │
 ├─ execution layer (agent) ── follows the plan
 │    ├─ Skills: opticforge-task / sheet / word / ppt / browser …
 │    ├─ MCP: desktop, browser, GitHub …
 │    ├─ Local: PowerShell / Python / file I/O
 │    └─ Search: general_search + web_fetch only after web_gate opens
 │
 └─ opticforge_verify ── pre-delivery check
      ├─ citations: chunk_id exists and is present
      ├─ quantities: numbers carry a citation or a calculation note
      ├─ structure: assumptions / gaps / reproduction / sources
      ├─ KB-first: alignment verdict, URL dates and source details
      ├─ calculation: formula_id, inputs, units, outputs and reproduction
      └─ wording: absolute or marketing claims
```

**Boundary**: the plugin does not access the network or perform external actions. It decides *how* to do the work; the execution layer actually does it.

---

## Five tools

| Tool | Layer | Purpose |
|---|---|---|
| `opticforge_assist` | assist | **Primary entry**. Problem → brief + evidence + routing + plan + search pack + acceptance + handoff |
| `opticforge_verify` | assist | Pre-delivery check. Pass `text` or a `.md/.txt/.json/.csv` path; returns a 0–100 score and issue list |
| `opticforge_search` | evidence | BM25 retrieval with chunk_id, score, matched terms, excerpt, source, section |
| `opticforge_get` | evidence | Full 9-field entry for one chunk_id |
| `opticforge_docs` | evidence | Catalogue of 40 sections and entry titles |

Shared envelope: `{ ok, kb_version, action, ... }`. `assist` and `verify` echo `kb_version` too.

### One call

```json
{
  "problem": "Design a 400–1000 nm pushbroom hyperspectral imager: 5 nm spectral resolution, 0.5 m @ 1 km GSD, 30 km swath. Give the dispersion architecture, budgets and calibration flow.",
  "deliverable": "design report",
  "workspace": "D:/AI/projects/hyperspectral",
  "known_capabilities": ["sheet", "word", "general_search"]
}
```

The returned `plan` splits the task into: clarify → evidence → local inventory → specifications → architecture → budgets → calibration → external verification → delivery → self-check → close-out. Each step carries:

- `capability`: `kb` / `calc` / `skill_sheet` / `skill_doc` / `web_search` / `verify` …
- `actions`: concrete moves such as `opticforge_search("pushbroom ground sample distance")` or "build the budget table with the sheet Skill"
- `routing`: candidate Skills, tools, MCP servers, plus fallbacks
- `output`: what this step must produce

`handoff` is Markdown ready to hand to a sub-agent: goal, evidence, execution order, acceptance.

**KB-first contract**: call `assist`, run `alignment.kb_queries`, record matched/unmatched and `verdict`, then inspect `web_gate`. External search is conditional on a KB gap, standard-version check, vendor specification, price or other time-sensitive fact. External groups carry `trigger/gated/gate_id/blocked_by`; only `gated=true` queries may run, and web plan steps carry `blocked_by`. The bundled `skills/opticforge-task/SKILL.md` gives DSH the same workflow.

`calc_specs` selects from 19 formula cards with formulas, units, assumptions, sanity ranges, worked examples and KB source IDs. The execution layer performs calculations and records `formula_id`, inputs, outputs, units and reproduction steps. Export docx/pdf to `.md`/`.txt` with the word/pdf Skills before calling `verify`.

---

## Capability discovery

`opticforge_assist` performs three read-only scans:

1. **Skills**: common roots (`~/.dsh/skills`, `~/.agents/skills`, `~/Doubao/skills`, the Doubao workspace `.skills` / `.user_skills`), reading `name` / `description` from `SKILL.md`.
2. **MCP**: common `.mcp.json` / `mcp.json` files; server names only, no credentials.
3. **Local assets**: with `workspace`, scans two levels for drawings, data, code and documents, ranked by filename relevance; names and sizes only.

Failures degrade to empty lists with a note, never block the task. `known_capabilities` lets the caller declare what is actually available this session; `known_mcp` does the same for MCP servers. Declared names rank first.

---

## Knowledge base (1.2.0, content baseline unchanged)

**40 sections, 324 entries, 308 usable** (`status=present`):

| Series | Sections | Content | Entries |
|---|---|---|---|
| A–E | 9 | Rewritten from vendor documents: confocal sensors, spectrometer build, tolerancing, DOE, white-light interferometry, RCWA gratings, photodiodes, metrology standards | 67 (51 present) |
| F | 10 | Foundations: geometric optics, interference/diffraction, polarization, lasers, radiometry & colorimetry, thin films, detection & noise, spectroscopy, interferometry, materials & fabrication | 83 |
| G | 7 | Engineering: opto-mechanics, tolerance & uncertainty, thermal optics, spectral/radiometric calibration, inspection & image processing, COMSOL, SolidWorks | 53 |
| H | 8 | Frontier: metasurfaces & DOEs, waveguides & photonic integration, quantum optics, hyperspectral imaging, laser triangulation/confocal/lidar, field failures, frontier topics, semiconductor sources | 61 |
| I | 6 | Scenario-focused: aberration judgement, physical optics & transfer functions, optical testing, optical design, hyperspectral pushbroom/snapshot, Czerny-Turner and Offner spectrometer design | 60 |

### Gaps

**Only three source-level gaps remain**: A03 (Acta Optica Sinica peak-localization review, 1 entry), C01 (ZYGO CSI white paper, 5 entries) and E01 (JJF 1990-2022, 6 entries). Their verbatim clauses were never obtained. In total 16 non-present entries: 11 `missing_source`, 5 `substitute` (comparable public material, explicitly marked as not the original).

`opticforge_assist` lists them as `library_gaps`; `opticforge_verify` treats a citation to a non-present entry as an error.

Two topics remain intentionally out of scope: lithography process and space optics. An empty result means no basis — nothing is invented.

### Accuracy rules

Two section types, two rule sets, enforced by `scripts/build-kb.mjs`:

**A–E (source-backed, 67 entries)**

- `chunk_id` set must equal the vendor snapshot exactly
- Rewritten as fact entries (`is_original_excerpt = false`), text starts with `【title】`
- **Every number must appear verbatim in the source chunk**
- No verbatim vendor text ships publicly; `_kb-raw/` stays local

**F/G/H/I (compiled, 257 entries)**

- No single source; consensus of textbooks, standards and reviews, each `source` naming a real reference
- Text ≥ 300 chars, at least three field lines, `disclaimer` must state "非原文摘录"
- **No product model numbers or vendor specifications**

---

## Layout

```
lib/index.js           tool registration (5)
lib/assist.js          intake, evidence, routing, plan, acceptance
lib/capabilities.js    read-only Skill / MCP / asset scan
lib/verify.js          pre-delivery check
lib/kb-engine.js       BM25 engine
lib/kb-data.js         data loading
data/kb/               40 section files
data/kb-data.json      merged runtime artefact
data/kb-meta.json      version, sha256, sections, gap topics
data/assist-playbooks.json  task playbooks
data/formula-cards.json 19 formula cards, no calculator
skills/opticforge-task/ KB-first DSH workflow Skill
eval/                  KB-first contract evaluation + optional real-trace scoring
docs/ARCHITECTURE.zh.md     architecture and extension points
```

---

## Install

**From the plugin market** (listing submitted): search `OpticForge`.

**Local link install** (development):

```bash
node scripts/install-local.mjs
node scripts/install-local.mjs --dry-run
node scripts/install-local.mjs --uninstall
```

Restart DSH afterwards. Editing this repo and restarting picks up changes. The installer also links `skills/opticforge-task` to `~/.dsh/skills/opticforge-task`; it never overwrites a real directory, and uninstall removes only the link.

---

## Development

```bash
node test/run.mjs
node scripts/verify-all.mjs
node eval/run-kb-first.mjs
node scripts/build-kb.mjs --all --version 1.2.0
node scripts/build-kb.mjs --check
```

Editing the knowledge base: edit `data/kb/<section>.json` → `--doc` validate → `--all` rebuild → tests.
Editing playbooks: edit `data/assist-playbooks.json`; no code change needed.

`.github/workflows/test.yml` runs the same gates on Ubuntu and Windows for Node 20 and 22.

---

## Boundaries

- Only the 40 sections above; lithography process and space optics are not covered
- Compiled entries are engineering summaries — verify against `source` before citing externally
- Vendor numbers appear only where a snapshot exists
- The 16 gap entries state what is missing; they are not evidence
- The plugin does not access the network or perform actions
- `verify` is text-level only; export docx/pdf to text first

## License

MIT. Third-party material remains the property of its authors; this repository contains rewritten engineering facts with source attribution only.

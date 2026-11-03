# Markdown outline structures

Content structure definitions are supplied only by ready `.md` documents uploaded to Skills & Rules (`category: rules`) and authorized in Draft Outline's file access. No built-in content structures or AI-inferred dropdown choices exist. Ordinary narrative guides remain reference context. The explicitly identified `02-outline-generator.md` also supports its existing heading/list format as described below.

Declare a fenced block with language `outline-structures`. The body is strict JSON with `version: 1` and `structures: []`. Each array entry requires these fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable lowercase ASCII letters/digits/hyphens, maximum 80 characters; unique across authorized files. |
| `name` | Display name from the MD. |
| `description` | Short explanation displayed with the choice. |
| `useWhen` | Intended use cases. |
| `outlineInstructions` | Full layout instructions for outline creation. |
| `draftInstructions` | Instructions for expanding that outline into a final article. |
| `requiredHeadings` | Optional ordered array of objects with `heading` and `level` (`h2` or `h3`). These are exact headings, checked case-insensitively with normalized whitespace. Use an empty array when headings should vary by topic. |

Empty declaration (does not add any option):

```outline-structures
{"version":1,"structures":[]}
```

Add real entries only from the owner's approved content instructions. This document defines the transport/schema and deliberately supplies no editorial templates. Other prose-only MD must be given an explicit declaration before it can populate the dropdown.

## Existing `02-outline-generator.md`

The owner identified this file as the canonical generator. A deterministic compatibility reader accepts its existing `## Select a form` bullet list and `## Comparison forms` / `###` subheadings. Explicit comparison subheadings become choices; list entries become choices except a grouping entry that explicitly says to select forms below. Names, descriptions and instructions come directly from the MD. Shared sections remain part of the outline snapshot; Preparation, Depth and visuals and Final checks also accompany the selected draft instructions. No source text or default content layouts are bundled in application code.

The local library file inspected on 2026-11-03 yields seven choices: Type A: Format versus format; Type B: Concept versus concept; Type C: Multiple options or no genuine rivalry; Narrative-led; Myth-busting; Pattern-led; Q&A-led. This list documents inspection only; the runtime derives choices from the uploaded file. Adding a sibling comparison subheading or a leaf bullet updates the catalog without changing code. For other filenames or stable IDs independent of renaming, use the structured block schema. If both formats exist, explicit structured blocks take priority.

## Lifecycle

- `shared/outlineStructures.ts` owns parsing, provenance, deterministic source revision hash, outline task assembly, stage-specific structure guidance and ordered heading validation. `OUTLINE_OPERATIONAL_STAGES` is shared by frontend/backend registries; it defines execution contracts, not content layouts.
- Workflow AI omits the outline catalog; uploaded Markdown in Knowledge & Rules remains its authority. Batch/single selectors show authorized definitions and parse/duplicate errors. Duplicate IDs are excluded, never chosen arbitrarily. Empty catalog blocks new outline creation and explains how to load MD.
- Batch selects a structure before activity creation. Every article receives an independent JSON snapshot; backend resolves the submitted selection against the current authorized catalog. Single selects at Draft Outline.
- Snapshot contains the full definition, source ID/name and content hash. The hash detects revisions; it is not a security signature. Updating MD does not mutate running or saved articles. Re-select an updated definition explicitly to adopt it.
- Single and batch use the shared task/structure builders. MD layout supplements immutable Article Spec, evidence and JSON contracts. System workflow instructions continue to govern language, source safety and persistence.
- Changing selection preserves stored outline/draft and marks both stale; editorial approval is reset. Generation must rebuild the outline before a draft can be generated. Active batch selections cannot be changed mid-run.
- Final drafting consumes the same frozen definition and approved outline, preserving every heading and its order. Batch recovery/compaction also receives the frozen structure. Required heading checks run after generation and compaction and before drafting; failures stop saving the new outline rather than inventing headings or evidence.
- Existing records without a snapshot remain readable. They must select a structure before generating a new outline. The legacy `comparisonStructure` field is retained for storage compatibility only and no longer supplies layout instructions.

## Verification

Run `node --test shared/outlineStructures.test.ts`, frontend/backend TypeScript checks and the production build. Regression coverage includes MD-only/authorized sources, malformed declarations, duplicate IDs, frozen revisions and heading order/levels. Browser-check empty catalog, populated single/batch selectors, selection source display and stale-output notices without production AI calls.

## Universal QC v10

Both execution modes share `outlineReviewInstruction`, `outlineQualityChecks` and `semanticReviewInputFingerprint`. Reader-outcome checks the selected frozen MD layout without imposing another form's sections; all six semantic check IDs remain stable. Explicit MD required headings and approved H2/H3 heading order/levels are deterministic checks on the outline and assembled draft. H3 needs an H2 parent; no arbitrary H3 quota is imposed. Generic conclusion assembly remains permitted.

The introduction contract remains one 60–85 English-word paragraph, approximately 5–6 desktop reading lines; responsive visual line count is never a deterministic failure. Single/batch generation, recovery and review preserve this authority.

QC identity includes the frozen definition, outline, evidence mapping, draft, spec, target and other source/rule inputs. The current contents of the selected generator MD are excluded: the frozen snapshot already supplies that input. Editing/replacing that MD does not silently invalidate an unchanged article; explicitly selecting its new version does. Other evidence source changes still invalidate QC. QC v9 reports require a one-time explicit re-check after upgrading.

Incomplete/malformed semantic responses are review-process states, not invented content failures. Preserve the draft, mark a blocking `semantic-review-schema` warning, name missing checks and offer explicit Re-check & Fix. Batch persists process reports and semantic identities/checks for browser continuation; provider/schema failures cannot mark an article complete. Advisory content warnings remain non-blocking except evidence and explicit blocking violations. No paid automatic browser retries are added; explicit re-check may request missing checks.

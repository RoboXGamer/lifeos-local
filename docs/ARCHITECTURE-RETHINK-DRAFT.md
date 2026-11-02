# LifeOS architecture rethink — draft milestone plan

**Status:** Design and implementation plan for discussion; not implemented.

**Purpose:** Establish a long-term data and feature architecture while making LifeOS easier to use, not harder to configure.

**Relationship to existing roadmap:** This is a separate draft. It does not claim that the current [`plan.md`](../plan.md) has been replaced or that its existing features have been migrated.

**Revision:** Section 4A proposes a concrete fixed model. Section 4B compares d1, a small span extractor, and an existing local LFM3 structured-output model. The user's preferred direction is **one model call directly to the fixed output**, not a multi-model or semantic-parser pipeline. This is a proposed architecture with explicit test gates, not implemented product behaviour.

## 1. Product idea: LifeOS supplies the framework

People should be able to put their life into LifeOS in their own words. They should not have to decide what database type, schema, relation, plug-in or hierarchy to create before capturing something.

LifeOS supplies a small, opinionated framework. A user can capture, find and act on information with sensible defaults. The system can organize the details behind the scenes and ask a normal-language question when an important ambiguity actually matters. Users can inspect and correct its interpretation.

The product is extensible like a game with add-ons: a small core provides shared rules and built-in feature modules add capabilities such as finance. This is an architectural choice; it must not turn everyday life management into a mod-management exercise.

### Non-negotiable product rules

1. **Capture first.** A quick capture must work without selecting a type, relationship, area or add-on. Raw text remains accessible and searchable, even if no interpretation is available.
2. **Fixed vocabulary.** Do not ask users to create item types, define schemas or choose among arbitrary relation types. Keep Task, Note, Event, Expense and Income as the initial familiar product vocabulary; test their semantics before deciding whether any change is needed.
3. **No invented facts.** Missing information stays unknown. A quote is not a commitment, a plan is not a completed action, and a mention is not proof of a payment or a relationship.
4. **Ask less, but ask when it matters.** Offer a short, contextual clarification only when alternatives materially change the result or an action requires a missing detail. A user can defer it and still keep the capture. Routine captures do not require a review session: optional suggestions can wait until useful, while explicit manual actions work normally.
5. **One coherent experience.** Built-in add-ons should be available in context, with no installation or configuration required for normal use. A user may opt out of a feature without losing their data.
6. **Local by default.** Basic capture, viewing and manual editing work without AI or an internet connection. Optional local AI helps interpret and retrieve; it is not the only path.
7. **Truthful history.** Record meaningful changes with their source and time. Imported current state is not a fabricated historical timeline.

## 2. Current baseline and why it needs rethinking

The existing item system is the starting point, not a feature to discard. The `items` table already has a workspace, optional type, title, description, area, parent item, tags and task/money fields. Types are fixed to Task, Note, Event, Expense and Income ([schema](../src-tauri/migrations/0002_lifeos.sql), [types](../src/local/types.ts)). The UI and CLI can capture an initially untyped item; current area assignment requires a type ([API](../src/local/api.ts)).

The local service is the shared write boundary for desktop and CLI; SQLite transactions and live snapshots already exist ([service design](CLI-ARCHITECTURE.md), [storage](../server/storage.mjs)). Preserve that single authority while changing its internals. No second backend is needed.

The recent features are useful evidence, not constraints on the new architecture:

| Current implementation | Observation for the rethink |
|---|---|
| Item hierarchy and tags | Useful for organizing, but a single `parentId` and tags do not fully express independently shared context. |
| Ordinary Expense/Income item | `amount` is `REAL`, with Planned/Spent or Expected/Received; the item schema does not record currency. The simple state cannot by itself describe a partial payment against an expected total. |
| Promise-to-payment | Separate engagement, source, commitment, invoice, payment and allocation tables; payments also create ordinary financial items ([migration](../src-tauri/migrations/0007_obligations.sql)). This needs a clear single authority, not two amounts that can drift. |
| Habits and goals | Separate habit, goal and activity records already distinguish planned activity, actual activity and outcome, including corrections ([habits guide](HABITS.md)). Reassess the ownership and reuse of these concepts. |
| Projects | A project is currently registered against an item; its sources and checkpoints are separate tables ([migration](../src-tauri/migrations/0006_projects.sql)). |
| Automation events | `itemMutationEvents` provides identity/provenance for specific automation inputs. It is not a complete, replayable event store ([migration](../src-tauri/migrations/0009_feature_integrations.sql), [implementation](../src/local/automations.ts)). |
| State delivery | The current `DbState` snapshot explicitly lists feature-specific collections ([store](../src/local/store.ts)). That couples core delivery to every feature; benchmark a more modular read boundary before claiming scale. |

The repository currently enforces a 500-items-per-workspace V1 limit ([API](../src/local/api.ts)); long-term capacity and full-snapshot costs need measurement, not assumptions. Existing event items are currently displayed using the shared date field; a date-only value must not be mistaken for a confirmed meeting time or duration.

## 3. Decisions and hypotheses

### Decisions for this draft

- Keep the small, fixed user-facing vocabulary and unclassified inbox capture. No dynamic type or relation builder is required.
- Design a **meaningful append-only event-sourced core** and durable reactions. The design must prove rebuild, correction, deletion and safe side-effect behaviour before cutover. SQLite remains the starting storage engine.
- Organize features as first-party add-ons with explicit boundaries. **Finance is the first boundary to prove**, and should be usable by default without plug-in setup.
- Desktop, CLI, AI proposals and add-ons use the same service-owned commands and validation. There is one authoritative write path for each fact.
- Preserve existing data and user-controlled content across migration; recent feature implementations may be redesigned or removed after an equivalent verified path exists.

### Working hypothesis, to prove in Milestone 1

Use a common item identity and the current fixed item vocabulary, supported by a **small set of system-defined records** for meaning that cannot safely live in one item field. Candidates are links to context, source/evidence, dated observations and money commitments/payments. These are internal modelling concepts, not a list of new mandatory user choices.

Prefer the least expressive model that passes the scenarios. Compare these alternatives using the same examples before freezing a contract:

| Candidate | Strength | Risk to test |
|---|---|---|
| A. Exclusive item type + linked records | Preserves the current mental model; explicit invariants. | One real-world thing may need awkward duplicate items or confusing retyping. |
| B. Common item + fixed built-in aspects | A task can also carry a relevant date or note without a new object. | Too many allowed combinations can recreate the dynamic schema problem; completion and meaning may become unclear. |
| C. Exclusive primary item type + narrowly allowed built-in aspects + typed supporting records | Retains familiar types while allowing a few justified overlaps and domain-specific facts. | Needs disciplined ownership and explicit rules to avoid becoming an unrestricted aspect system. |

**Preferred starting candidate: C.** It is a hypothesis, not a claim that the existing model is wrong or that every aspect listed below must be implemented. An aspect is added only when a concrete user action, invariant and test justify it. For example, adding a date to a task is not the same as making that task a calendar event.

## 4. A small model with clear meanings

These are **system concepts**. Their names do not need to appear in the capture UI.

| Concept | Question it answers | Example and rule |
|---|---|---|
| **Item** | What is the user tracking? | A note, task, scheduled event, expense or income; stable ID and workspace. |
| **Context** | What does this relate to? | Wedding, car, project or person. Start from existing item families; use additional system-owned identity/link records only where the corpus proves they are needed. A contact must not be forced into a new user-facing item-type menu. |
| **Plan or commitment** | What is intended, expected or agreed? | Task due Friday; proposed vendor quote; agreed ₹1,00,000. Proposed and agreed are different states. |
| **Occurrence** | What actually happened? | A payment was recorded or an activity was logged. It must not be inferred merely because a plan exists. |
| **Observation** | What value was recorded, about what and when? | Weight 78 kg; 35 minutes of practice. A value, unit, relevant date and correction history may matter. |
| **Source** | Where did this information come from? | A note, user entry, imported document or AI proposal. A source can support a suggestion without making it true. |
| **Recorded change** | What changed in LifeOS, and why? | `PaymentRecorded`, `ItemArchived` or a correction; the authoritative history for event-sourced domains. |

Keep these distinctions separate: a **calendar Event** is a scheduled item; an **occurrence** is something that happened in life; an **event-store event** is a recorded change in the application. None automatically implies the others.

### Built-in semantics, not arbitrary relationships

The system may store a small fixed set of relationships such as “belongs to”, “related to”, “involves contact”, “depends on”, and domain-specific payment allocation. These are examples to test, not a public menu the user must master. Contextual actions such as “add to this project” or “record a payment” create the corresponding links. Plain relatedness must not be promoted to a stronger claim such as “owes” without evidence or confirmation.

An untyped capture can remain untyped indefinitely. Identical names do not establish identical people. A user can correct an incorrect match. Whether a contact is a separate built-in record or represented by an existing item is an explicit Milestone 1 decision; the acceptance cases, not desire for a generic graph, decide it.

### Example: one capture, no schema design

> “Amit quoted 1 lakh for sound for the wedding. I paid 30k; remind me Friday.”

1. Save the input immediately; no type, add-on, area or link selection required.
2. If a local interpreter is available, propose a sound quote, a recorded payment, a follow-up and their possible context. The source remains linked to the proposal.
3. **Do not assume** which Amit/wedding is meant if multiple match; do not assume the quote was agreed, the currency if unspecified, or that the ₹30k settles that quote. Show unknowns; ask a short question only when needed to act or calculate reliably.
4. After user review, create the necessary records through their owning service commands. The user can change or reject individual suggestions. Without AI, they can leave the capture as-is or use ordinary manual actions.

When the user explicitly confirms that the quote is agreed in INR and the ₹30,000 payment is allocated to it, the view may show agreed ₹1,00,000, paid ₹30,000 and remaining ₹70,000. It must not count the ₹30,000 again as an additional expense on top of that agreed amount.

## 4A. Concrete proposed data model

The original draft described concepts but did not specify how to store them. This is the proposed v1 model to implement and challenge with the milestone corpus. Names below are logical records, not a promise of final SQL table names or extra choices in the UI.

**Core design:** one identity for a thing, one of the existing five kinds for an item, a few system-controlled relationships, raw sources, and a journal of accepted changes. Domain modules own the extra structure needed for their calculations. AI interpretations remain distinct from user-confirmed records.

| Record and owner | Fixed fields / constraints | What it represents |
|---|---|---|
| `Object` — core | `id`, `workspace_id`, `class` = `item` or `contact`. Every ID is stable within its workspace. | Common identity so a link can point to either an item or a person/organization. Not a user-facing type picker. |
| `Item` — core | `object_id`, `kind` = `null`, `task`, `note`, `event`, `expense`, `income`; `title`, optional `description`, `area_id`, `archived`. Item is one-to-one with its Object. | The existing LifeOS item model. `null` means unclassified; it is a valid lasting state. |
| `TaskDetails` — core | `item_id`, `status` = `todo`, `in_progress`, `done`, optional `due_date` and optional `scheduled_for`. Only a Task may have this record. | Action state. Scheduling to work on a task is different from a deadline. |
| `EventDetails` — core | `item_id`, optional start/end and timezone, and date-only vs date-time precision. Only a calendar Event may have this record. | An appointment or occasion. Unknown time stays unknown. |
| `Contact` — core | `object_id`, display name, optional contact details. Optional `person`/`organization` classification can remain unknown. | One identity can appear in many items and roles. Existing unresolved names need not instantly become contacts. |
| `Link` — core | `id`, `workspace_id`, `from_id`, `to_id`, fixed `kind` = `parent`, `related`, `involves`, `blocks`; optional system-defined role and evidence. | `parent` provides a hierarchy; `related` is intentionally weak; `involves` connects a contact; `blocks` is an explicit dependency. Same-workspace endpoints required. Roles are not invented user types. |
| `Source` — core | `id`, `workspace_id`, content/reference, captured-at time, origin and optional attachment; source version and location/span where available. | Original capture or evidence. Separate managed content from event metadata where deletion requires it. |
| `Evidence` — core | `source_id`, target record/field, optional exact source span or image region, origin, interpretation state. | Why a record or proposal exists. Extracted spans are pointers to source, not proof the model is correct. |
| `FormulaDefinition` — core framework, definitions owned by core/add-ons | Stable ID, version, owner, allowed input types, result type, safe expression or registered calculation, workspace/context scope. | A reusable way to derive an answer from connected records. Users do not need to create a formula for ordinary use. |
| `FormulaResult` — derived read model | Formula ID/version, scope, value and unit, evaluation time/as-of point, input references, completeness/error state. | A rebuildable computed value, never an independently editable financial fact. |
| `Proposal` — AI layer | `id`, target command and validated arguments, source/evidence references, model/version, question set, score/found where returned, and `suggested`/`accepted`/`rejected`. | A non-authoritative interpretation. Reprocessing can replace a proposal; it must not silently rewrite a confirmed record. |
| `DomainEvent` — core infrastructure, contracts owned by core/modules | Event ID, workspace, stream ID/version, event name/schema version, recorded time, optional effective time, actor, causation/correlation and payload/references. | An authoritative accepted change such as `ItemCaptured` or `PaymentRecorded`. These events rebuild the owning projection. |

All records use explicit workspace scope; cross-workspace links and allocations are rejected. Current-state Item, Link and finance tables are projections of their owning event streams, not independent authoritative copies. Source text/attachments are stored separately with retained references and explicit deletion/redaction semantics, so replay after deletion reconstructs redacted state rather than silently restoring deleted content. AI proposals can be recomputed or discarded; only an accepted command appends authoritative domain events.

### Finance add-on: exact records and ownership

An Expense or Income item is still the familiar user-facing entry. Finance owns its money semantics. The core displays the Item; it does not separately maintain a writable financial balance.

| Record | Fields and meaning |
|---|---|
| `MoneyItem` | `item_id` (one-to-one with the Expense/Income item); direction = outgoing/incoming. It groups what is expected and what actually happened. |
| `MoneyTerms` | `id`, `money_item_id`, state = proposed/agreed/cancelled, amount, currency, optional due date and source. Amendments are explicit changes to the same terms/history; a quote is not automatically agreed. |
| `Payment` | `id`, `money_item_id`, actual date if known, amount, currency, direction, optional counterparty and source; correction/refund has an explicit link. Several payments may belong to one MoneyItem. |
| `Allocation` | `id`, `payment_id`, `terms_id`, allocated amount/currency. A payment can be partially allocated; total allocations cannot exceed the eligible payment or use another currency without an explicit conversion design. |

Store exact monetary values as integer minor units when currency and precision are known. If currency or exact conversion is unknown, preserve the original text/value and leave the normalized amount unavailable rather than inventing INR or rounding silently. An invoice can be a finance-owned document/claim record when needed; do not add it to the core item-type menu. Finance add-on owns the invariants and accepted events for all these records. A change to one fact has one write path; summaries are calculated projections.

For a simple historical payment with no underlying agreement, a Payment can exist without MoneyTerms or Allocation; the item itself supplies context. If money is a quote only, no Payment exists. A refund/correction never overwrites the original payment. Financial totals must say whether they mean quoted, agreed, invoiced, paid or allocated; these are not interchangeable.

### One input mapped to records

Input on **2026-11-02**, in `Asia/Kolkata`:

> “Amit ne wedding sound ke liye ₹1 lakh quote diya. Friday ko call karna hai.”

Example target after review/correction; illustrative, not observed model output:

```text
Source S1: original text; captured 2026-11-02
Item I1: unclassified capture, points to S1
Proposal P1: Task “Friday ko call karna hai”; scheduled for 2026-11-06
Proposal P2: Expense → MoneyTerms: proposed, INR 100000, “wedding sound”
Candidate: “Amit” may refer to Contact C1; unresolved until identity is safe
Context: may relate to existing wedding Item W1; unresolved until identity is safe
```

The Friday date is derived by date handling from the capture date/timezone and the extracted phrase, not assumed from a bare weekday. It is a proposed work date, not a claim that Friday is a deadline. Only when accepted, create the Task/Expense items and their event streams; retain links to S1. Present the capture and its suggestions together so separate records do not produce duplicate inbox clutter. No Payment is created because the input never says money was paid. A candidate match can be shown without automatically making it a confirmed contact/link. A low-risk suggestion may be left pending without forcing the user into a review workflow.

Later input: “Amit ₹90,000 mein maan gaya; ₹30,000 advance diya.” After the user’s intent and the right contact/expense are established, finance records agreed terms for ₹90,000 and a separate ₹30,000 payment/allocated amount. The ₹1 lakh quote remains historical evidence; it is not added to ₹90,000. The calculated remainder is ₹60,000. If the connection or currency is uncertain, leave it unresolved rather than manufacture a remainder.

### Examples outside finance

- **Car service:** an existing Item can anchor a service task and receipt via core links; the car can remain a Note-like item. A mileage measurement becomes a progress-module observation only when there is a supported reason to capture it structurally. Otherwise preserve the source text.
- **Habit:** progress add-on owns `Activity(value, unit, effective_date, task_id?, habit_id?)` and links to goals. `35 minutes` is one activity, not a second task completion. Corrections append events; projections calculate progress once.
- **Person:** one Contact can be involved in several items; `client` or `vendor` is a contextual role where confirmed, not a new permanent person type.
- **New unforeseen detail:** preserve it in Source/Note; d1 can search it semantically later. It only becomes an authoritative typed value when an existing core/add-on contract can represent and validate it.

The event log provides replay and hooks; it is not the semantic model itself. `Calendar Event`, `Payment` and `DomainEvent` are different concepts. No universal `key/value` bag or user-created type is needed to store raw content, although an add-on may introduce its own fixed, versioned schema when it offers a real new capability.

## 4B. Liquid d1-2B as LifeOS's local decision layer

### What d1 actually is

[LiquidAI/d1-2B](https://huggingface.co/LiquidAI/d1-2B) is a 1.92B-parameter **decision model**, not a generative chat model. Its documented `system_one(state, questions)` accepts text/JSON and optional images or video and returns named decisions without generating answer tokens. The documented question types include yes/no (`noul`), single/multiple choice, ordered score and, in the Transformers implementation, text/number/date extraction with `found` and source span. A model score is useful evidence, not a guarantee. English and Hindi are listed; Hinglish performance must be measured.

The key design opportunity: LifeOS can ask **new questions about saved data at query time**, not only extract a fixed set of fields at capture time. We do not need a predeclared database property for every future question. The original content remains the durable evidence; only outcomes requiring precise behavior become structured records.

### Capture: concrete question bundle

For the wedding sentence above, LifeOS gives d1 the raw source plus capture date/timezone and a set of named questions, in a call/bounded batches supported by the runtime:

| Name | d1 question type | Question / meaning |
|---|---|---|
| `has_action` | `noul` | Does this text describe an action to follow up? |
| `has_money` | `noul` | Does it mention a specific monetary amount? |
| `money_stage` | `choice` | Quote / agreed / paid / unknown; include `unknown` as a genuine option. |
| `person` | `text` | Which person is mentioned? Return a source span, if found. |
| `amount` | `number` | What amount is quoted? Return value/unit/span if found. |
| `action` | `text` | Which text describes the action to take? |
| `when` | `text` or `date` | Which date/relative-date phrase is stated? Preserve the span; deterministic date handling uses the supplied capture context. |

The exact instructions, `found` behaviour and numbers returned are to be measured, particularly for “₹1 lakh” and mixed Hindi/English. The example is **expected behaviour, not a real inference result**. Do not assume d1 can discover an unlimited number of people, transactions or independent actions from one set of singular extraction questions. For multiple items, experiment with segmentation, separate targeted questions or bounded repeated passes; preserve the source and report missed/ambiguous parts. Do not create a payment just because a number occurs.

The app, not d1, normalizes known date/currency formats, validates workspace-scoped IDs and domain invariants, resolves candidates and produces commands. Use spans for evidence when available. Suggested records can be reviewed/edited; the user need not review every raw capture. Existing automation subscribes only to accepted domain events, not uncertain d1 scores.

### Bigger than capture: ask questions over your life

1. **Semantic inbox:** For each candidate source, ask “Does this mention something the user needs to do?” and “Is it awaiting someone else?” Rank possible follow-ups without requiring every Note to have been pre-tagged.
2. **Find a promise:** User asks “What did I promise Amit about the wedding?” Retrieve candidate source text/items in the active workspace and ask whether each contains a promise to that person. Show relevant original excerpts and their status. This can find language that did not fit a predeclared `promise` field.
3. **Find related history:** Given a new capture and existing candidates, ask whether each candidate concerns the same event/person/topic. Use the result only to propose links; namesakes, uncertainty and counterexamples prevent automatic merging.
4. **Spot changes or follow-ups:** Compare a later message against an existing proposed/agreed term; ask whether it proposes a change, then show both source passages. The deterministic finance module—not d1—calculates from confirmed allocations.
5. **Photo/document intake:** For a selected image or text document, ask questions such as “Is this a receipt?” or, with a supporting runtime, extract a candidate total/date with source evidence. Do not claim OCR or exact visual extraction accuracy without measurement.
6. **User-defined natural-language lens:** User writes “show things where someone is waiting for my reply.” For each retrieved candidate, place that question into an app-owned relevance/yes-no template. d1 answers the question; the user does not create a schema or relation. Results are a ranked, fallible view over retained evidence, not an authoritative database field or a complete guaranteed result.

Use a hybrid retrieval path: ordinary text search and structured workspace/permission filters provide candidates; optionally add a semantic index or bounded broader scan to improve recall, then d1 scores candidates. Keyword-only retrieval can miss relevant material. Report search scope/coverage, allow viewing source, benchmark recall and avoid promising an exhaustive search when only a subset was examined. For balances, dates, and completed/paid states, answer from confirmed structured records; AI can find possible evidence but cannot supply exact accounting truth by guessing.

### Runtime selection is a real constraint

- The [official Transformers model card](https://huggingface.co/LiquidAI/d1-2B) documents `system_one` text/number/date extraction using its own model code and `trust_remote_code=True`. Pin and review the revision before running downloaded code. Use an optional local worker/process behind the LifeOS service, with no independent database authority; evaluate packaging, CPU/GPU and offline operation.
- Liquid's [official GGUF model card](https://huggingface.co/LiquidAI/d1-2B-GGUF) documents llama.cpp `b11960`/`v0.8.0` or newer and `/v1/systemone`, **but at the time of this draft it supports only `noul`, `choice` and `score`**. The card says multiple-choice, text/number/date extraction, estimates and boxes are not yet supported on that path. Do not plan capture extraction as if GGUF already provides it.
- This machine reports an NVIDIA RTX 4050 Laptop GPU with 6,141 MiB total VRAM. The original Transformers model file is listed as about 3.84 GB, and was not found in the default Hugging Face cache during the initial research; its memory use, CUDA compatibility and extraction path remain **untested**. Subsequently, an already-loaded Ollama Q8 GGUF decision model was tested locally as described below. Liquid's H100/M5 numbers are not local benchmarks.
- d1-2B handles text/images/video, not audio input; voice needs transcription or a separately evaluated audio-capable model. It does not produce free-form explanations: use source excerpts and deterministic templates, or evaluate a separate optional generative model later.
- Its LFM Open License and distribution terms must be reviewed before bundling. Do not download weights automatically or add them to the repository as part of this draft.

### Local Ollama decision probe — preliminary evidence

An exploratory run used Ollama `0.40.13`, `hf.co/LiquidAI/d1-2B-GGUF:Q8_0`, and an RTX 4050 Laptop GPU. Ollama reported the model as 100% GPU with a 4096 context. The reusable, standard-library-only [probe script](../scripts/probe_d1.py) calls local `/v1/systemone` using synthetic inputs; it does not open the LifeOS database. Run it with `uv run --no-project scripts/probe_d1.py`.

The manually labelled examples are small, hand-picked and include related cases. A 0.5 yes/no threshold was used only for exploration; it is not production calibration or a statistically representative accuracy estimate. In one run:

| Probe | Observed result | Practical implication |
|---|---|---|
| Five yes/no questions per capture | 31/37 labelled decisions matched across 12 synthetic captures; median approximately 124 ms per request. | Mixed Hinglish routing is promising, but not reliable enough to commit financial facts without review. |
| Quote vs agreement | A quote-only Hinglish example got P(agreed) = 0.612; another actual receipt got P(quote) = 0.823. | High scores are not ground truth; preserve source and keep quote, agreed and paid separate. |
| Semantic lens | 6/7 cases matched; median approximately 39 ms per one-question request. The model scored “Amit promised me” as a match for “I promised Amit.” | Query-time views are feasible to explore; actor direction and false positives must be handled and surfaced. |
| Single-choice questions | 6/7 matched; four single-stage quote/agreed/paid/unknown examples matched, but a “no promise” example incorrectly selected Amit. | Choice framing can help on these fixtures but cannot replace validation or calibrated thresholds. |
| Number extraction | Ollama returned HTTP 400: question type must be `choice`, `score` or `noul`. | This Ollama path cannot directly perform the documented Transformers `number` extraction; do not promise full capture extraction from this test. |

These timings include local HTTP and are individual request medians for this run, not a model benchmark or a guarantee for longer context. The probe did not test images, Transformers extraction, RAM/VRAM peaks, model startup from unloaded state, or end-to-end capture. The script keeps each question, answer, fixture and duration in an optional JSON report when invoked with `--output PATH`.

### Smaller extraction model — preliminary CPU probe

The text extraction role does not necessarily need d1. [GLiNER2.5 multilingual](https://huggingface.co/fastino/gliner2.5-multi-v1) is a 287M-parameter model with approximately 594 MB of weights, documented to extract entities, structured records and relations on CPU. This is substantially fewer parameters than d1-2B; the package runtime and peak memory are additional, and model size alone does not establish quality or actual end-to-end speed.

The [CPU probe](../scripts/probe_small_extractor.py), run locally with `uv run scripts/probe_small_extractor.py` using synthetic inputs, produced the following **observed**, not production-validated, results:

- From “Amit ne wedding sound ke liye 1 lakh ka quote diya. Friday ko use call karna hai”, it returned spans for `Amit`, `1 lakh`, `Friday`, and `call`; it also labelled “wedding sound” as an event.
- In a two-party sentence, a structured extraction associated Neha with `5 lakh` and Amit with `1 lakh`. This is one positive example, not proof that arbitrary relationships are correct.
- For “Amit 90 hazaar mein maan gaya. Maine usko 30 hazaar advance de diya”, its money spans were just `90` and `30`, omitting `hazaar`; it also labelled `Maine usko` as a person. Treating those as complete rupee amounts would be a serious error.
- From a negated sentence it returned the span `pay`; the existence of that span does **not** mean a payment happened. For “Kal ...” it did not return a date. The model returns candidate spans, not guaranteed intent, polarity or normalized values.
- On this machine, six CPU requests took approximately 231–590 ms each in this run, using four PyTorch CPU threads; initial load included the first download. These numbers are not directly comparable to the d1 Ollama GPU probe, which used different work and hardware.

**Direction change:** The separate extractor → semantic parser → decision model pipeline is not the desired product approach. Keep this experiment as evidence about small models, but prefer testing one model that directly emits the normalized fixed record structure in a single call. `1 lakh` still needs correct numeric meaning and `kal` needs context; do not assume any model or schema guarantees them. JSON decoding and domain validation are ordinary handling of its output, not a second semantic extraction model or user-authored parser. Acceptance/review policy for high-impact facts remains separate from interpretation.

The script uses a `uv` inline-dependency environment and CPU-only PyTorch, avoiding Docker and CUDA for this experiment. The first run downloads model weights and packages; it does not read the LifeOS database. `--output PATH` saves the raw spans and structured example.

### Single model: local LFM3 1.7B structured-output probe

The user's existing `lfm3:1.7b` Ollama model is a Q4_K_M, approximately 1.1 GB local generative model. Unlike d1, it can generate a structured response. [Ollama's structured-output API](https://docs.ollama.com/capabilities/structured-outputs) accepts a JSON schema; this constrains output format, not factual accuracy.

The standard-library [LFM3 probe](../scripts/probe_lfm3_structured.py) makes one `/api/chat` request per synthetic capture with a fixed schema for task, finance, waiting and uncertainties. No separate NER model or semantic amount/date parser is used. `uv run --no-project scripts/probe_lfm3_structured.py --few-shot` runs the few-shot variant. The reference date for this test is explicitly Monday 2026-11-02 in Asia/Kolkata.

Observed using the locally installed model with thinking disabled, temperature 0 and five task-specific demonstration examples:

- “Amit ne wedding sound ke liye ₹1 lakh ka quote diya. Friday ko use call karna hai.” produced one task (Amit, 2026-11-06) and one quote (Amit, INR 100000). This is a genuine direct, single-model result, not a fabricated example.
- “Amit 90 hazaar mein maan gaya. Maine usko 30 hazaar advance de diya.” produced `90000/agreed` and `30000/paid`, but **invented INR** even though the input did not specify a currency.
- In a two-party input, it mapped Neha's confirmed ₹5 lakh and Amit's quote to the correct people/statuses but output **1000000** for Amit's stated ₹1 lakh: a tenfold error.
- It represented an explicitly unpaid case with extra unknown money records, treated a refund as `paid`, and put a promise made by Amit under the user's tasks rather than waiting. A neutral idea returned empty arrays in this variant.
- A baseline without demonstrations also produced invented records, including on a neutral idea. A separate thinking-mode attempt exhausted both 768- and 2048-token generation limits on the first case without a completed result; this does not establish what a larger limit or different setup would do.

These are eight hand-picked inputs, not a benchmark or evidence that the model is “best”. Few-shot examples, schema, temperature, quantization, runtime and wording affect results. The raw response shape can be inspected/validated, but valid JSON is not proof that any field is correct. Test a held-out multilingual corpus, date/number conversion, negation, multi-party ownership, missing values, hallucinated records, model latency and memory before relying on automatic writes or formulas. Preserve the user input even when the model is uncertain. Raw results are available from the script's optional `--output PATH`.

### Follow-up: better context and examples, evaluated on new cases

[benchmark_lfm3_capture.py](../scripts/benchmark_lfm3_capture.py) compares the earlier five-example prompt with a revised prompt that includes explicit schema, reference date, user-vs-other-person roles, negation, lakh/hazaar conversion, null currency and eight demonstrations. Both use the same local `lfm3:1.7b` Q4 model, one model call per input, thinking off, temperature 0 and the same response schema. Neither prompt contains the 12 synthetic evaluation inputs. No personal workspace or actual user context is read.

In one run, the earlier prompt passed selected semantic checks on **3/12 cases** and the revised prompt passed **5/12**. These are case counts on a tiny hand-labelled set, not a production accuracy estimate; the checker assesses specified fields such as selected people, amounts, states, dates and presence/absence of records, not every output field. For one planned-payment case, task/waiting details are not graded. Median local request times in that run were approximately 812 ms and 561 ms respectively; prompt length, load and individual outputs differ, so this is not a controlled speed comparison.

The revised prompt improved separate client/vendor mapping, refund classification and an undated task. It also regressed on one explicit advance payment that the earlier prompt classified correctly: it labelled the payment `agreed`. Other failures included treating an actual received payment as `planned`, inventing INR where no currency was specified, and attributing another person's promise to the user. A Hindi Devanagari quote was missed. **More context helped some cases, but did not resolve all errors.**

The reusable script can record every input, demonstration, prompt, output and check with `uv run --no-project scripts/benchmark_lfm3_capture.py --output PATH`. The 12 cases were written separately from the prompt examples, but prompt design was informed by earlier experiments and this small set has now been observed. Any further tuning must be evaluated on a newly written, untouched hold-out set. Select and validate against real usage only with the user's explicit data choices; retain the original capture and do not silently commit uncertain financial interpretations.

### Same cases with Qwen 3.5 4B

The same benchmark, prompt variants, JSON schema, reference date and 12 synthetic cases were run locally with the already installed `qwen3.5:4b-q4_K_M`. The two models were tested on the same machine through Ollama with thinking disabled and temperature 0; Qwen was reported as 100% GPU with 8192 context. The model had to load on the first request, so the per-run median is more informative than that first-call latency, but these remain sequential exploratory runs, not a controlled performance benchmark.

| Prompt | LFM3 1.7B Q4 | Qwen 3.5 4B Q4 |
|---|---:|---:|
| Earlier five-example prompt | 3/12 cases; median 812 ms | 8/12 cases; median 1,250 ms |
| Revised eight-example prompt | 5/12 cases; median 561 ms | 11/12 cases; median 1,395 ms |

Qwen's revised-prompt failure was the planned-unpaid `₹12,000` case: it preserved amount `12000`, state `planned`, and did not assert payment, but returned currency `null` despite the rupee symbol. The benchmark also **does not grade task/waiting fields in that particular case**, nor does it check every description, action text, uncertainty or factual detail elsewhere. Thus 11/12 is only the selected case checks, not a full-output correctness guarantee. Qwen's output for that case also omitted the user's planned action.

This is a small synthetic comparison, on a set the project has now observed; it does not establish real-user accuracy, finance readiness, multilingual coverage, model rankings in general, or a fair speed comparison. Further tuning needs a fresh untouched test set and more complete per-field validation. The single-model, one-call design remains unchanged. Reproduce the Qwen run with `uv run --no-project scripts/benchmark_lfm3_capture.py --model qwen3.5:4b-q4_K_M --output PATH`; the JSON report includes prompts, fixtures, outputs and checks.

### Fresh 12-case Qwen test after prompt refinement

After refining the prompt against the earlier set, two runs passed all 12 earlier cases on selected checks. The same prompt was then run, without changes, against 12 newly written synthetic inputs using `--variant tuned --holdout`: **10/12 cases passed selected checks**, with 1,363.5 ms median local request time. The 1,869 ms mean includes the 7,640 ms first request/model load. These cases were not included in prompt examples; they are still a small hand-authored sample, and the evaluator does not grade every field or all task content.

One failure converted “pachaas hazaar” to `5000` rather than `50000` and invented `INR`; another returned `unknown` for a stated confirmed price whose amount was not provided, where the fixture expected `agreed`. The second can be a defensible conservative interpretation; the first is a serious factual error. This test does not establish 100% general accuracy. The output report records prompt, fixture, selected checks and model outputs; use a newly written untouched set for future prompt changes.

## 4C. Formulas: connected data becomes useful

Relationships say which records belong together; formulas calculate over those records; automation can react when a meaningful calculated condition changes. **Formulas are a shared primitive**, not a finance-only feature or a required configuration step for users.

### Example: event finance

Assume the confirmed, same-currency records linked to a wedding are:

```text
Client agreement: ₹5,00,000        Client has paid: ₹1,50,000
Vendor agreement: ₹2,00,000        Vendor has been paid: ₹50,000
```

The finance add-on supplies these definitions; the user does not need to write them:

```text
Client remaining = agreed client amount - payments allocated to that agreement
                 = ₹5,00,000 - ₹1,50,000 = ₹3,50,000

Vendor remaining = agreed vendor amount - payments allocated to that agreement
                 = ₹2,00,000 - ₹50,000 = ₹1,50,000

Estimated margin = confirmed sale amounts - confirmed vendor costs
                 = ₹5,00,000 - ₹2,00,000 = ₹3,00,000
```

The payment is part of the vendor cost, not a second cost. Quotes that are not agreed are excluded from confirmed totals. The margin is an estimate based on included records, not final accounting profit. A breakdown links each number back to the included agreements and payments. If coverage is incomplete, the UI says which data is unknown; missing amount or currency must not silently become zero. If there are no qualifying records and the set is known complete, a zero total can be shown; otherwise the result is unknown/partial.

### From formula to automation

Suppose the user enables a built-in rule: “Tell me when this wedding's estimated margin falls below ₹2,50,000.” A later confirmed extra vendor cost of ₹80,000 changes the estimate to ₹2,20,000.

```text
Confirmed cost recorded → linked event's margin recalculated
→ margin crosses from ₹3,00,000 to ₹2,20,000
→ rule creates one in-app warning with its source breakdown
```

The calculation itself only produces a value. The separate rule decides whether to create a warning, task or other permitted action. The rule tracks the transition, not merely “the value is below” on every recalculation; restarting or replaying history must not create the warning again. On enabling a rule, show the current below-threshold state without pretending a new crossing occurred; future crossings can generate warnings. When a result is unknown or incomplete, do not claim a threshold was crossed; surface the uncertainty where useful. Define the re-arm policy when the value goes above the threshold and later falls again.

### Same primitive outside finance

- **Habit/progress:** sum compatible confirmed activity for the week → “3 of 4 target days”; a rule can suggest a check-in if the target has not been reached.
- **Project:** count unfinished linked tasks → “3 open tasks”; a rule can suggest a review when no activity is recorded for 14 days. Missing tracking data is not proof of real-world inactivity.
- **Maintenance:** use the known service date and interval → next due date; a reminder rule can fire a configured number of days before it.

Formulas can use counts, sums, comparisons, dates, durations, ratios and other explicitly supported functions. A link can connect records from different add-ons through a shared contract; an add-on owns its domain meaning and only exposes the safe inputs needed for calculation.

### Product and implementation rules

- **Built-in first.** Ship useful definitions and plain-language rules with the relevant module. Do not require a spreadsheet, formula editor or schema setup to capture and use LifeOS. Advanced user-created formulas are a later capability; the initial model must not depend on them.
- **Inspectable.** Every result identifies definition/version, scope, included source records, unit/currency, effective evaluation time and whether it is known, partial, unknown or invalid. Do not pass probabilistic AI proposals off as confirmed inputs.
- **Pure and typed.** A formula reads authorized records and returns a result; it cannot write, send messages or call arbitrary code. Money uses exact minor-unit arithmetic; reject mixed currencies and incompatible units unless a separately defined conversion exists. Division by zero, unknown values and invalid dates remain explicit.
- **Bounded and reproducible.** Track dependencies and recompute affected results after accepted changes; avoid circular formulas. For clock-based rules, make `as_of` time/timezone explicit and schedule reevaluation, because time can pass without a database mutation. Use deterministic formulas for automation decisions.
- **One authority.** Definitions are versioned configuration and accepted domain facts/events are the source of truth; cached results are projections that can be rebuilt. Rebuilding or historical evaluation must not cause external side effects or duplicate warnings.
- **Safe extensibility.** Prefer registered pure operations or a validated, limited expression tree; no arbitrary shell, JavaScript evaluation or raw untrusted SQL. Define workspace boundaries, resource limits and add-on compatibility. A future natural-language request can select a supported template; d1's decision output is not a free-form formula generator.

## 5. Add-ons: a small core with feature modules

### What belongs where

| Core | Built-in add-on examples |
|---|---|
| Workspace isolation, basic unclassified capture, item identity and the shared item vocabulary. | **Finance:** money-specific records, payment allocation, reconciliation and summaries. Expense/Income are familiar entry points to this capability. |
| Notes, tasks, basic scheduling, links, source references, search and item display contracts. | **Habits/progress:** repeatable intentions, targets, activity and measurement views. |
| Service commands, validation boundary, event store, formula/projection framework and durable job delivery. | **Project intelligence:** checkpoints, selected repository sources and evidence-based resume views. |
| Shared timeline, simple reminders, consent/permissions and a way to present contextual contributions. | **Automations:** reusable rule recipes and triggers consuming the shared event/job framework. Basic capture does not depend on a rule builder. |
| Local AI provider interface and proposal/review boundary when introduced; no model is mandatory. | **Optional AI integrations:** local model adapter, specific parsers and retrieval enhancements. |

This table is a **proposed boundary**, not a promise that every current feature can move without shared contracts. During Milestone 1, trace cross-feature use cases and revise the boundary where it creates duplication or data loss. In particular, the finance module owns finance semantics, while shared capture and item display must remain usable.

### What “add-on” means in each stage

1. **Built-in modules first:** first-party code ships with LifeOS, registered at build/startup. Finance works by default in the appropriate context. This proves separable ownership and lifecycle; it is not yet an installable plug-in system.
2. **Optional enable/disable per workspace:** user-facing navigation and new feature actions can be disabled; underlying data and interpretation support remain available for safe reading, rebuilding and later re-enabling. No database history is deleted by disabling a module.
3. **Installable third-party add-ons later:** only after stable APIs, compatibility, permissions and an actual isolation model are designed and tested. A manifest or an in-process JavaScript module is **not** a security sandbox. Separate process alone is not sufficient without an enforced resource boundary.

An installation is app-level; activation and data access are workspace-scoped. Default first-party modules are active in existing and new workspaces unless the user opts out. If finance is inactive, existing finance information remains visible through a clearly labelled read-only summary where the retained decoder/projection can provide one. New unclassified captures still work; recording or changing a financial fact requires enabling finance. Never silently convert its data into generic notes or delete it.

### Illustrative module contract

This is a target for first-party code, not a public API promised today:

- Stable module ID, version, compatible core API version, dependencies and owned event/schema versions.
- Declared commands, supported event handlers, projections/queries, formula definitions with typed inputs/outputs and contextual UI/CLI contributions.
- Read and write access through service-owned workspace-scoped APIs. No direct cross-module table writes; shared facts have a named owner.
- Module-owned additive migrations and versioned event readers. Database migrations and event-schema evolution are different responsibilities.
- Declared lifecycle: installed, active, paused/disabled, failed/incompatible. Failure in one module must not prevent unclassified capture or unrelated modules from working.
- Durable consumer cursor and idempotency for live events; deterministic projection replay is separate from external side effects. Commands from a module still pass shared validation.
- Version compatibility must be checked before activation. An unavailable/unknown event decoder is reported; the system must not silently skip events and claim a successful rebuild.

Disabling a module pauses its active jobs, UI and reactions; it does not remove its committed events. Re-enable rebuilds/catches up **read models** without automatically replaying historical notifications or external actions. New user-visible effects start only from a defined activation position. Existing pending jobs and changed dependencies are reconciled visibly. If code is removed or an incompatible version is installed, retain a compatible decoder/migration path or block unsafe removal and offer a data export; do not strand data silently. Final uninstall and destructive deletion policies require explicit design and tests.

### Why this is not yet a plug-in marketplace

The immediate need is coherent first-party feature boundaries and lifecycle. Package installation, third-party distribution, signing, isolation, capability enforcement, compatibility and recovery form a separate product and security problem. Build that only after two built-in modules demonstrate a stable need. VS Code's [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host) and [contribution API](https://code.visualstudio.com/api/extension-capabilities/overview) are useful references for separating host and extension responsibilities, not proof that an arbitrary extension is safe.

## 6. Event-sourced storage and reactions

### Target write path

```text
UI / CLI / reviewed AI proposal / add-on
                  ↓
        service command + validation
                  ↓
  one SQLite transaction: append domain events
  + update required projections + enqueue durable work
                  ↓
      committed state and live read updates
                  ↓
   idempotent subscribers / optional side effects
```

- Events describe meaning: e.g. item captured, payment recorded, activity corrected. Names here are examples; Milestone 2 defines actual versioned contracts.
- Envelope: stable event ID, workspace ID, stream/entity ID and sequence, event type/version, recorded time, optional actual/effective time, actor/origin, command/correlation and causation IDs, plus payload or a reference to retained source data. Timestamps do not substitute for ordering.
- Within the single service, use a transaction and an expected stream revision so stale writes are rejected/re-evaluated. Event append, invariant checks, synchronous projections and durable job enqueue must commit or fail together.
- Core and modules own distinct event contracts. Events necessary to rebuild a module's data require its registered versioned decoder. A core projection must never silently treat an unknown relevant event as successfully applied.
- Current-state tables are projections, not a second writable source of truth for the same fact. A deleted or corrupted projection can be rebuilt from the applicable events and retained referenced data. Large histories may later use snapshots as an optimization.
- Corrections append a new event. Record both when something occurred and when LifeOS learned about it, if known. Correcting a past payment must update affected current views without sending another notification or payment.
- Live reactions are durable and idempotent. Track consumer progress, retries and causal chains; bound cycles. Replaying history rebuilds state only: no sends, external payments, reminders or other side effects. User-triggered reprocessing is a separate explicit operation.
- Event schema versions and deterministic upcasters/readers are mandatory. Cross-module contracts have version ownership; unsupported versions fail visibly. Event sourcing does not automatically solve offline multi-device conflict resolution or external delivery exactly once.
- Define retention and deletion before storing sensitive payloads forever. Prefer references to separately managed sensitive content where suitable. Test deletion from current data, projections, caches and managed backups under the stated retention policy; retain only allowed redacted history. Do not promise physical erasure from external copies or backups outside LifeOS control. Define what replay can reconstruct after deletion.

Event sourcing is a long-term bet with real costs in schema evolution, replay and privacy. See [Microsoft's event-sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) and [Fowler on replay and external updates](https://martinfowler.com/eaaDev/EventSourcing.html). Use one service and SQLite first; no Kafka, second database or network dependency is implied.

## 7. Milestones

Milestones are ordered by dependency. Each has a usable outcome and a pass/fail gate; completed work below is not implied. Experiments run on fixtures or copies, never the active personal database.

### M0 — Capture the actual problem and baseline

**Goal:** Make the user's cognitive load and existing data visible before changing architecture.

- [ ] Inventory current item creation, type changes, area/family behaviour, finance, project, habit, search, desktop/CLI and migration paths. Record authoritative sources and current limitations.
- [ ] Create at least 20 representative captures: personal and company, untyped thought, project, person with multiple roles, event + preparation, car + service, recurring task, measurement, client sale, vendor quote, partial payment, refund, conflicting source, missing currency, two same-named contacts, and unrelated workspace data.
- [ ] For each, specify what the user says, expected result, required fields/questions, supported queries, correction/deletion and what must remain unknown. Include at least five ambiguous/negative cases.
- [ ] Measure today’s required decisions, interactions and elapsed capture time on the same representative workflows. Record the device and method; these are the comparison baseline, not invented performance claims.

**Done when:** The example corpus and baseline give objective tests for both model correctness and user effort. A capture is not called easy just because its data can technically be stored in a note.

### M1 — Validate and refine the proposed model and add-on boundary

**Goal:** Settle what LifeOS means by an item, supporting record and module before writing a general engine.

- [ ] Map every M0 example and query through the concrete model in 4A and alternatives A and B. Compare records required, mandatory user decisions, ambiguity, correction and whether independent facts can accidentally overwrite one another.
- [ ] Use 4A as the proposed model; change it only where the corpus exposes a concrete failure. Specify the fixed user-facing vocabulary and allowed internal combinations, and document why any extra concept is needed.
- [ ] Define identity, parent/family vs cross-links, workspace scope, date-only vs scheduled time vs due date, sources, and untyped capture. Specify how the same person appears in multiple contexts without forcing roles or guessing identity.
- [ ] Define module ownership for a simple Expense/Income item versus an agreement, payment and allocation. Prove there is exactly one authoritative representation of each financial fact. Draw the line between core and first-party modules for two non-finance workflows as well.
- [ ] Define the initial formula contract, input ownership, dependency tracking, result states and plain-language display; apply it to finance, habits and dates without requiring the user to define a formula.
- [ ] Specify normal-language capture outcomes: immediate raw save; suggested interpretation; accepted/rejected changes; ambiguity handling; review and correction. Define when no question is needed and when a missing fact blocks a calculation/action.

**Done when:** Each corpus case has a canonical representation and expected answer, no user-defined types/relations, no required type selection to save, and clear owner/invariant for each shared fact. The selected approach explains how it avoids both duplicate data and unbounded combinations.

### M1.5 — Compare small extraction and decision models

**Depends on:** M0 examples; can run alongside M1 on synthetic fixtures.

**Goal:** Test which combination of a small extractor, deterministic parsing and decision models makes low-friction capture and natural-language lenses possible on target hardware.

- [ ] With an explicitly chosen, pinned Transformers model/runtime revision, run d1 on synthetic Hindi, Hinglish and English captures. Use a real `.py` script with PEP 723 metadata and `uv`, in accordance with the workspace Python instructions. Do not use real personal data for the prototype.
- [x] Run the already-loaded Ollama Q8 model on an initial synthetic yes/no and choice corpus using `uv`; retain the script and record both successful decisions and failures. This is partial evidence only, not completion of M1.5.
- [x] Run a small multilingual extractor on a synthetic CPU corpus; retain the script and record incomplete amounts, negation and name errors as well as successful spans. This is partial evidence only, not a production benchmark.
- [x] Test the already-installed LFM3 1.7B Q4 model as a single structured-output interpreter on eight synthetic captures; retain the probe and record the correct example and tenfold/ownership/missing-value errors. This does not establish production suitability.
- [x] Compare an improved prompt and examples against the earlier one on 12 distinct synthetic captures; record improvements, regressions and the limits of the small case-level check. Retain the single-model, one-call approach.
- [ ] Improve the prompt/schema or evaluate an explicitly selected model on a fresh untouched hold-out set, with labelled exact amounts, statuses, participants, missing fields, dates, negation and non-actionable notes; assess workspace context retrieval separately. Do not treat JSON validity as semantic correctness.
- [ ] Compare small-extractor structured records/classification with d1 and simple parsing on a separately labelled held-out Hinglish/English corpus; measure exact-span and amount accuracy, relation direction, negation, dates, latency and peak memory. Assess whether a second model adds enough value to justify its resource cost.
- [ ] Ask the exact named `noul`, `choice`, `text`, `number` and `date` questions in 4B, including two tasks, two amounts, missing fields, conflicting statements and duplicate names. Record raw outputs, spans, misses and timings; do not invent d1 results or trust `found` as a correctness guarantee.
- [ ] Independently test the official GGUF/llama.cpp path for its documented decisions only; compare runtime/version, download sizes, startup, CPU/GPU memory, latency and quality. Verify whether extraction support has changed before planning around it.
- [ ] Compare d1-backed semantic filtering with keyword-only search and an exhaustive labelled fixture set. Measure recall, precision and latency, including unseen concepts and negative cases; present relevant source excerpts and search coverage.
- [ ] Deliver a recommendation: chosen runtime, supported features, setup/bundling constraints, source spans, calibrated thresholds and fallback behaviour. Review license and pin downloaded remote code before distributing. If hardware or runtime is unavailable, report that and leave capture functional without AI.

**Done when:** A repeatable local report shows actual outputs and limitations for the decision and extraction paths, without modifying user data or claiming GGUF capabilities it does not expose. This spike validates feasibility; it does not require the complete event store first.

### M2 — Prove the event and projection foundation

**Depends on:** M1's model and ownership decisions.

**Goal:** Make history and automation hooks reliable before replatforming all features.

- [ ] On an isolated database, implement a narrow item lifecycle plus one finance-related event stream through the service, with versioned contracts, command IDs, revision checks and atomic append/projection/job enqueue.
- [ ] Rebuild item and finance projections from empty tables; compare with the pre-rebuild result. Prove old event versions still read after an additive schema change.
- [ ] Implement correction and source reference behaviour; distinguish recorded time from effective time. Define deletion/redaction and demonstrate the promised rebuild behaviour after deletion.
- [ ] Simulate failure before commit, after commit before delivery, duplicate commands, duplicate event delivery, concurrency and service restart. Each accepted fact appears once and each required projection agrees.
- [ ] Replay a populated stream while an automation is enabled: zero historical notifications, payment actions or duplicate tasks fire.

**Done when:** The isolated slice passes those failure/rebuild tests, retains workspace isolation, and desktop/CLI read the same committed result. Event contracts and privacy trade-offs are documented; no claim is made that multiple-device sync is solved.

### M3 — Build the module host and prove finance is separable

**Depends on:** M2.

**Goal:** Prove the game-style idea using built-in modules, without making users manage installation.

- [ ] Define the first-party module manifest/registration, compatibility checks, workspace activation, service command/query interface, contribution points and lifecycle. Do not expose direct shared-table writes.
- [ ] Move the candidate finance behaviour behind this boundary. Keep the familiar Expense/Income capture paths available by default, with manual simple recording and the richer finance flow using the same authority.
- [ ] Demonstrate a second module such as habits/progress against the same host so the boundary is not secretly finance-specific.
- [ ] Test missing/disabled/failing/incompatible modules, workspace isolation, restart, upgrade, retained decoding, pause and re-enable. Basic capture and other modules must remain usable.
- [ ] Register built-in formula definitions from the finance and progress modules; reject incompatible inputs and missing formula providers without breaking unrelated capture.
- [ ] Rebuild projections while a module is disabled, or explicitly retain its compatible read decoder and fail visibly if it is absent. No old side effects run on catch-up.

**Done when:** A user can use Expense/Income without setup; disabling finance leaves data intact and readable as specified, and re-enabling recovers it without duplicate reminders. The second module proves shared contracts without coupling core to its private tables.

### M4 — Prove the model across finance and everyday life

**Depends on:** M2–M3.

**Goal:** Test abstractions with real outcomes, not just data schemas.

- [ ] Wedding: client agreed ₹5,00,000; vendor agreed ₹2,00,000; client paid ₹1,50,000; vendor received ₹50,000. Show agreed/received/paid/remaining separately, with source records and no double counting. Unconfirmed quotes remain separate; any margin is labelled as an estimate with included costs.
- [ ] Support amendments, partial payments, refunds and correction/voids with exact minor-unit arithmetic and explicit currency. Unknown currency remains unknown; currencies are not silently combined.
- [ ] Implement the finance, activity and date formulas in 4C. Check breakdowns, known/partial/unknown results, same-record deduplication, division by zero, incompatible units/currencies and version changes. A payment or correction produces the correct recalculated results without duplicate effects.
- [ ] Test a formula-threshold rule crossing, non-crossing and re-arming, clock-based reevaluation, restart/retry and projection replay. No duplicate warning or historical external side effect is allowed; user-edited follow-ups remain owned by the user.
- [ ] Everyday: one activity linked to an existing task and compatible habit/goal adds progress exactly once. Correct/void it and rebuild. Preserve rest, skip and unlogged as different states; a log must not implicitly complete the task.
- [ ] Contact/context: a single confirmed person can be related to multiple items and roles without duplicate identity; ambiguous matches are left unresolved. The user can correct links.
- [ ] Project: a saved checkpoint and source remain connected to the original item and can support an accurate “where did I stop?” view. Distinguish evidence from suggestion.

**Done when:** Both business and personal workflows answer their defined questions consistently before and after rebuild, correction and restart, without user-defined schemas or forced classification. Domain-specific features may have their own internal tables; the user does not have to model those tables.

### M5 — Local AI capture as a proposal layer

**Depends on:** M1.5's measured feasibility and M1–M4's stable commands and first-party module contributions.

**Goal:** Let people describe life naturally while keeping the underlying model trustworthy.

- [ ] Implement the provider interface with the single structured-output model/runtime selected in M1.5 unless evaluation demonstrates it cannot meet the required accuracy. Make model availability, download and execution explicit. No cloud provider is required; no model output writes directly to storage. Support the chosen model's actual native interface.
- [ ] Feed the model only necessary workspace-scoped context. Treat captured documents as data, not instructions to execute. Retain user input per the selected privacy/retention behaviour.
- [ ] Generate extraction schemas and/or decision question bundles from the fixed core and enabled add-on capabilities. Translate answers and source spans into validated **proposals** using registered commands. Separate explicit facts from guesses; support incomplete input and avoid assuming a transaction or link occurred. Multi-entity extraction needs separately tested association and segmentation.
- [ ] Implement a natural-language search lens using candidate retrieval and an evaluated decision model, such as d1, over retained source text. Return ranked evidence and disclose searched scope; do not call an approximate result an exhaustive answer or use it as an exact financial total.
- [ ] Give a compact review that allows accept/edit/reject per proposal. If the action needs a missing value or disambiguation, ask one contextual question with a defer option; raw capture remains available.
- [ ] Evaluate a fixed local corpus with expected facts and ambiguities, including same-name contacts, multiple possible dates, mixed currencies and adversarial or irrelevant document text. Measure false factual claims, unnecessary questions, rejected edits and capture friction; report model and hardware. Establish release thresholds from the M0 baseline rather than inventing accuracy.
- [ ] Model unavailable, slow, incorrect or interrupted: raw capture and manual workflows still succeed; retry does not create duplicate records. No silent fall back to a cloud provider.

**Done when:** A user can capture naturally, review what LifeOS understood and correct it without learning the data model. The corpus demonstrates both useful extraction and safe handling of unknowns; model-specific performance is reported honestly.

### M6 — Migration, cutover and removal of duplicate paths

**Depends on:** M1–M5 for the scoped replacement paths.

**Goal:** Move real data safely and leave one clear architecture, while allowing features to be redesigned.

- [ ] Inventory all existing workspace-scoped tables and map items, tags, areas, family links, templates, recurrence, rules/jobs, projects/sources, obligations/payments, habits/activities and attention data. For each: migrate, retain/read-only, rebuild, or explicitly retire; record owner and verification. Keep legacy IDs or a durable mapping so links resolve.
- [ ] Existing SQLx migrations/checksums are immutable. Develop a new migration and reversible cutover using isolated copies and consistent SQLite backups, accounting for any active service and database journal/WAL. Never reset or modify the active user database for testing.
- [ ] Import a **baseline state at migration time**, not imaginary historical events. Preserve real existing activity/obligation revisions and source timestamps where their meaning is known; label older history unavailable where it cannot be reconstructed.
- [ ] Reconcile ordinary financial items with existing obligation payments by recorded links; a linked pair represents one payment, not two. Map `REAL` amounts and legacy records without currency conservatively: do not assume INR or silently round ambiguous values. Flag unresolved conversions and preserve original values for review.
- [ ] Make migration idempotent and crash-recoverable; test fresh database, original-schema upgrade, current-schema upgrade, multiple workspaces, interrupted migration, retry and restore. Verify counts, identities, links, financial totals, source content and representative views.
- [ ] At a defined cutover, route desktop, CLI, automation and AI through the new authority. Remove superseded duplicate writers and stale listeners after parity checks; avoid indefinitely maintaining two authoritative paths.
- [ ] Run appropriate domain, service, live-update and native desktop/CLI tests; test packaged upgrade and rollback on copied data. Report native desktop, packaged installation, second-machine and real-user validation separately rather than inferring them from unit tests.

**Done when:** A copied existing database upgrades and restores without lost or invented information; existing workspace data remains isolated; supported UI/CLI workflows operate through the new path; unresolved legacy data is visible; obsolete writers are removed. A production cutover is a later action, not a consequence of this draft.

### M7 — Capacity, integrations and future external add-ons

**Depends on:** the stable core and two built-in modules.

**Goal:** Grow without turning the core or user experience into a custom database/plug-in project.

- [ ] Benchmark capture, search, targeted reads, live updates, projection rebuild and storage size with 1k, 10k and 100k synthetic items/events on a recorded machine. Compare with baseline; set budgets before optimization. Address the current item cap and full snapshots deliberately.
- [ ] Define import/export and interoperability boundaries using relevant standards where semantics match, with round-trip tests and explicit unsupported fields.
- [ ] Prototype external add-ons only with a concrete use case. Specify installation, API versioning, trust, capabilities, process/resource isolation, updates, failure recovery, export, uninstall and no-network/offline behaviour. Review what an add-on can read, write, execute and send; enforce these controls at the boundary.
- [ ] Design multi-device sync as a separate project: stable event identity, causal ordering, conflicts, ownership, deleted data and recovery must be explicitly solved; append-only storage is not sufficient.

**Done when:** Measured capacity and the third-party threat/lifecycle design exist. External add-ons or sync are not considered shipped merely because first-party modules exist.

## 8. Evaluation: easy for users, precise underneath

Run the same corpus at M0, M1 prototype, M4 and M5. Record:

1. **Capture burden:** required type/relation/add-on selections to save an unclassified capture = **zero**. Count optional interactions, prompts and time compared with baseline. For an actual payment, the necessary facts may still need user input.
2. **Correctness:** expected answer vs actual, exact source, missing/ambiguous values and whether an interpretation changed a fact without authorization.
3. **Retrieval:** can the user find the original capture and relevant context without remembering where it was filed? Can they inspect why a number or suggestion appears?
4. **Correction and lifecycle:** edit, undo/correct, delete under the specified policy, disable/re-enable an add-on, restart and rebuild; check the same results and no duplicated effects.
5. **Isolation and independence:** same names/data in different workspaces never merge. With AI unavailable or a module disabled/failing, raw capture and unrelated work continue.

Use the corpus to compare **decisions required**, not just database table counts. There is no meaningful claim of “zero friction” until real users have tried it.

## 9. Sources and what they contribute

- [iCalendar RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545): distinct to-do, calendar event and journal concepts with relationships; useful interoperability reference, not a complete life model.
- [Org mode TODO items](https://orgmode.org/guide/TODO-Items.html) and [scheduling vs deadlines](https://orgmode.org/manual/Deadlines-and-Scheduling.html): common entries can carry action state, while a task's planned work date differs from a meeting.
- [REA ontology research](https://www.williamemccarthy.com/s/The-Ontological-Foundations-of-REA-Enterprise-Information-Systems_2000.pdf): economic resources, events and agents; useful finance inspiration, not a mandatory whole-app ontology.
- [FHIR Observation](https://hl7.org/fhir/observation.html): observations connect subjects, values and relevant times; inspiration for measurements, not a requirement to adopt a healthcare schema.
- [W3C PROV overview](https://www.w3.org/TR/prov-overview/): source, activity and agent provenance; useful for AI and evidence-backed explanations.
- [Event sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing): projections, versioning, concurrency, idempotency and privacy trade-offs.
- [Liquid d1-2B](https://huggingface.co/LiquidAI/d1-2B) and [official GGUF runtime support](https://huggingface.co/LiquidAI/d1-2B-GGUF): typed decision/extraction API and the important difference between Transformers and current llama.cpp capabilities.
- [VS Code extension host](https://code.visualstudio.com/api/advanced-topics/extension-host) and [extension capabilities](https://code.visualstudio.com/api/extension-capabilities/overview): examples of explicit host/contribution boundaries; not a ready-made sandbox for LifeOS.

## 10. Open decisions to resolve through the milestones

- The proposed 4A model uses a fixed Contact record and a shared Object identity. Does the corpus show a simpler model without losing person identity, or reveal a missing invariant?
- The proposed model has task/event detail records and finance-owned supporting records. Does any real workflow justify an additional fixed aspect, or require a separate linked record for independent lifecycle?
- Which money operations belong in the first finance module, and what remains visible when it is disabled? The no-data-loss and default-use rules above are fixed; detailed UX is not.
- Which events must be kept for authoritative reconstruction, and which source text can be separately retained/deleted while preserving meaningful redacted history?
- Can d1-2B's full extraction path run with acceptable latency and memory on target machines, and which runtime/version preserves the needed question types? Decide after M1.5 measurements, not from vendor hardware benchmarks.
- Which existing recent features will be redesigned, replaced, retained or retired? M6 requires an explicit mapping and verified cutover; existing implementation is not automatically the target.

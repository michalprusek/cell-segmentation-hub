# `/segmenter` — Few-shot, active-learning, native-resolution segmentation: SOTA research notes

> **Status:** research + design proposal (2026-07-09). **Nothing implemented yet.**
> Companion to the interactive proposal (Artifact "Segmenter — Design Proposal").
> Compiled from six parallel deep-research streams. arXiv IDs carry a verification flag
> (✓ = confirmed against arxiv.org/HF this session; ⚠️ = surfaced in search but not
> independently opened; ★ = from model memory, re-verify before citing in print).

## 0. The requirement

A standalone `/segmenter` module where biologists **self-train** a segmenter: upload an
unlabeled image dataset → an active-learning loop proposes which images (v1) / native-res
patches (phase 2) give the most model value → the biologist annotates **polygons** in a
reused (polygon-only) spheroseg editor → the model **pre-labels** and the human only
**corrects** → after N rounds, a model that generalises to the whole dataset.

**Five hard constraints (each eliminates method families):**

1. **Overlapping masks (amodal)** — instances may share pixels. ✗ kills per-pixel single-label methods.
2. **Filaments AND blobs in one pipeline** — 1–3 px microtubules and round spheroids. ✗ kills shape-prior methods (StarDist).
3. **Native resolution** — no downsampling. ✗ kills fixed-resize / global-attention nets.
4. **Few labels, trainable by a non-expert.** ✗ kills training a detector from scratch.
5. **Multi-class, multi-instance** — arbitrary user classes; per-instance identity.

**User decisions so far:** standalone module (not a new project-type); patch-level AL in
phase 2 (image-level first); ML/training approach left to research; overlap incl.
same-class assumed (crossing filaments); pre-label-and-correct loop is central.

## 1. Core finding

**No single existing model satisfies all five constraints.** The shape-agnostic /
filament-friendly heads (flow-field, embeddings) are exactly the ones that cannot represent
overlap (they collapse each pixel to one instance). The overlap-capable representations
(per-query masks, per-prompt SAM masks, per-instance polygons) are the ones with no shape
prior. The intersection dictates a **two-stage "propose → refine"** design that reuses the
already-deployed frozen **DINOv3-L**:

- **Stage 1 — Propose (frozen DINOv3-L):** matures from training-free in-context matching
  (1 example) → a ~5M-param head trainable in minutes on one GPU as labels accumulate.
- **Stage 2 — Refine (promptable SAM family):** proposals become point/box prompts →
  **independent per-instance masks** (SAM 2 for blobs; HQ-SAM / SAM 3 "thin line" for filaments).

Overlaps survive because each instance is stored as its own polygon/mask and **never
flattened into a shared label raster** — that flattening is the single operation that
destroys amodal overlap.

## 2. Overlap-capable & native-resolution architectures

- **Why classic panoptic forbids overlap:** _Panoptic Segmentation_ Kirillov et al. defines
  the task as one (class, id) per pixel — non-overlap is baked in. Semantic softmax has the
  same limit. Cite `1801.00868` ✓.
- **Mask-classification breaks the per-pixel constraint:** each query emits an **independent
  sigmoid binary mask** (query · pixel-embedding), not a shared softmax → masks may overlap
  at the same pixel. Panoptic output _imposes_ non-overlap via a pixel-argmax; **instance
  mode skips the argmax and keeps overlapping per-query masks** — the mode we want.
  MaskFormer `2107.06278`★, **Mask2Former `2112.01527` ✓**, Mask DINO `2206.02777` ✓,
  OneFormer `2211.06220` ✓, kMaX-DeepLab `2207.04044` ✓, DETR `2005.12872` ✓.
- **Amodal / overlapping instance seg:** Semantic Amodal `1509.01329` ✓; amodal panoptic
  **APSNet `2202.11542` ✓** (a pixel can carry >1 class+id); **PAPS `2205.14637` ✓**
  (occlusion-order **layer stack** — cleanest formal model of stacked overlapping instances;
  each layer → its own polygons); ORCNN `1804.08864`★; AISFormer `2210.06323` ✓.
- **Overlapping cells / filaments (bio):** IRNet `1908.06623` ✓; **DoNet `2303.14373` ✓**
  (decomposes clumps into intersection + complement — the trained overlap gold standard);
  ChromSeg/DaCSeg (overlapping chromosomes); crossing MTs → per-filament polylines sharing
  crossover coords (overlap trivial).
- **Native / high-res inference:** semantic tiling is solved (nnU-Net `1904.08128` ✓ +
  MONAI sliding-window, ~50% overlap + Gaussian weighting). **Instance tiling is the hard
  part** — you cannot average label maps; instead run the head per tile then **match & merge
  instances across the overlap band by IoU / containment**, unioning fragments of the _same_
  object (Cellpose `stitch_threshold`; SAM automatic-mask cross-crop NMS `2304.02643` ✓;
  HistomicsTK polygon merge). Genuinely-distinct overlapping objects are never merged because
  each instance is stored separately. Native-res backbones: Swin `2103.14030` ✓; adaptive
  patching `2404.09707` ✓; HRMedSeg `2504.06205` ✓; **DPT decoder `2103.13413`★ already in
  our stack** reassembles DINOv3 tokens into a full-res embedding map cheaply.
- **Mask ↔ polygon round-trip:** mask→polygon = marching-squares + RDP (our existing path);
  polygon→mask = rasterise **each instance to its own binary channel**. Overlap survives iff
  instances are never collapsed to one label image.

## 3. Foundation & few-shot models (the refiner + adaptation)

**Overlap ⇒ independent per-instance mask ⇒ only the SAM-prompt family qualifies as the
final producer.** Drive with **per-object prompts, never the auto-generator** (SAM's AMG uses
box-NMS and collapses overlaps).

| Model         | Input               | Multi-inst     | Multi-class     | Overlap       | Native-res                | Trainable-by-biologist     | Cite                                             |
| ------------- | ------------------- | -------------- | --------------- | ------------- | ------------------------- | -------------------------- | ------------------------------------------------ |
| SAM           | click/box           | ✓              | ✗ (class=meta)  | ✓ prompted    | ◐ tile                    | FT-able                    | `2304.02643` ✓                                   |
| SAM 2         | click/box +video    | ✓              | ✗               | ✓             | ◐ tile                    | FT-able                    | `2408.00714`★                                    |
| **SAM 3**     | **text / exemplar** | ✓ all + ids    | ✓ concept       | ✓             | ◐ tile                    | few-shot HPO               | `2511.16719` ✓                                   |
| HQ-SAM (thin) | click/box           | ✓              | ✗               | ✓             | ◐ + thin-structure fusion | cheap (frozen SAM)         | `2306.01567` ✓                                   |
| micro-SAM     | none/click          | ✓ (AIS)        | ◐               | ✓ interactive | ◐ tile                    | napari HITL, 1–10 imgs     | Nat. Methods 2025 (10.1038/s41592-024-02580-4) ✓ |
| MedSAM        | box                 | ✗              | ✗               | ✓ per-box     | ✗ 1024                    | needs masks                | `2304.12306` ✓                                   |
| Cellpose-SAM  | none                | ✓ (flow)       | ✓ retrain       | ✗ label map   | ◐ 256² tiles              | Cellpose HITL ~100–200 ROI | bioRxiv 2025.04.28.651001 ✓                      |
| CellSAM       | none                | ✓ (detect→SAM) | cells           | ✗             | ◐ tiled                   | zero-shot                  | `2311.11004` ✓                                   |
| InstanSeg     | none                | ✓ (embeddings) | ✓ (+ChannelNet) | ✗             | ✓ no tiling               | needs dense                | `2408.15954` ✓                                   |

**Lightweight adaptation ("how few labels is enough"):** micro-SAM decoder FT **1–10 imgs**;
**PTSAM prompt-tuning 2,048 params / 16 imgs, microscopy-validated `2504.16739` ✓**;
PerSAM-F 2 params / 1 img `2305.03048` ✓; SAMed LoRA `2304.13785`; Dino U-Net (frozen DINOv3

- 5.1M-param head) `2508.20909` ✓; DINOv2 `2304.07193`; **DINOv3 `2508.10104` ✓** (Gram
  anchoring fixes dense-feature degradation, supports up to 4k input). Detail-recovery add-ons:
  FeatUp `2403.10516` ✓, BRIXEL `2511.05168` ⚠️, DPT `2103.13413`★.

**Reuse frozen DINOv3-L?** Yes as the shared propose backbone + blob head (already loaded;
DINOv3 best-available dense frozen features; immediate few-shot value via matching; light head
biologist-trainable). Cons/risks: **patch stride 16 → a 1–3 px MT is sub-patch** (needs high
input res + tiling + DPT/FeatUp detail decode + likely light encoder adaptation on the
filament arm); frozen features are **semantic not instance** and **cannot express overlap**
(overlap = the SAM-prompt path); natural-RGB pretraining vs 1-channel/16-bit microscopy
domain gap.

## 4. In-context few-shot — principles ("bend for our requirements")

**"In-context" = no weight update:** the frozen model is conditioned at inference by the
example (image+mask) and transfers the labelling. This is the **zero-training round-0 bootstrap**.

**Five principle families:**

1. **Inpainting / "painting"** — segmentation as image-inpainting on a grid canvas; mask as
   colour; SegGPT's trick = random per-sample colour so it must solve in-context colouring.
   Output = semantic colour map; **no overlap; 448px hard cap kills thin filaments.**
   Painter `2212.02499` ✓, SegGPT `2304.03284` ✓.
2. **Dense feature correspondence / prototype** _(the family for us)_ — cosine-match query
   patches to the example's masked features in frozen DINOv3 space; per-instance reference →
   per-instance mask. Prototype variants → semantic map; match→SAM variants → binary
   instance(s). **Shape-agnostic; native-res if run high-res + DPT decode (not SAM
   point-prompts, which blob on 1px).** Matcher `2305.13310` ✓ (bidirectional match +
   k-means++ prompts → SAM, EMD/purity/coverage scoring; can emit multiple instances);
   PerSAM/-F `2305.03048` ✓; SEGIC `2311.14671` ✓; SINE `2410.04842` ✓;
   **INSID3 `2603.28480` ✓ (CVPR'26, training-free, frozen DINOv3-L, no SAM, 1024²+CRF,
   55.1 mIoU, 304M params vs ~945M SAM-based)**; FSSDINO `2602.07550` ✓ (prototypes + Gram
   refine; native multi-class; **intermediate DINOv3 layers beat last by 6–13 mIoU but no
   heuristic reliably picks them → expose the layer as tunable**); FS-DINO `2504.15669` ✓;
   SANSA `2505.21795` ✓; DC-SAM `2504.12080` ✓; ProtoSAM `2407.07042` ✓.
3. **Support-set conditioning networks** — a purpose-built net fuses a whole support set via
   cross-image blocks in one pass. UniverSeg `2304.06131` ✓ (CrossBlock; binary per class;
   ~128²; best with ~64 support pairs); Tyche `2401.13650` ✓ (in-context **stochasticity** →
   K candidate masks = free uncertainty signal; context set ~16); Neuralizer `2305.02644` ✓;
   **MultiverSeg `2412.15058` ✓ (interactive growing-context loop — the closest published
   analog to our AL loop).** Output = semantic; **no overlap; ~128² worst native-res.**
4. **Visual in-context prompting / detect-all** _(the family that gives instances)_ — one
   exemplar → a "concept" query → **every matching object decodes to its own mask + id.**
   **The only family that natively emits separated instances from one example.**
   DINOv `2311.13601` ✓; T-Rex2 `2403.14610` ✓; **SAM 3 PCS `2511.16719` ✓**; Grounded-SAM
   `2401.14159` ✓; DINO-X `2411.14347` ✓. Overlap = modal-yes (each instance independent);
   **box/query bottleneck is poor for filaments (degenerate boxes, NMS on crowded MTs),
   great for blobs.**
5. **Diffusion / SSL correspondence features** — feature bank for family 2, not a path (low-res,
   blurry; worse than DINOv3 for 1px). DIFT `2306.03881` ✓, SD+DINO `2305.15347` ✓.

**Instance decomposition — the one rule that governs overlap.** Turning a semantic proposal
into instances:

- **Rank 1 (PRESERVES overlap, best for filaments):** per-exemplar / per-instance matching —
  each labelled instance is its own reference → its own mask → overlaps legal by construction.
  Matcher, PerSAM, SEGIC/SAMIC `2412.11998` ✓.
- **Rank 2 (instances direct, overlap OK):** detect-all — SAM 3 PCS, T-Rex2/DINO-X→SAM boxes.
- **Rank 3 (preservable, good for blobs, poor filaments):** seed SAM from distance-transform
  peaks / eroded components (+ negative prompts to split neighbours); keep masks as a binary
  stack. Nucleus prompter `2311.15939` ✓, CellSAM, CryoSAM `2407.06833` ✓, Group Prompting
  `2605.29429` ✓, ProtoSAM.
- **Rank 4 (DESTROYS overlap — never for filaments):** connected-components / watershed /
  flow-field tracking — one pixel → one instance, crossings cut at the overpass.

**Bio in-context specifics:** every dedicated in-context _medical_ model outputs a
**semantic/binary map, not instances** → instance separation is always a bolt-on.
UniverSeg 1–8 works / 32–64 saturates; Tyche 16-context/K=8; IMIS-Net `2411.12814` ✓;
SynthMT (bioRxiv 10.64898/2026.01.09.698597; PLOS CB pcbi.1013901) ⚠️no-arXiv — **the
in-domain proof point: classical + foundation models fail zero-shot on MT IRM, but
text-prompted SAM 3 reaches near-human after ~10 synthetic tuning images.**

**Realistic label budget:** blobs 1–5 exemplars/class; filaments ~5–10; in-context semantic
quality 16–64 support/class; specialisation jump PTSAM 16 imgs / micro-SAM 5–10 imgs;
**first usable specialist ~100–200 corrected objects; near-max ~500–1,000; HITL ≈ 3–4× more
label-efficient than drawing from scratch.**

## 5. Bioimage generalists (what to reuse / emulate)

- **Omnipose** (Nat. Methods 2022; 10.1038/s41592-022-01639-4) — distance-field flow
  (unit-magnitude, medial-axis), morphology/topology-independent → **the clearest single-model
  "filaments AND blobs"**, but **2D cannot represent overlap/self-contact.** Use only as an
  optional non-overlapping blob accelerator.
- **Cellpose 2.0 / -SAM** (Nat. Methods 2022 10.1038/s41592-022-01663-4; bioRxiv
  2025.04.28.651001) — center-seeking flow (fragments elongated cells); **HITL retrain from
  ~100–200 ROI in <1 min**; Cellpose-SAM ships **DINOv3 `cpdino` variants** (validates our
  encoder→seg choice). **CC-BY-NC weights** (licensing flag).
- **InstanSeg `2408.15954` ✓** — embedding head (no shape prior → elongated OK), ChannelNet
  (arbitrary channels), **native-res without tiling**, TorchScript, ≥60% faster than Cellpose.
  No overlap (embedding → one instance per pixel); needs dense labels.
- **StarDist `1806.03535` ✓** — star-convex polygon + class head + NMS = **only deep generalist
  with native multi-class AND overlap**, but **cannot do filaments** (star-convex prior).
- Mesmer/DeepCell (Nat. Biotech 2022); Piximi (in-browser _classifier_ training, not
  instance-seg); ilastik (Nat. Methods 2019, interactive RF).

**UX patterns to copy for non-experts:** one visible "Train" button with defaults + time/cost
estimate; live-preview overlay (QuPath live-update; Biodock purple prelabels); warm-start
retrain + auto-advance to next unlabeled (Cellpose GUI); SAM-in-the-loop click grammar
(left=+, right=−, box, embed-once-per-image); "draw one → find all similar" (exemplar box);
confidence-sorted "fix these" queue with a suggested count; separate model-error vs
label-error queues (Labelbox); per-patch Done toggle + progress bar for gigapixel.
Serve pixels as a tile pyramid (OpenSeadragon/DZI), store polygons in full-res global coords.

## 6. Active learning as sequential Bayesian design

**Framing (verified):** pool-based AL = sequential **Bayesian optimal experimental design** on
a discrete pool — BO's sibling. BO optimises a scalar function over a continuous space with a
GP surrogate; AL optimises **model generalisation** over a finite pool with **the model's own
predictive uncertainty** as surrogate. Refs: MacKay 1992 (Neural Comp., info-based objectives);
Lindley 1956★ (EIG); Roy & McCallum ICML'01 (expected error reduction — the philosophical
match to "reduce the final model's error"); **Modern Bayesian Experimental Design `2302.14545`
✓** (frames AL as discrete-domain sequential BED); BO tutorial `1807.02811` ✓; unifying view
`2208.00549` ✓.

**Acquisition recipe (targets generalisation, overlap- & cost-aware):**

- **Round 0 (cold start, no model):** **TypiClust `2202.02794` ✓** / **ProbCover `2205.11320`
  ✓** on frozen DINOv3-L — diverse, _typical_ seed. Do NOT use uncertainty at round 0
  (cold-start pathology `2210.02442` ✓).
- **Generalisation-targeted score: EPIG `2304.08151` ✓** (Expected Predictive Information Gain).
  Target distribution = the whole unlabeled pool ⇒ scores "which label most reduces predictive
  uncertainty across the dataset" (not parameter info, i.e. plain BALD `1112.5745` ✓, which
  chases irrelevant globally-uncertain inputs). Semi-supervised EPIG follow-up `2404.17249` ✓.
  **Caveat: published EPIG is classification; overlapping-instance version is our extension.**
- **Cost trick:** DINOv3-L frozen ⇒ cache features once, run all uncertainty through the
  **small head only** (head-only MC-dropout — Bayesian SegNet `1511.02680` ✓; or a cheap
  ensemble of heads). Cheapest surrogates: **learning-loss `1905.03677` ✓** (single pass);
  **DDU/GDA density on frozen features `2102.11582` ✓** (single pass, gives uncertainty AND
  typicality free); TTA/equivariance disagreement `2308.10727` ✓.
- **Overlap-safe instance uncertainty:** SAM refiner per-mask IoU/stability + TTA disagreement
  per instance; **never pixel-softmax entropy** (assumes non-overlapping labels). MaskAL
  `2112.06586` ✓ (instance AL for Mask R-CNN).
- **Batch diversity:** **BADGE `1906.03671` ✓** (k-means++ on small-head gradient embeddings)
  or k-center `1708.00489`★ / ProbCover on frozen features; **PowerBALD `2106.12059` ✓**
  (stochastic score sampling) if compute-bound. BatchBALD `1906.08158` ✓ principled but
  combinatorially expensive at native res.
- **Correction signal (honest):** model-pre-label vs human-correction disagreement is a
  _measured_ informativeness signal (grounded in EGL/expected-model-change: Settles 2009;
  Freytag EMOC 2014 10.1007/978-3-319-10593-2*37; `1612.06129` ✓; learn-AL `1703.03365` ✓).
  **But it is lagging (known only after paying for the label) and conflates informativeness
  with image difficulty** → use to reweight \_future* rounds + detect convergence, NOT the
  current pick. No single paper establishes it as an acquisition score — motivated design
  choice. Segmentation correction-loop precedents: CEAL `1711.09168` ✓; active label
  correction `2403.10820` ⚠️.
- **Stopping / "after N":** composite — validation IoU plateau + prediction stability on a
  fixed stop-set (Bloodgood `0907.1814` ✓; error stability `2104.01836` ✓; predicted-F change
  `1901.09118` ✓) + falling correction rate + flattening acquisition scores + marginal-gain <
  label-cost (10.1007/s10994-022-06253-1).
- **Region/patch AL (phase 2):** native-res tiles as the query unit — RIPU `2111.12940` ✓
  (impurity × uncertainty), CEREALS `1810.09726` ✓ (cost-model grid), superpixel AL (Cai
  CVPR'21), ViewAL `1911.11789` ✓, EquAL `2008.01860` ✓.

**Honest caveats (verified):** _Parting with Illusions_ `1912.05361` ✓, _Best Practices_
`2302.04075` ✓, and **nnActive `2511.19183` ✓** show AL gains often **collapse to random**
once SSL + augmentation are added; no method reliably beat **foreground-aware random** in 3D
biomedical seg. And there is **no published AL for amodal/overlapping instances** — the
instance scoring is genuinely novel. Mitigation: always run a **random-selection control arm**
and benchmark against it; the pre-label-and-correct loop delivers the ~3–4× efficiency
**regardless** of whether the acquisition beats random.

## 7. Recommended architecture + AL recipe (synthesis)

> **Simplified per user directive (2026-07-09): ONE UNIVERSAL MODEL, NO MORPHOLOGY ARMS.**
> The two-stream (detect-all for blobs + correspondence-trace for filaments) is dropped. Single
> path = **per-instance dense correspondence on frozen DINOv3 (INSID3-lineage) + agglomerative
> clustering → per-instance native-res mask**, identical for blobs and filaments (correspondence
> has no shape prior). Blob→polygon, thin→skeletonize to polyline as an _editor representation_,
> not a model branch. Trade-off accepted: 1–3 px microtubules lean on native resolution + the
> correction loop rather than a filament-specific arm (lower peak MT accuracy for a unified model).
> The steps below still hold; ignore the per-morphology branching in step 1–2.

1. **Round 0:** frozen DINOv3-L embeddings → TypiClust seed. Biologist annotates ~5–20 polygon
   exemplars/class. In-context pre-label the whole dataset: **per-instance DINOv3 correspondence
   (INSID3/Matcher-style) + SAM 3 detect-all for blobs**, kept **un-merged** (no argmax) so
   overlaps survive; filaments traced via PySOAX/RDP, not SAM point-prompts.
2. **Refine:** proposals → prompts → SAM 2 (blobs) / HQ-SAM / SAM 3 thin-line (filaments) →
   crisp native-res per-instance masks → polygons/polylines (own binary channel each).
3. **Acquire:** EPIG (target = pool) via head-only uncertainty; batch-diversify with BADGE;
   cost-weight by predicted correction effort. Show a live "fix these" queue + convergence curve.
4. **Correct → grow context (MultiverSeg pattern) → warm-start retrain** the ~5M-param head
   (minutes); at ~16 imgs optionally PTSAM (2,048 params) / micro-SAM decoder FT.
5. **Stop** on the composite convergence signal. Always keep a random-control arm.
6. **Native-res scale (phase 3):** tile acquisition + tiled inference + cross-tile IoU stitch +
   tile-pyramid viewer; polygons in global full-res coords.

**Editor reuse:** keep engine/interactions/rendering/persistence; strip
polyline-mode/video/MT/sperm; add a generic project-scoped `ClassLabel{id,name,color}` registry

- single `classId` per polygon (model on the existing MT type-label palette). Filaments keep the
  polyline primitive as a per-class geometry, not a project-type mode.

## 8. Decisions (LOCKED 2026-07-09)

1. **ML direction:** **Option A (learning loop), but IN-CONTEXT-FIRST** — user wants weights to
   change as little as possible ("spíš to bylo vše in context"). "Learning" = a **growing curated
   memory bank of DINOv3 prototypes + exemplar masks** (non-parametric, zero gradient); AL curates
   the bank to be dataset-representative. **Only parametric touch = PTSAM-style prompt-tuning
   (~2,048 params, frozen encoder/decoder) for the filament arm if in-context plateaus** — no
   LoRA/full fine-tune by default. Bonus: per-user state = a cheap memory bank, not model weights →
   dissolves the concurrent-per-user-training / GPU concern. Ceiling risk: pure in-context may not
   match a fine-tuned specialist on 1-px filaments.
2. **Overlap scope:** **arbitrary overlap incl. same-class** (crossing filaments) → per-instance
   masks/polylines everywhere; never watershed/flow for filaments.
3. **Licensing:** **academic / ÚTIA** → Cellpose/Omnipose CC-BY-NC available as an optional blob
   accelerator; SAM/SAM 2 permissive; DINOv3 / SAM 3 own licenses.
4. **Compute:** **serialize training behind inference** — and the in-context-first design makes
   this nearly free (only re-embedding new exemplars + optional minutes-long prompt-tuning).

## 9. Key risks

- Thin filaments (sub-patch at stride-16) + amodal overlap are where **every** model is weakest
  → the human-correction stage carries the load; budget for it.
- AL may not beat random (see §6 caveats) → control arm mandatory; value is robust via HITL.
- EPIG + overlapping-instance uncertainty is an unproven combination → prototype + benchmark.
- SAM 3 / INSID3 / SynthMT and most 2025–26 IDs are very recent preprints → reported ≠ reproduced.
- Per-dataset training × many users vs a saturated GPU → scheduling / cost risk.

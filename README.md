# Personal Klecks fork

This fork starts with these changes:
- Up to 255 layers, including folders.
- New documents start with a transparent paint layer and a separate white background.
- White/transparent background selection in New Image and below the layer list.
- Background state follows undo/redo, browser storage, recovery, and image exports.
- PSD exports represent white paper as a marked bottom layer for other readers. This fork restores unchanged marked paper as document background when reopening the PSD. Edited or unmarked paper remains an ordinary layer.

Drawing, pen input, and UI behavior are evaluated manually. The layer limit is a cap, not a guarantee that every canvas size fits in device memory.

New Image accepts dimensions up to 8192 × 8192. Its initial width is the rounded screen.width × devicePixelRatio estimate (capped at 8192); the initial image is square. Ratio presets run from landscape through square to portrait and preserve the last-focused dimension while calculating the other (width by default). If only one dimension is valid, that dimension is used as the reference. Dimensions can also be entered independently.

In Settings, Diagnostics starts a local recording for up to two minutes. Switch back to the brush and reproduce the issue, then use the floating stop/save button. The JSON report contains browser/device capabilities, project dimensions/layer counts, optional JS heap data, pointer events and input decisions, and timing summaries. Image pixels are not included and logs are not uploaded. Recordings are bounded; the report states how many old events were discarded. Save before reloading or starting another recording.

Timing values measure JavaScript work and requestAnimationFrame cadence, not completed GPU work or CPU/GPU utilization. Layer RGBA memory is a theoretical estimate, separate from the optional JS heap measurement. Unsupported browser information is reported as unavailable. Diagnostics itself adds some overhead; it is off by default.

Build and launch commands are listed below. Magic wand and SAI2 import/export are still planned.



## Layer folders: stage 2

The former rename button now adds a folder. Names can still be renamed by double-clicking. Drag onto the middle of a folder row to move inside; its upper/lower edge moves above/below it. The triangle folds its children. Adding a paint layer while a folder is selected puts it inside.

Folders support nesting, visibility, opacity, isolated blend modes, and pass-through. A clipping layer immediately above a folder uses that folder's composite as its base; clipping chains remain within the same parent. A clipped pass-through folder is isolated to provide that base. Folders hold no paint pixels, so paint, selection transforms, and layer filters require selecting a paint layer. Duplicate/delete operate on the whole subtree. Merge-down requires two paint siblings; Merge All flattens the document.

Hierarchy is included in undo/redo, browser saves/recovery, and PSD import/export. Folders count toward the 255-layer cap. Masks are not editable yet: PSD masks are still applied on import, with a warning; applying a group mask to individual children can differ from masking the completed composite. Group masks are part of stage 3.

This stage awaits human drawing/UI verification on Windows and Xiaomi Pad. Check nested folders, moves in/out, visibility/opacity, pass-through versus normal, clipping above folders, undo/redo, and PSD save/reopen. Static type/build checks do not establish pixel parity with SAI2 or Photoshop.

## Layer blend modes: stage 1

The layer menu now contains the 26 modes from the supplied SAI2 menu, in that order. Added modes are linear burn (陰影), linear dodge/add (発光), linear light (明暗), vivid light (焼き・覆い), pin light, hard mix, darker/lighter color, subtract and divide. PSD import/export and browser recovery retain their mode identifiers.

Existing Canvas2D modes retain their native rendering path. Extended modes use an on-demand WebGL composite with a CPU fallback. The same layer compositor is used by the viewport, previews, merged output and layer merge; PSD group conversion also uses the blend helper. No SAI2 file reader/writer, editable groups or masks are introduced by this stage.

The implementation follows the existing SAI2-to-PSD mapping, [Adobe's blend-mode descriptions](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html) and [W3C alpha compositing](https://www.w3.org/TR/compositing-1/). This is not a claim of pixel-exact SAI2/Photoshop compatibility: application-specific opacity, rounding and color-management behavior need human comparison. GPU execution and drawing/UI behavior have not been tested by Codex.

Human acceptance for this stage: reopen the PSD containing 発光; compare the individual modes at full and partial opacity against SAI2; check transparent edges and clipping; save/reopen a PSD and check mode names and appearance. Color reproduction was confirmed manually before stage 2. Editable masks remain a later stage.

## Personal fork backlog (2026-10-15)

### Possible upstream bug: inconsistent dimension limits

- Upstream main at 7b1d474 computes the general canvas limit as min(4096, max(2048, screen.width, screen.height)) in kl-app.ts, while PSD metadata validation independently hard-codes 4096 in kl-app-import-handler.ts.
- The separate limits are verified; whether this distinction is intentional is unknown. Do not describe upstream as having a universally fixed 2048px limit.
- In this fork, the leftover PSD constant rejected a 2976 × 4175 document after the general limit had been raised to 8192. Fixed by using klMaxCanvasSize (4e92354).
- Keep as a possible bug / limit-consistency improvement for a later upstream proposal together with related findings. No upstream issue or PR has been filed for this item. Investigate rationale before proposing unification; unification can change allowed import sizes.

### Required editable document features

User confirmed all three as essential after importing an existing PSD:

1. Layer groups: preserve nested hierarchy rather than ungrouping or compositing imported groups; support group editing, visibility, opacity and group compositing semantics. A group must also be a clipping base: a sibling layer above the group can clip to the group composite, rather than to an individual child. Preserve this relationship through edits, undo, storage and file round trips; account for group masks, opacity and pass-through behavior when defining the composite.
2. All blend modes supported by SAI2: inventory the actual SAI2 modes and rendering behavior before implementation; map PSD equivalents where possible and explicitly handle modes without an equivalent. Matching names alone does not establish matching output. The user identified the unsupported mode in the reported PSD as SAI2 発光 (Shine). Existing sai2-parser docs/format-notes.md and crates/sai2-psd/src/lib.rs map SAI2 `add ` to PSD `lddg` (Linear Dodge/Add). Before stage 1, Klecks storage/psd.ts lacked that mapping and fell back to normal with a warning; stage 1 adds the mapping and rendering path. Reuse the existing SAI2/PSD inventory rather than reconstructing it from names; retain its stated uncertainties (especially the provisional Pin Light correspondence). The reported PSD binary itself has not been inspected.
3. Non-destructive layer masks: retain masks as separately editable data rather than baking them into pixels. Account for group masks as part of the group/mask design.

Stage 2 PSD conversion (src/app/script/klecks/storage/psd.ts) preserves group structure, still applies masks to pixels, and warns about unsupported features. The reported warning is evidence of conversion limitations, not proof that the image is preserved exactly.

Design the layer tree, masks and compositing together before implementing individual UI controls. Include undo/redo, browser persistence/recovery, and PSD import/export in the scope so structures survive saving and reopening. SAI2 import/export remains a subsequent compatibility goal. Existing required magic-wand selection work remains on the backlog.

Implementation order agreed with the user:

1. Layer blend modes: implement the SAI2 mode inventory, including 発光 / Linear Dodge (Add), with import/export mappings. Deliver a usable build for human checks of rendering and file compatibility.
2. Layer groups: support nested groups and clipping layers above a group, using the group as the clipping base. Deliver a usable build for human checks of group operations, compositing and saved structure.
3. Layer masks: support non-destructive masks on both individual layers and layer groups. Deliver a usable build for human checks of mask editing, group masking and saved structure.

At each stage, incorporate human verification feedback before proceeding to the next stage. Plan the shared data/compositing model with later group masks in mind, but deliver features in the order above. Drawing, visual fidelity and interaction verification remain human tasks; do not run automated browser/drawing tests without a new request.

---

<div align="center">
 <img src="https://bitbof.com/stuff/2022-01-klecks/2026-04-06-logo.png" alt="Klecks" title="Klecks">
</div>

<div align="center">
  Modern and feature-rich painting app for the web
</div>

<div align="center">
  <h3>
    <a href="https://kleki.com">
      Try it out
    </a>
    <span> | </span>
    <a href="https://kleki.com/about/">
      About
    </a>
    <span> | </span>
    <a href="https://blog.kleki.com">
      Dev Blog
    </a>
    <span>
  </h3>
</div>

<p align="center">
<img src="https://bitbof.com/stuff/2022-01-klecks/2026-03-28-klecks-github.png" alt="Klecks"><br>
</p>

Klecks (German for "splash of color", pronounced "clex") is the official open-source release of the free online painting app [Kleki](https://kleki.com).

Klecks can run in standalone mode (e.g. on [kleki.com](https://kleki.com)), or embed (e.g. on [2draw.net](https://2draw.net)) for drawing communities.

## Features
- Layers
- Pen-support with pressure and stabilizer
- Touch gestures
- Brushes: pen, blend, sketchy, pixel, chemy, smudge, eraser
- Tools: selection, paint bucket, text, shapes, gradient
- WebGL-powered filters: blur, tilt-shift, curves, distort, noise.
- Lineart extraction
- Editing tools: transform, warp, crop/expand, resize, perspective
- Supports all major form factors: desktop, tablet and phone
- Multi-language (10+ languages)

---

Created by developer/artist [bitbof](https://bitbof.com)

---

# Commands
- initialize via `npm ci` (requires node and npm to be installed already)
- `npm run icon:build` - generate icon files necessary to run Klecks
- `npm run lang:build` - generate language files necessary to run Klecks
- `npm run lang:build -- --missing` - generate language files and list all keys with a missing translation.
- `npm run start` - dev server (to run `standalone` locally)
- `npm run build` - build `standalone` into `/dist/`
- `npm run build:embed` - build `embed` into `/dist/`

# Embed
Example usage of the embed can be found under: `/examples/embed/`

# Docker
To run Klecks (standalone) within a Docker container, run the following commands in project root:

`docker-compose build`

`docker-compose up -d`

It is then accessible through: http://localhost:5050

# Contributing

How you can contribute to this project:
- Bug reporting (detailed bug reports that are reproducible)
- Contribute to a translation (see below)
- Give it a star

# Translations
Are you a native speaker or have advanced skills in a language? Any contribution by you is highly encouraged and appreciated!

### Where are translation files?
Translations are located in `src/languages` where each translation is its own JSON5 file, e.g. `de.json5` for German.
Within such a file everything except `value` is to be kept in sync with `_base-en.json5`.

### Structure of a translation file
```json5
{
  // key by which this text is referenced in code
  stabilizer: {
    
    // A hint, further explaining the text
    hint: 'Common feature in drawing software to make lines smoother',
    
    // Original text (English)
    original: 'Stabilizer',
    
    // Translated text
    value: '抖动修正'
  },
  // ...
}
```

### Creating/editing a translation
To **create a new translation** run `npm run lang:add <code>`, which creates `src/languages/<code>.json5`. You find all
(ISO 639-1) language codes in `src/languages/languages.json`. The generated file will already include everything except `value`.
To **edit an existing translation**, simply edit one of the files in `src/languages`. If a language file is out of sync with
`src/languages/_base-en.json5` (English), whatever key is out of sync will be ignored and fall back on English. English is the
source of truth. A translation cannot add new keys without them also being present in `_base-en.json5`.

To **see your changes** in Klecks, run `npm run lang:build`. It needs to be run whenever changes to `src/languages` are
made or it won't be up-to-date. Then build or start Klecks.

A translation should try not to cause additional line-breaks in the UI if possible. Test to make sure translations
fit the context of the application. Note, some texts are only visible in the standalone-version and vice versa with
the embed-version.

### List of commands
- `npm run lang:add <code>` - creates new language file `src/languages/<code>.json5`.
  - See (ISO 639-1) language codes in `src/languages/languages.json`
- `npm run lang:sync <code>` - synchronizes with base file. (TODO)
- `npm run lang:build` - generates JSON & TS files in `src/app/languages`
  - Problems are printed to the command line output

# License

bitbof © 2026 - Released under the MIT License. Icons by bitbof are public domain (excluding the Klecks logo, bitbof logo).
While Kleki and Klecks are jointly developed, Kleki's license is separate from Klecks. Kleki at [kleki.com](https://kleki.com) is free to use, but the name and brand "Kleki" are not covered by this license — you may not use Klecks to offer a service branded or presented as "Kleki" without a license from bitbof.

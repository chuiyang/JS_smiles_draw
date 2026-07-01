# RDKit Bond Energy Viewer

An interactive RDKit.js page that accepts a SMILES string and a JSON bond-energy dictionary. Bonds named in the dictionary receive a translucent pale-yellow underlay while a second, unmodified RDKit rendering keeps the original bond strokes on top. Every atom receives an explicit element label, including carbon.

For a labeled C-H or O-H bond, the numeric key uses the bond index from RDKit after `AddHs`. When a dictionary key exceeds the original SMILES bond count, the app automatically expands hydrogens, keeps only H atoms attached through labeled bonds, removes every unlabeled H again, and remaps the surviving bond indices for drawing. The page lists the available AddHs H-bond indices.

The **Molecule scale** control zooms the SVG `viewBox`, keeping atom glyphs, bonds, highlights, and notes sharp and synchronized. RDKit still draws the underlying vector depiction with a fixed 80 px bond length.

Bond highlights use a fixed RDKit `highlightBondWidthMultiplier` of `20`.

Bond-dictionary values are displayed verbatim. Numeric values are converted to plain text without adding units; string values are left unchanged.

The **Copy image** button serializes the visible SVG, renders it to a 1600 px-wide PNG, and writes the PNG to the browser clipboard. It includes atom labels, original bonds, highlight underlays, and bond-note overlays.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## RDKit.js capability note

This project pins `@rdkit/rdkit@2025.3.4-1.0.0` (RDKit core `2025.03.4`). The core drawing system supports arbitrary `bondNote` properties, `annotationFontScale` / `fontFile`, and highlighted bond lists. The published JavaScript `JSMol` interface exposes molecule-level `set_prop()`, but not a bond-level property setter. Consequently this browser-only implementation uses RDKit's own SVG bond geometry and native bond highlighting, then adds the supplied bond labels as an SVG text layer. This also makes browser font-family selection possible without loading a font into the WebAssembly virtual filesystem.

# RDKit Bond Energy Viewer

An interactive RDKit.js page that accepts a SMILES string and a JSON bond-energy dictionary. Bonds named in the dictionary receive a translucent pale-yellow underlay while a second, unmodified RDKit rendering keeps the original bond strokes on top. Every atom receives an explicit element label, including carbon.

For a labeled C-H or O-H bond, write the hydrogen explicitly in the SMILES (for example `O[H]`). Implicit hydrogens do not have RDKit bond indices; the app parses with `removeHs: false` so explicit hydrogen bonds remain available to the bond dictionary.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## RDKit.js capability note

This project pins `@rdkit/rdkit@2025.3.4-1.0.0` (RDKit core `2025.03.4`). The core drawing system supports arbitrary `bondNote` properties, `annotationFontScale` / `fontFile`, and highlighted bond lists. The published JavaScript `JSMol` interface exposes molecule-level `set_prop()`, but not a bond-level property setter. Consequently this browser-only implementation uses RDKit's own SVG bond geometry and native bond highlighting, then adds the supplied bond labels as an SVG text layer. This also makes browser font-family selection possible without loading a font into the WebAssembly virtual filesystem.

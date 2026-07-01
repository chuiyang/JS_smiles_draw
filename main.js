const $ = (selector) => document.querySelector(selector);

const controls = $("#controls");
const drawing = $("#drawing");
const error = $("#error");
const summary = $("#summary");
const fontSize = $("#font-size");
const fontSizeValue = $("#font-size-value");
const fontFamily = $("#font-family");
const atomFontSize = $("#atom-font-size");
const atomFontSizeValue = $("#atom-font-size-value");
const moleculeScale = $("#molecule-scale");
const moleculeScaleValue = $("#molecule-scale-value");
const hBondInfo = $("#h-bond-info");
const copyButton = $("#copy-image");
const copyButtonLabel = $("#copy-image-label");

// Central drawing defaults. `fontFile` may also point to a TTF file loaded
// into RDKit's WebAssembly filesystem; the built-in Telex font needs no file.
const DRAW_DEFAULTS = Object.freeze({
  atomFontSize: 20,
  atomFontFile: "BuiltinTelexRegular",
  bondNoteFontSize: 17,
  highlightBondWidthMultiplier: 20,
  highlightOpacity: 0.42,
  fixedBondLength: 80,
  moleculeScalePercent: 150,
});

const ELEMENT_SYMBOLS = [
  "", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
  "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
  "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
  "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
];

let RDKit;
let currentMol;

function parseBondDict(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Bond dict 必須是 JSON object，例如 {\"0\": 348}。");
  }

  return Object.entries(parsed).map(([index, value]) => {
    if (!/^\d+$/.test(index)) throw new Error(`Bond index「${index}」必須是 0 或正整數。`);
    if (typeof value !== "number" && typeof value !== "string") {
      throw new Error(`Bond ${index} 的 energy 必須是數字或字串。`);
    }
    return [Number(index), String(value)];
  });
}

function getBondGeometry(svg, bondIndex) {
  const paths = [...svg.querySelectorAll(`path.bond-${bondIndex}`)];
  const points = [];

  for (const path of paths) {
    const numbers = (path.getAttribute("d") || "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      points.push([Number(numbers[i]), Number(numbers[i + 1])]);
    }
  }

  if (!points.length) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  let endpoints = [points[0], points[points.length - 1]];
  let longest = -1;
  for (const first of points) {
    for (const second of points) {
      const distance = (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2;
      if (distance > longest) {
        longest = distance;
        endpoints = [first, second];
      }
    }
  }

  const [start, end] = endpoints;
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    nx: -(end[1] - start[1]) / length,
    ny: (end[0] - start[0]) / length,
  };
}

function addBondLabels(svg, labels) {
  const ns = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(ns, "g");
  layer.setAttribute("class", "bond-label-layer");
  layer.style.setProperty("--label-size", `${fontSize.value}px`);
  layer.style.setProperty("--label-font", fontFamily.value);
  svg.append(layer);

  const viewBox = svg.viewBox.baseVal;
  const moleculeCenter = { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
  const placedBoxes = [];

  for (const [bondIndex, text] of labels) {
    const geometry = getBondGeometry(svg, bondIndex);
    if (!geometry) continue;

    const offset = Math.max(18, Number(fontSize.value) * 1.25);
    const firstCandidate = {
      x: geometry.x + geometry.nx * offset,
      y: geometry.y + geometry.ny * offset,
    };
    const secondCandidate = {
      x: geometry.x - geometry.nx * offset,
      y: geometry.y - geometry.ny * offset,
    };
    const distanceFromCenter = (point) => (point.x - moleculeCenter.x) ** 2 + (point.y - moleculeCenter.y) ** 2;
    const useFirst = distanceFromCenter(firstCandidate) > distanceFromCenter(secondCandidate);
    const position = useFirst ? firstCandidate : secondCandidate;
    const direction = useFirst
      ? { x: geometry.nx, y: geometry.ny }
      : { x: -geometry.nx, y: -geometry.ny };

    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", "bond-energy-label");
    group.setAttribute("transform", `translate(${position.x} ${position.y})`);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.textContent = text;
    group.append(label);
    layer.append(group);

    const box = label.getBBox();
    const overlaps = (candidate) => placedBoxes.some((placed) => !(
      candidate.right + 6 < placed.left ||
      candidate.left - 6 > placed.right ||
      candidate.bottom + 6 < placed.top ||
      candidate.top - 6 > placed.bottom
    ));
    const globalBox = () => ({
      left: position.x + box.x,
      right: position.x + box.x + box.width,
      top: position.y + box.y,
      bottom: position.y + box.y + box.height,
    });
    for (let attempt = 0; attempt < 7 && overlaps(globalBox()); attempt += 1) {
      position.x += direction.x * 15;
      position.y += direction.y * 15;
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    }
    placedBoxes.push(globalBox());

    const background = document.createElementNS(ns, "rect");
    background.setAttribute("x", String(box.x - 7));
    background.setAttribute("y", String(box.y - 3));
    background.setAttribute("width", String(box.width + 14));
    background.setAttribute("height", String(box.height + 6));
    background.setAttribute("rx", "5");
    group.prepend(background);
  }

}

function insertHighlightUnderlay(svg, highlightedMarkup, bondIndices) {
  const ns = "http://www.w3.org/2000/svg";
  const highlightedSvg = new DOMParser().parseFromString(highlightedMarkup, "image/svg+xml");
  const layer = document.createElementNS(ns, "g");
  layer.setAttribute("class", "bond-highlight-underlay");

  for (const bondIndex of bondIndices) {
    const paths = highlightedSvg.querySelectorAll(`path.bond-${bondIndex}`);
    for (const path of paths) {
      const isFilledHighlight = path.style.fill && path.style.fill !== "none";
      const isWideHighlightStroke = Number.parseFloat(path.style.strokeWidth) > 3;
      if (isFilledHighlight || isWideHighlightStroke) {
        const clone = path.cloneNode(true);
        clone.style.opacity = String(DRAW_DEFAULTS.highlightOpacity);
        layer.append(clone);
      }
    }
  }

  // Insert the yellow layer before every original RDKit bond/atom path.
  // The untouched black/red bond strokes are therefore always painted on top.
  const firstDrawingPath = svg.querySelector("path");
  svg.insertBefore(layer, firstDrawingPath);
}

function getAtomLabels(moleculeData) {
  const defaultAtomicNumber = moleculeData.defaults?.atom?.z ?? 6;
  const atoms = moleculeData.molecules[0].atoms;
  return Object.fromEntries(atoms.map((atom, index) => {
    const atomicNumber = atom.z ?? defaultAtomicNumber;
    return [index, ELEMENT_SYMBOLS[atomicNumber] ?? `Z${atomicNumber}`];
  }));
}

function applyMoleculeScale(svg, percent) {
  const original = svg.viewBox.baseVal;
  const zoom = Number(percent) / 100;
  const width = original.width / zoom;
  const height = original.height / zoom;
  const x = original.x + (original.width - width) / 2;
  const y = original.y + (original.height - height) / 2;
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
}

function describeHydrogenBonds(moleculeData) {
  const molecule = moleculeData.molecules[0];
  const defaultAtomicNumber = moleculeData.defaults?.atom?.z ?? 6;
  const atomicNumber = (index) => molecule.atoms[index].z ?? defaultAtomicNumber;
  return molecule.bonds.flatMap((bond, index) => {
    const [first, second] = bond.atoms;
    const firstZ = atomicNumber(first);
    const secondZ = atomicNumber(second);
    if (firstZ !== 1 && secondZ !== 1) return [];
    const heavyAtom = firstZ === 1 ? second : first;
    return [{ index, heavyAtom, symbol: ELEMENT_SYMBOLS[atomicNumber(heavyAtom)] }];
  });
}

function trimUnlabeledHydrogens(molblock, labeledBondIndices) {
  const lines = molblock.replace(/\r/g, "").split("\n");
  const countsIndex = lines.findIndex((line) => line.includes("V2000"));
  if (countsIndex < 0) throw new Error("Selective hydrogen display currently requires a V2000 MolBlock.");

  const atomCount = Number.parseInt(lines[countsIndex].slice(0, 3), 10);
  const bondCount = Number.parseInt(lines[countsIndex].slice(3, 6), 10);
  const atomStart = countsIndex + 1;
  const bondStart = atomStart + atomCount;
  const atomLines = lines.slice(atomStart, bondStart);
  const bondLines = lines.slice(bondStart, bondStart + bondCount);
  const symbols = atomLines.map((line) => line.slice(31, 34).trim());
  const bonds = bondLines.map((line, index) => ({
    index,
    first: Number.parseInt(line.slice(0, 3), 10) - 1,
    second: Number.parseInt(line.slice(3, 6), 10) - 1,
    line,
  }));

  const labeled = new Set(labeledBondIndices);
  const keptHydrogens = new Set();
  for (const bond of bonds) {
    if (!labeled.has(bond.index)) continue;
    if (symbols[bond.first] === "H") keptHydrogens.add(bond.first);
    if (symbols[bond.second] === "H") keptHydrogens.add(bond.second);
  }

  const keptAtoms = atomLines.map((_, index) => symbols[index] !== "H" || keptHydrogens.has(index));
  const atomMap = new Map();
  const newAtomLines = [];
  keptAtoms.forEach((keep, oldIndex) => {
    if (!keep) return;
    atomMap.set(oldIndex, newAtomLines.length);
    newAtomLines.push(atomLines[oldIndex]);
  });

  const bondMap = new Map();
  const newBondLines = [];
  for (const bond of bonds) {
    if (!keptAtoms[bond.first] || !keptAtoms[bond.second]) continue;
    bondMap.set(bond.index, newBondLines.length);
    const first = String(atomMap.get(bond.first) + 1).padStart(3, " ");
    const second = String(atomMap.get(bond.second) + 1).padStart(3, " ");
    newBondLines.push(`${first}${second}${bond.line.slice(6)}`);
  }

  const countsLine = `${String(newAtomLines.length).padStart(3, " ")}${String(newBondLines.length).padStart(3, " ")}${lines[countsIndex].slice(6)}`;
  const tail = lines.slice(bondStart + bondCount).flatMap((line) => {
    const match = line.match(/^M  (CHG|ISO|RAD)\s+\d+(.+)$/);
    if (!match) return [line];
    const values = match[2].trim().split(/\s+/).map(Number);
    const remapped = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      const oldAtom = values[index] - 1;
      if (!atomMap.has(oldAtom)) continue;
      remapped.push(atomMap.get(oldAtom) + 1, values[index + 1]);
    }
    if (!remapped.length) return [];
    const entries = [];
    for (let index = 0; index < remapped.length; index += 2) {
      entries.push(`${String(remapped[index]).padStart(4, " ")}${String(remapped[index + 1]).padStart(4, " ")}`);
    }
    return [`M  ${match[1]}${String(remapped.length / 2).padStart(3, " ")}${entries.join("")}`];
  });
  const trimmed = [
    ...lines.slice(0, countsIndex),
    countsLine,
    ...newAtomLines,
    ...newBondLines,
    ...tail,
  ].join("\n");

  return { molblock: trimmed, bondMap };
}

function prepareMolecule(smiles, labels) {
  const inputMol = RDKit.get_mol(smiles, JSON.stringify({ removeHs: false }));
  if (!inputMol?.is_valid()) throw new Error("RDKit 無法解析這個 SMILES，請檢查語法。");

  const inputData = JSON.parse(inputMol.get_json());
  const inputBondCount = inputData.molecules[0].bonds.length;
  const needsExpandedHs = labels.some(([index]) => index >= inputBondCount);
  if (!needsExpandedHs) {
    hBondInfo.textContent = "";
    return { mol: inputMol, labels, sourceBondCount: inputBondCount };
  }

  const expandedMol = RDKit.get_mol(inputMol.add_hs(), JSON.stringify({ removeHs: false }));
  inputMol.delete();
  const expandedData = JSON.parse(expandedMol.get_json());
  const expandedBondCount = expandedData.molecules[0].bonds.length;
  const invalid = labels.find(([index]) => index >= expandedBondCount);
  if (invalid) {
    expandedMol.delete();
    throw new Error(`Bond index ${invalid[0]} 超出 AddHs 後的範圍 0–${expandedBondCount - 1}。`);
  }

  const hydrogenBonds = describeHydrogenBonds(expandedData);
  hBondInfo.textContent = `AddHs H-bonds: ${hydrogenBonds.map(({ index, symbol, heavyAtom }) => `${index}=${symbol}${heavyAtom}–H`).join(", ")}`;
  const trimmed = trimUnlabeledHydrogens(expandedMol.get_molblock(), labels.map(([index]) => index));
  expandedMol.delete();

  const selectiveMol = RDKit.get_mol(trimmed.molblock, JSON.stringify({ removeHs: false }));
  if (!selectiveMol?.is_valid()) throw new Error("無法建立選擇性含氫分子圖。");
  const remappedLabels = labels.map(([oldIndex, value]) => {
    const newIndex = trimmed.bondMap.get(oldIndex);
    if (newIndex === undefined) throw new Error(`Bond ${oldIndex} 在選擇性含氫處理後不存在。`);
    return [newIndex, value];
  });
  return { mol: selectiveMol, labels: remappedLabels, sourceBondCount: expandedBondCount };
}

function inlineExportStyles(sourceSvg, exportedSvg) {
  const sourceNodes = sourceSvg.querySelectorAll(".bond-label-layer text, .bond-label-layer rect");
  const exportedNodes = exportedSvg.querySelectorAll(".bond-label-layer text, .bond-label-layer rect");
  sourceNodes.forEach((source, index) => {
    const target = exportedNodes[index];
    if (!target) return;
    const style = getComputedStyle(source);
    target.setAttribute("style", [
      `fill:${style.fill}`,
      `stroke:${style.stroke}`,
      `stroke-width:${style.strokeWidth}`,
      `opacity:${style.opacity}`,
      `font-family:${style.fontFamily}`,
      `font-size:${style.fontSize}`,
      `font-weight:${style.fontWeight}`,
      `letter-spacing:${style.letterSpacing}`,
    ].join(";"));
  });
}

async function svgToPngBlob(svg) {
  const exportedSvg = svg.cloneNode(true);
  inlineExportStyles(svg, exportedSvg);
  const viewBox = svg.viewBox.baseVal;
  const width = 1600;
  const height = Math.round(width * viewBox.height / viewBox.width);
  exportedSvg.setAttribute("width", String(width));
  exportedSvg.setAttribute("height", String(height));
  exportedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const svgBlob = new Blob([new XMLSerializer().serializeToString(exportedSvg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("無法將 SVG 轉換成圖片。"));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("PNG 產生失敗。")),
      "image/png",
    ));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function copyMoleculeImage() {
  const svg = drawing.querySelector("svg");
  if (!svg) return;
  if (!navigator.clipboard?.write || !globalThis.ClipboardItem) {
    throw new Error("此瀏覽器不支援直接複製 PNG 圖片。");
  }
  const png = await svgToPngBlob(svg);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

function render() {
  error.textContent = "";
  try {
    const inputLabels = parseBondDict($("#bond-dict").value);
    currentMol?.delete();
    const prepared = prepareMolecule($("#smiles").value.trim(), inputLabels);
    currentMol = prepared.mol;
    const labels = prepared.labels;

    const moleculeData = JSON.parse(currentMol.get_json());
    const bondCount = moleculeData.molecules[0].bonds.length;

    const highlightedBonds = labels.map(([index]) => index);
    const atomLabels = getAtomLabels(moleculeData);
    const baseOptions = {
      width: 900,
      height: 560,
      bonds: [],
      highlightColour: [1.0, 0.89, 0.35],
      fillHighlights: true,
      continuousHighlight: false,
      highlightBondWidthMultiplier: DRAW_DEFAULTS.highlightBondWidthMultiplier,
      scaleHighlightBondWidth: true,
      annotationFontScale: Number(fontSize.value) / 14,
      atomLabels,
      fontFile: DRAW_DEFAULTS.atomFontFile,
      minFontSize: Number(atomFontSize.value),
      maxFontSize: Number(atomFontSize.value),
      fixedBondLength: DRAW_DEFAULTS.fixedBondLength,
      backgroundColour: [1, 1, 1],
      padding: 0.12,
    };
    const highlightedOptions = { ...baseOptions, bonds: highlightedBonds };
    const baseMarkup = currentMol.get_svg_with_highlights(JSON.stringify(baseOptions));
    const highlightedMarkup = currentMol.get_svg_with_highlights(JSON.stringify(highlightedOptions));

    drawing.innerHTML = baseMarkup;
    const svg = drawing.querySelector("svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Molecule rendered from ${$("#smiles").value.trim()}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    insertHighlightUnderlay(svg, highlightedMarkup, highlightedBonds);
    addBondLabels(svg, labels);
    applyMoleculeScale(svg, moleculeScale.value);
    copyButton.disabled = false;
    summary.textContent = prepared.sourceBondCount === bondCount
      ? `${bondCount} bonds · ${labels.length} labeled`
      : `${bondCount} visible · ${prepared.sourceBondCount} after AddHs · ${labels.length} labeled`;
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}

controls.addEventListener("submit", (event) => {
  event.preventDefault();
  render();
});

copyButton.addEventListener("click", async () => {
  error.textContent = "";
  copyButton.disabled = true;
  copyButtonLabel.textContent = "Copying…";
  try {
    await copyMoleculeImage();
    copyButton.classList.add("is-copied");
    copyButtonLabel.textContent = "Copied!";
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    copyButtonLabel.textContent = "Copy failed";
  } finally {
    copyButton.disabled = false;
    setTimeout(() => {
      copyButton.classList.remove("is-copied");
      copyButtonLabel.textContent = "Copy image";
    }, 1800);
  }
});

fontSize.addEventListener("input", () => {
  fontSizeValue.textContent = `${fontSize.value} px`;
  if (RDKit) render();
});

fontFamily.addEventListener("change", () => RDKit && render());

atomFontSize.addEventListener("input", () => {
  atomFontSizeValue.textContent = `${atomFontSize.value} px`;
  if (RDKit) render();
});

moleculeScale.addEventListener("input", () => {
  moleculeScaleValue.textContent = `${moleculeScale.value}%`;
  if (RDKit) render();
});

async function initialize() {
  try {
    RDKit = await globalThis.initRDKitModule({
      locateFile: (file) => `/vendor/${file}`,
    });
    fontSize.value = String(DRAW_DEFAULTS.bondNoteFontSize);
    atomFontSize.value = String(DRAW_DEFAULTS.atomFontSize);
    moleculeScale.value = String(DRAW_DEFAULTS.moleculeScalePercent);
    $("#version").textContent = `RDKit ${RDKit.version()} · WASM ready`;
    render();
  } catch (cause) {
    error.textContent = `RDKit 載入失敗：${cause instanceof Error ? cause.message : cause}`;
    drawing.innerHTML = "<p>WebAssembly module could not be loaded.</p>";
  }
}

initialize();

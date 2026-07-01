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
const highlightWidth = $("#highlight-width");
const highlightWidthValue = $("#highlight-width-value");

// Central drawing defaults. `fontFile` may also point to a TTF file loaded
// into RDKit's WebAssembly filesystem; the built-in Telex font needs no file.
const DRAW_DEFAULTS = Object.freeze({
  atomFontSize: 20,
  atomFontFile: "BuiltinTelexRegular",
  bondNoteFontSize: 17,
  highlightBondWidthMultiplier: 9,
  highlightOpacity: 0.42,
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
    return [Number(index), typeof value === "number" ? `${value} kJ/mol` : value];
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

function render() {
  error.textContent = "";
  try {
    const labels = parseBondDict($("#bond-dict").value);
    currentMol?.delete();
    // Explicit [H] atoms must survive parsing so C-H/O-H bonds keep an index.
    currentMol = RDKit.get_mol($("#smiles").value.trim(), JSON.stringify({ removeHs: false }));
    if (!currentMol?.is_valid()) throw new Error("RDKit 無法解析這個 SMILES，請檢查語法。");

    const moleculeData = JSON.parse(currentMol.get_json());
    const bondCount = moleculeData.molecules[0].bonds.length;
    const invalid = labels.find(([index]) => index >= bondCount);
    if (invalid) throw new Error(`Bond index ${invalid[0]} 超出範圍；此分子共有 ${bondCount} 個 bonds（0–${bondCount - 1}）。`);

    const highlightedBonds = labels.map(([index]) => index);
    const atomLabels = getAtomLabels(moleculeData);
    const baseOptions = {
      width: 900,
      height: 560,
      bonds: [],
      highlightColour: [1.0, 0.89, 0.35],
      fillHighlights: true,
      continuousHighlight: false,
      highlightBondWidthMultiplier: Number(highlightWidth.value),
      scaleHighlightBondWidth: true,
      annotationFontScale: Number(fontSize.value) / 14,
      atomLabels,
      fontFile: DRAW_DEFAULTS.atomFontFile,
      minFontSize: Number(atomFontSize.value),
      maxFontSize: Number(atomFontSize.value),
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
    summary.textContent = `${bondCount} bonds · ${labels.length} labeled`;
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}

controls.addEventListener("submit", (event) => {
  event.preventDefault();
  render();
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

highlightWidth.addEventListener("input", () => {
  highlightWidthValue.textContent = `${highlightWidth.value}×`;
  if (RDKit) render();
});

async function initialize() {
  try {
    RDKit = await globalThis.initRDKitModule({
      locateFile: (file) => `/vendor/${file}`,
    });
    fontSize.value = String(DRAW_DEFAULTS.bondNoteFontSize);
    atomFontSize.value = String(DRAW_DEFAULTS.atomFontSize);
    highlightWidth.value = String(DRAW_DEFAULTS.highlightBondWidthMultiplier);
    $("#version").textContent = `RDKit ${RDKit.version()} · WASM ready`;
    render();
  } catch (cause) {
    error.textContent = `RDKit 載入失敗：${cause instanceof Error ? cause.message : cause}`;
    drawing.innerHTML = "<p>WebAssembly module could not be loaded.</p>";
  }
}

initialize();

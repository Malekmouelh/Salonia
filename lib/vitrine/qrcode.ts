// Générateur QR Code vectoriel autonome (zéro dépendance externe).
// Conforme ISO/IEC 18004 (Mode Byte, Correction d'erreur L/M, Galois Field GF(2^8)).
// Génère du SVG ultra-net et léger, parfait pour affichage écran et impression affiches (F1.3 & F1.4).

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

// Initialisation de la table de logarithmes / exponentielles de Galois GF(256) avec polynôme 0x11D (285)
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 285;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

// Calcul des polynômes générateurs Reed-Solomon
function rsGenPoly(nsym: number): number[] {
  let g = [1];
  for (let i = 0; i < nsym; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= gfMul(g[j], GF_EXP[i]);
      next[j + 1] ^= g[j];
    }
    g = next;
  }
  return g;
}

function rsEncode(msg: number[], nsym: number): number[] {
  const gen = rsGenPoly(nsym);
  const out = new Array(msg.length + nsym).fill(0);
  for (let i = 0; i < msg.length; i++) {
    out[i] = msg[i];
  }
  for (let i = 0; i < msg.length; i++) {
    const coef = out[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        out[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return out.slice(msg.length);
}

// Spécifications de versions pour URLs de salon
// Capacité Byte pour ECC L (Low):
// V1: 21x21, 19 data bytes, 7 EC
// V2: 25x25, 34 data bytes, 10 EC
// V3: 29x29, 55 data bytes, 15 EC
// V4: 33x33, 80 data bytes, 20 EC
// V5: 37x37, 108 data bytes, 26 EC
// V6: 41x41, 136 data bytes, 18 EC (2 blocs)
const VERSIONS = [
  { version: 1, size: 21, dataCap: 17, totalCap: 26, ecCount: 7, align: [] },
  { version: 2, size: 25, dataCap: 32, totalCap: 44, ecCount: 10, align: [6, 18] },
  { version: 3, size: 29, dataCap: 53, totalCap: 70, ecCount: 15, align: [6, 22] },
  { version: 4, size: 33, dataCap: 78, totalCap: 100, ecCount: 20, align: [6, 26] },
  { version: 5, size: 37, dataCap: 106, totalCap: 134, ecCount: 26, align: [6, 30] },
  { version: 6, size: 41, dataCap: 134, totalCap: 172, ecCount: 36, align: [6, 34] },
];

export function generateQrCodeMatrix(text: string): boolean[][] {
  const enc = new TextEncoder().encode(text);
  const vSpec = VERSIONS.find((v) => enc.length <= v.dataCap) || VERSIONS[VERSIONS.length - 1];
  const { size, dataCap, totalCap, ecCount, align } = vSpec;

  // 1. Bitstream (Mode Byte = 0100 + Length)
  const bits: number[] = [0, 1, 0, 0];
  const len = Math.min(enc.length, dataCap);
  for (let i = 7; i >= 0; i--) bits.push((len >> i) & 1);
  for (let i = 0; i < len; i++) {
    for (let b = 7; b >= 0; b--) bits.push((enc[i] >> b) & 1);
  }

  // Terminaison
  while (bits.length < dataCap * 8 && bits.length % 8 !== 0) bits.push(0);
  while (bits.length < dataCap * 8) {
    if (bits.length + 8 <= dataCap * 8) {
      // Octets de remplissage alternés 236 et 17
      const pad = (bits.length / 8) % 2 === 0 ? 0xec : 0x11;
      for (let b = 7; b >= 0; b--) bits.push((pad >> b) & 1);
    } else {
      bits.push(0);
    }
  }

  // Conversion bits -> octets
  const dataBytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i + b] || 0);
    dataBytes.push(byte);
  }

  // 2. Correction d'erreur Reed-Solomon
  const ecBytes = rsEncode(dataBytes, ecCount);
  const allCodewords = [...dataBytes, ...ecBytes];

  // 3. Matrice QR (true = noir, false = blanc, null = non encore affecté)
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setModule = (r: number, c: number, val: boolean, isFunc = true) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val;
      if (isFunc) isFunction[r][c] = true;
    }
  };

  // 4. Motifs de localisation (Finder Patterns 7x7) + Séparateurs
  const drawFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (r === -1 || r === 7 || c === -1 || c === 7) {
          setModule(row, col, false);
        } else if (r === 0 || r === 6 || c === 0 || c === 6) {
          setModule(row, col, true);
        } else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
          setModule(row, col, true);
        } else {
          setModule(row, col, false);
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 5. Motifs d'alignement pour v >= 2
  if (align.length >= 2) {
    const coords = align;
    for (const ar of coords) {
      for (const ac of coords) {
        if (
          (ar === 6 && ac === 6) ||
          (ar === 6 && ac === size - 7) ||
          (ar === size - 7 && ac === 6)
        ) {
          continue; // Ne pas chevaucher les finders
        }
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
            const isCenter = r === 0 && c === 0;
            setModule(ar + r, ac + c, isBorder || isCenter);
          }
        }
      }
    }
  }

  // 6. Bandes de synchronisation (Timing Patterns)
  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0;
    if (matrix[6][i] === null) setModule(6, i, val);
    if (matrix[i][6] === null) setModule(i, 6, val);
  }

  // 7. Module sombre
  setModule(size - 8, 8, true);

  // 8. Informations de format (ECC L, Mask 0 = 0b111011111000100)
  // Format info précalculé pour Mask 0 & ECC L avec BCH(15,5) masqué par 101010000010010
  const FORMAT_BITS = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  // Autour du finder supérieur gauche
  const formatCoordsTopLeft: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = formatCoordsTopLeft[i];
    setModule(r, c, FORMAT_BITS[i] === 1);
  }

  // Copies sous le finder supérieur droit et en bas à gauche
  for (let i = 0; i < 8; i++) {
    setModule(8, size - 1 - i, FORMAT_BITS[i] === 1);
  }
  for (let i = 8; i < 15; i++) {
    setModule(size - 15 + i, 8, FORMAT_BITS[i] === 1);
  }

  // 9. Placement des données en zigzag
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  const getBit = (idx: number) => {
    if (idx >= totalBits) return false;
    const byte = allCodewords[Math.floor(idx / 8)];
    const bitPos = 7 - (idx % 8);
    return ((byte >> bitPos) & 1) === 1;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // La colonne 6 est réservée au timing vertical
    const left = right - 1;

    const rowStart = upward ? size - 1 : 0;
    const rowEnd = upward ? -1 : size;
    const rowStep = upward ? -1 : 1;

    for (let row = rowStart; row !== rowEnd; row += rowStep) {
      for (const col of [right, left]) {
        if (!isFunction[row][col]) {
          const rawBit = getBit(bitIdx++);
          // Masque 0 : (row + col) % 2 === 0
          const mask = (row + col) % 2 === 0;
          matrix[row][col] = mask ? !rawBit : rawBit;
        }
      }
    }
    upward = !upward;
  }

  return matrix.map((row) => row.map((cell) => cell ?? false));
}

export function generateQrCodeSvg(
  text: string,
  options: { size?: number; color?: string; bgColor?: string; quietZone?: number } = {},
): string {
  const matrix = generateQrCodeMatrix(text);
  const matrixSize = matrix.length;
  const quietZone = options.quietZone ?? 4;
  const totalDim = matrixSize + quietZone * 2;
  const displaySize = options.size ?? 240;
  const color = options.color ?? "#2a0f25";
  const bgColor = options.bgColor ?? "#ffffff";

  // Construction d'un chemin SVG optimisé (<path d="..." />)
  let pathD = "";
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        pathD += `M${c + quietZone},${r + quietZone}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalDim} ${totalDim}" width="${displaySize}" height="${displaySize}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="${bgColor}" rx="12" />
  <path d="${pathD.trim()}" fill="${color}" />
</svg>`;
}

export function generateQrCodeDataUrl(
  text: string,
  options: { size?: number; color?: string; bgColor?: string } = {},
): string {
  const svg = generateQrCodeSvg(text, options);
  const utf8 = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${utf8}`;
}

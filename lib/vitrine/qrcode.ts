import QRCode from "qrcode";

/**
 * Génère la matrice booléenne du QR code (true = noir, false = blanc).
 * Conforme ISO/IEC 18004 via le standard officiel `qrcode`.
 */
export function generateQrCodeMatrix(text: string): boolean[][] {
  const safeText = text && text.trim().length > 0 ? text.trim() : "https://salonia.tn";
  const qr = QRCode.create(safeText, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const matrix: boolean[][] = [];

  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) {
      row.push(Boolean(qr.modules.get(r, c)));
    }
    matrix.push(row);
  }

  return matrix;
}

/**
 * Génère un SVG vectoriel ultra-net du QR Code, scannable immédiatement par n'importe quel smartphone.
 */
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

  // Construction du chemin vectoriel <path d="..." />
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

/**
 * Génère une URL Data (image/svg+xml) pour téléchargement ou balise <img />.
 */
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

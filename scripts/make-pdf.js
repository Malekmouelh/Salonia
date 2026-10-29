const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const htmlPath = path.resolve(__dirname, "..", "report_soutenance.html");
const pdfPath = path.resolve(__dirname, "..", "Rapport_Technique_Module1_Vitrine_Ghalia.pdf");
const artifactPdfPath = "C:\\Users\\mimou\\.gemini\\antigravity-ide\\brain\\448cbd24-92ae-4267-b2b5-4f2283f1c21f\\Rapport_Technique_Module1_Vitrine_Ghalia.pdf";

console.log("Generating PDF from:", htmlPath);
console.log("Output PDF target:", pdfPath);

const res = spawnSync(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ],
  { stdio: "inherit" }
);

if (fs.existsSync(pdfPath)) {
  const stats = fs.statSync(pdfPath);
  console.log(`Success! PDF generated: ${pdfPath} (${stats.size} bytes)`);
  // Copy to brain artifact directory as well
  fs.copyFileSync(pdfPath, artifactPdfPath);
  console.log(`Copied to artifact directory: ${artifactPdfPath}`);
} else {
  console.error("Failed to generate PDF. Return code:", res.status);
}

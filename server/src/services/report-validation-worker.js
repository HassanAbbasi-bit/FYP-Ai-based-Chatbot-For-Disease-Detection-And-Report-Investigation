const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs/promises");
(async () => {
  const stat = await fs.stat(workerData.filename);
  if (stat.size < 1 || stat.size > workerData.maxBytes) throw new Error("INVALID_FILE");
  const bytes = await fs.readFile(workerData.filename); // Already bounded on disk and by stat.
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const pdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  let type;
  if (png || jpeg) {
    const sharp = require("sharp");
    sharp.cache(false); sharp.concurrency(1);
    const options = { failOn: "warning", limitInputPixels: workerData.maxPixels, sequentialRead: true };
    const image = sharp(bytes, options);
    const metadata = await image.metadata();
    if (metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > workerData.maxPixels || (metadata.pages || 1) > 1) throw new Error("IMAGE_DIMENSIONS");
    if (metadata.format !== (png ? "png" : "jpeg")) throw new Error("INVALID_FILE");
    await image.stats(); // Decode pixels, not just the header.
    type = png ? "image/png" : "image/jpeg";
  } else if (pdf) {
    if (!/%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1"))) throw new Error("INVALID_FILE");
    const { PDFDocument } = require("@cantoo/pdf-lib");
    let document;
    try { document = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: true, updateMetadata: false }); }
    catch {
      // Strict object parsing can fail on encrypted streams before encryption is reported.
      try {
        const encrypted = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        if (encrypted.isEncrypted) throw new Error("ENCRYPTED_PDF");
      } catch (error) { if (error.message === "ENCRYPTED_PDF") throw error; }
      throw new Error("INVALID_FILE");
    }
    if (document.isEncrypted) throw new Error("ENCRYPTED_PDF");
    const pages = document.getPages();
    if (pages.length < 1 || pages.length > 200) throw new Error("PDF_PAGES");
    for (const page of pages) {
      const size = page.getSize();
      if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0 || size.width > 14400 || size.height > 14400) throw new Error("INVALID_FILE");
    }
    type = "application/pdf";
  } else throw new Error("UNSUPPORTED_FILE");
  parentPort.postMessage({ fileType: type });
})().catch((error) => {
  const allowed = ["INVALID_FILE", "UNSUPPORTED_FILE", "ENCRYPTED_PDF", "IMAGE_DIMENSIONS", "PDF_PAGES"];
  parentPort.postMessage({ error: allowed.includes(error.message) ? error.message : /pixel limit/i.test(error.message) ? "IMAGE_DIMENSIONS" : "INVALID_FILE" });
});

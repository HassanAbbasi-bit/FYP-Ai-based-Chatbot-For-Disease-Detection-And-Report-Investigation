const sharp = require("sharp");
const { PDFDocument } = require("@cantoo/pdf-lib");
const { randomUUID } = require("node:crypto");
async function syntheticReports() {
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#176b75" } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer();
  const document = await PDFDocument.create();
  document.addPage([200, 200]).drawText("SYNTHETIC TEST ONLY", { x: 10, y: 100, size: 10 });
  const pdf = Buffer.from(await document.save());
  const encrypted = await PDFDocument.create(); encrypted.addPage([100, 100]);
  await encrypted.encrypt({ userPassword: "synthetic-password", ownerPassword: "synthetic-owner" });
  return { png, jpeg, pdf, encrypted: Buffer.from(await encrypted.save()) };
}
async function upload(fixture, browser, bytes, { name = "synthetic.png", type = "image/png", id = randomUUID(), csrf = true, extraFile, field, extraField, origin = fixture.config.origin } = {}) {
  const body = new FormData();
  if (bytes !== undefined) body.append(field || "file", new Blob([bytes], { type }), name);
  if (extraFile) body.append("file", new Blob([bytes], { type }), name);
  if (extraField) body.append("ownerId", "untrusted-owner");
  const headers = { Cookie: browser.cookie, Origin: origin, "x-upload-id": id };
  if (csrf && browser.token) headers["x-csrf-token"] = browser.token;
  const response = await fetch(`${fixture.base}/api/reports`, { method: "POST", headers, body });
  return { response, status: response.status, data: await response.json() };
}
module.exports = { syntheticReports, upload };

const fs = require('node:fs/promises');
const { PDFDocument, rgb } = require('@cantoo/pdf-lib');
const { ReportError } = require('./report-errors');
async function factualPdf({ report, review, fontPath, generatedAt = new Date() }) {
 const pdf=await PDFDocument.create(); pdf.registerFontkit(require('@cantoo/fontkit'));
 let bytes; try { bytes=await fs.readFile(fontPath); } catch { throw new ReportError(503,'EXPORT_FONT_UNAVAILABLE','The export font is unavailable. Use the reviewed table until the server font is configured.'); }
 const kit=require('@cantoo/fontkit').create(bytes), font=await pdf.embedFont(bytes,{subset:true});
 const clean=value=>{const s=String(value??'Unknown');for(const ch of s){const n=ch.codePointAt(0);if(ch==='\n'||ch==='\r'||ch==='\t')continue;if(n<32||!kit.hasGlyphForCodePoint(n))throw new ReportError(422,'EXPORT_TEXT_UNSUPPORTED','The configured PDF font cannot represent some saved text. Original text remains available in the reviewed table; configure a suitable font.');}return s.replace(/\r\n?/g,'\n').replace(/\t/g,'    ');};
 let page,y;const width=499,size=11,lineHeight=16,pages=[];
 function newPage(){page=pdf.addPage([595,842]);pages.push(page);y=785;page.drawText('FYP | Factual reviewed-data export',{x:48,y:810,size:10,font,color:rgb(.1,.3,.4)});}
 function line(text,heading=false){if(y<65)newPage();page.drawText(text,{x:48,y,size:heading?13:size,font,color:rgb(.05,.1,.15)});y-=heading?21:lineHeight;}
 function paragraph(value,heading=false){const text=clean(value),fontSize=heading?13:size;for(const block of text.split('\n')){let buffer='';for(const token of block.split(/( +)/)){if(font.widthOfTextAtSize(buffer+token,fontSize)<=width){buffer+=token;continue;}if(buffer){line(buffer.trimEnd(),heading);buffer='';}if(/^ +$/.test(token))continue;for(const char of token){if(font.widthOfTextAtSize(buffer+char,fontSize)>width){line(buffer,heading);buffer='';}buffer+=char;}}line(buffer.trimEnd(),heading);}y-=6;}
 newPage();paragraph('Factual export - not an AI doctor-visit summary',true);
 if(report.sampleVersion==='synthetic-v1')paragraph('DEMO - dedicated synthetic sample; not a patient report.',true);
 paragraph(`Report: ${report.displayName}`);paragraph(`Report ID: ${report._id}`);paragraph(`User-reviewed revision: ${review.version} | Checked: ${review.reviewedAt?.toISOString()||'Not recorded'}`);paragraph(`Generated: ${generatedAt.toISOString()}`);
 paragraph('Reviewed means checked by the account owner, not clinical validation. This export copies saved values and reported ranges. No interpretation, diagnosis, medical recommendations, range flags or sources are generated. Unknowns stay unknown. Dates below are saved reviewed entries, not upload dates; corrections may be user-entered.');
 for(const [i,row]of review.rows.filter(r=>!r.removed).entries()){if(y<175)newPage();paragraph(`${i+1}. ${row.testName}`,true);paragraph(`Value: ${row.unknown?'Unknown':row.rawValue??'Unknown'}${row.unreadable?' (unreadable)':''} | Unit: ${row.units??'Unknown'}`);paragraph(`Reported reference range: ${row.referenceRange??'Not reported'}`);paragraph(`Saved report date: ${row.reportDate??'Unknown'} | Source page: ${row.sourcePage??'Unknown'} | Provenance: ${row.provenance||'Saved user review'}`);}
 for(const [i,p]of pages.entries())p.drawText(`Revision ${review.version} | Page ${i+1} of ${pages.length}`,{x:48,y:35,size:9,font,color:rgb(.3,.3,.3)});
 pdf.setTitle('Factual reviewed-data export');pdf.setAuthor('FYP application');return Buffer.from(await pdf.save());
}
module.exports={factualPdf};

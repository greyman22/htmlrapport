import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { DomUtils, parseDocument } from 'htmlparser2';
import { createApp } from '../server.js';
import { cleanHtml, escapeHtml, renderReport, safeUrl } from '../lib/html.js';
import { addFootnoteSpacing, convertDocument, normalizeText, repairPdfParagraphFlow } from '../lib/convert.js';
import { planArticle } from '../lib/article-plan.js';

let server;
let base;
const createdFiles = [];
const createdReports = [];
const root = path.join(import.meta.dirname, '..');
const suppliedPdf = path.join(root, 'sources', 'vino-0027_life_science_2025_tillganglig.pdf');
const hasSuppliedPdf = await fs.access(suppliedPdf).then(() => true, () => false);

before(async () => {
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const filename of createdFiles) await fs.unlink(filename);
  for (const id of createdReports) await fs.rm(path.join(root, 'output', id), { recursive: true, force: true });
});

test('HTML escaping and text normalization preserve Swedish text', () => {
  assert.equal(escapeHtml('<script>"Å & ä"</script>'), '&lt;script&gt;&quot;Å &amp; ä&quot;&lt;/script&gt;');
  assert.equal(normalizeText('  före\u00ad\ntag\n  med   forskning '), 'företag med forskning');
  assert.equal(normalizeText('life science-\nsektorn'), 'life science-sektorn');
  assert.equal(normalizeText('2024–2025'), '2024–2025');
});

test('PDF paragraph flow joins syntactic continuations and detached punctuation only', () => {
  const { html, merged } = repairPdfParagraphFlow('<p>Text from the source<a href="#note">2</a></p><p>and the next phrase</p><p>. A new sentence</p><p>.</p><p>A separate paragraph.</p>');
  assert.equal(merged, 3);
  assert.ok(html.includes('Text from the source<a href="#note">2</a> and the next phrase. A new sentence.'));
  assert.ok(html.includes('<p>A separate paragraph.</p>'));
  assert.equal((html.match(/<p>/g) || []).length, 2);
});

test('footnote spacing is inserted after words but not after punctuation or existing spaces', () => {
  const html = addFootnoteSpacing('<p>Word<sup><a role="doc-noteref" href="#not-1">1</a></sup> <a id="footnote-ref-2" href="#footnote-2">[2]</a>. Word.<sup><a role="doc-noteref" href="#not-3">3</a></sup></p>');
  assert.ok(html.includes('Word <sup><a role="doc-noteref"'));
  assert.ok(html.includes('</sup> <a id="footnote-ref-2"'));
  assert.ok(html.includes('Word.<sup><a role="doc-noteref"'));
});

test('Word HTML strips scripts, event handlers, unsafe URLs and remote images', () => {
  const html = cleanHtml('<script>alert(1)</script><p onclick="x()">Text<a href="javascript:alert(1)">länk</a><img src="https://example.com/tracking.png"><img src="data:image/png;base64,AAAA" alt="Bild"></p>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('onclick'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('https://example.com'));
  assert.ok(html.includes('data:image/png;base64,AAAA'));
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://www.vinnova.se/'), 'https://www.vinnova.se/');
});

test('report is a complete Swedish document with a title, landmark and contents', () => {
  const html = renderReport({ title: 'Rapport & forskning', sourceName: 'test.pdf', format: 'PDF', body: '<h2 id="ett">Ett</h2>', headings: [{ id: 'ett', text: 'Ett', level: 2 }], warnings: ['Kontrollera tabeller.'], stats: { pages: 1 } });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<html lang="sv">'));
  assert.ok(html.includes('<title>Rapport &amp; forskning</title>'));
  assert.ok(html.includes('<main id="rapport">'));
  assert.ok(html.includes('href="#ett"'));
});

test('report includes script-free presentation modes sharing the same content', () => {
  const html = renderReport({
    title: 'En rapport <test>', sourceName: 'test.docx', format: 'Word (.docx)',
    body: '<p id="unique-content">Gemensamt rapportinnehåll.</p><aside id="not-1">Fotnot</aside>',
    headings: [{ id: 'unique-content', level: 2, text: 'Innehåll <test>' }], warnings: [], stats: {},
  });
  assert.ok(html.includes('<legend>Visningsläge</legend>'));
  assert.ok(html.includes('id="view-report" value="report" checked'));
  assert.ok(html.includes('id="view-vinnova" value="vinnova"'));
  assert.ok(html.includes('body:has(#view-vinnova:checked)'));
  assert.ok(html.includes('class="standard-header"'));
  assert.ok(html.includes('class="standard-menu"'));
  assert.ok(html.includes('class="standard-footer"'));
  assert.ok(html.includes('Simulerad standardsida'));
  assert.ok(html.includes('En rapport &lt;test&gt;'));
  assert.equal((html.match(/id="unique-content"/g) || []).length, 1);
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  assert.ok(!html.includes('<script'));
});

test('source listing includes the supplied PDF', async () => {
  const response = await fetch(`${base}/api/sources`);
  assert.equal(response.status, 200);
  const sources = await response.json();
  if (hasSuppliedPdf) assert.ok(sources.some(source => source.name === path.basename(suppliedPdf)));
  assert.ok(sources.every(source => !('path' in source)));
});

test('Strapi-exportens testläge är valfritt och avstängt som standard', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="strapi-test"(?![^>]*\bchecked\b)/);
});

test('unknown source IDs and cross-origin conversion requests are rejected', async () => {
  const response = await fetch(`${base}/api/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: Buffer.from('sources/../../secret.pdf').toString('base64url') }) });
  assert.equal(response.status, 400);
  const foreign = await fetch(`${base}/api/convert`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
});

test('invalid PDF and old .doc uploads produce explicit errors', async () => {
  for (const filename of ['fake.pdf', 'old.doc']) {
    const form = new FormData();
    form.append('file', new Blob(['not a document']), filename);
    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
  }
});

async function docxFixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rNote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/test.png"/><Relationship Id="rBad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`);
  zip.file('word/styles.xml', `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="TOC 1"/></w:style></w:styles>`);
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
  <w:p><w:r><w:t>Contents</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>Introduction 2</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>Findings 4</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Svensk innovation och</w:t><w:br/><w:t>digital omställning</w:t></w:r></w:p>
  <w:p><w:r><w:t>Svensk innovation med en fotnot</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
  <w:p><w:hyperlink r:id="rBad"><w:r><w:t>Osäker länk</w:t></w:r></w:hyperlink></w:p>
  <w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Testbild" descr="Ett grönt diagram"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Företag</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`);
  zip.file('word/footnotes.xml', `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Källa: Vinnova, 2025.</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  const canvas = createCanvas(8, 8);
  canvas.getContext('2d').fillRect(0, 0, 8, 8);
  zip.file('word/media/test.png', canvas.toBuffer('image/png'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('DOCX end-to-end: upload, convert, persist, render and download images, tables and footnotes', async () => {
  const form = new FormData();
  form.append('file', new Blob([await docxFixture()]), 'integration-test.docx');
  const upload = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
  assert.equal(upload.status, 201);
  const source = await upload.json();
  createdFiles.push(path.join(root, ...Buffer.from(source.id, 'base64url').toString().split('/')));
  const conversion = await fetch(`${base}/api/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: source.id }) });
  assert.equal(conversion.status, 202);
  let job = await conversion.json();
  createdReports.push(job.id);
  const deadline = Date.now() + 15000;
  while (job.status === 'processing' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    job = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed', job.error);
  assert.equal(job.result.title, 'Svensk innovation och digital omställning');
  assert.equal(job.result.stats.images, 1);
  assert.equal(job.result.stats.footnotes, 1);
  const fragmentContent = await fs.readFile(path.join(root, 'output', job.id, 'content.html'), 'utf8');
  const articlePlan = planArticle({ html: fragmentContent, title: job.result.title, reportId: job.id, format: job.result.format });
  assert.equal(articlePlan.stats.footnotes, 1);
  assert.equal(articlePlan.stats.images, 1);
  assert.equal(articlePlan.images[0].alt, 'Ett grönt diagram');
  assert.equal(articlePlan.stats.tocLines, 2);
  assert.equal(articlePlan.parts.at(-1).kind, 'footnotes');
  assert.ok(articlePlan.parts.some(part => part.kind === 'rich' && part.blocks.some(block => block.type === 'paragraph'
    && block.children.some(child => child.type === 'link' && child.children?.[0]?.text === '[1]'))));
  const report = await fetch(`${base}${job.url}`);
  assert.equal(report.status, 200);
  assert.ok(report.headers.get('content-security-policy').includes("default-src 'none'"));
  const html = await report.text();
  assert.ok(html.includes('Svensk innovation'));
  const heading = DomUtils.findOne(node => node.type === 'tag' && node.name === 'h2'
    && DomUtils.textContent(node).includes('digital omställning'), parseDocument(html));
  assert.ok(heading);
  const lineBreakIndex = heading.children.findIndex(node => node.type === 'tag' && node.name === 'br');
  assert.ok(lineBreakIndex > 0);
  assert.ok(heading.children[lineBreakIndex - 1].data.endsWith('och'));
  assert.ok(heading.children[lineBreakIndex + 1].data.startsWith('digital'));
  assert.ok(html.includes('med en fotnot <sup>'));
  assert.ok(DomUtils.textContent(parseDocument(html)).includes('Källa: Vinnova'));
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(DomUtils.findOne(node => node.type === 'tag' && node.name === 'img' && node.attribs.alt === 'Ett grönt diagram', parseDocument(html)));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('class="table-scroll" tabindex="0"'));
  assert.ok(html.includes('id="view-vinnova"'));
  assert.ok(!html.includes('javascript:'));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]), `Broken anchor ${match[1]}`);
  const download = await fetch(`${base}${job.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.ok(download.headers.get('content-disposition').includes('attachment'));
  const fragment = await (await fetch(`${base}${job.fragmentUrl}`)).text();
  assert.ok(!fragment.includes('<!doctype'));
  assert.ok(!fragment.includes('view-switcher'));
  assert.ok(!fragment.includes('standard-header'));
  assert.ok(fragment.includes('<table>'));
  const history = await (await fetch(`${base}/api/reports`)).json();
  assert.ok(history.some(item => item.id === job.id));
});

test('exempelrapportens TOC och bilder från DOCX-paketet når Strapi-planen', async () => {
  const source = path.join(root, 'sources', 'syntetisk_innovationsrapport_test 1.docx');
  const id = randomUUID();
  createdReports.push(id);
  const directory = path.join(root, 'output', id);
  const result = await convertDocument(source, directory);
  assert.equal(result.stats.images, 5);
  const html = await fs.readFile(path.join(directory, 'content.html'), 'utf8');
  const plan = planArticle({ html, title: result.title, reportId: id, format: result.format });
  assert.equal(plan.stats.tocLines, 12);
  assert.equal(plan.pageNavigation, true);
  assert.equal(plan.stats.images, 5);
  assert.ok(plan.images.some(image => image.alt.startsWith('Figur 1. Syntetisk innovationsmiljö')));
  const blocks = plan.parts.flatMap(part => part.blocks || []);
  const headingIndex = blocks.findIndex(block => block.type === 'heading'
    && block.children.some(child => child.text?.includes('Utgångsläge och syfte')));
  const imageIndex = blocks.findIndex(block => block.type === 'image'
    && plan.images.find(image => image.key === block.imageKey)?.alt.startsWith('Figur 1.'));
  assert.ok(headingIndex >= 0);
  assert.ok(imageIndex > headingIndex);
});

function pdfFixture() {
  const stream = 'BT /F1 24 Tf 40 740 Td (A report for the web) Tj /F1 12 Tf 0 -40 Td (First paragraph.) Tj 0 -24 Td (Second paragraph.) Tj 0 -24 Td (Third paragraph.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

test('PDF end-to-end: local fonts, untagged text fallback and image-only page warning', async () => {
  const form = new FormData();
  form.append('file', new Blob([pdfFixture()]), 'integration-pdf.pdf');
  const upload = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
  assert.equal(upload.status, 201);
  const source = await upload.json();
  createdFiles.push(path.join(root, ...Buffer.from(source.id, 'base64url').toString().split('/')));
  const conversion = await fetch(`${base}/api/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: source.id }) });
  assert.equal(conversion.status, 202);
  let job = await conversion.json();
  createdReports.push(job.id);
  const deadline = Date.now() + 20000;
  while (job.status === 'processing' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    job = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed', job.error);
  assert.equal(job.result.stats.pages, 2);
  assert.ok(job.result.warnings.some(w => w.includes('OCR')));
  assert.ok(job.result.warnings.some(w => w.includes('saknar användbara PDF-taggar')));
  const html = await (await fetch(`${base}${job.url}`)).text();
  assert.ok(html.includes('A report for the web'));
  assert.ok(html.includes('First paragraph.'));
  assert.ok(html.includes('data:image/webp;base64,'));
  assert.ok(html.includes('Visa originalsida 1'));
  assert.ok(html.includes('Sida utan maskinläsbar text'));
});

test('supplied 50-page tagged report preserves headings, figures, text and footnotes', { timeout: 120000, skip: !hasSuppliedPdf }, async () => {
  const id = randomUUID();
  createdReports.push(id);
  const directory = path.join(root, 'output', id);
  const result = await convertDocument(suppliedPdf, directory);
  assert.equal(result.stats.pages, 50);
  assert.ok(result.stats.images >= 15, `Only ${result.stats.images} images found`);
  assert.ok(result.stats.headings >= 20, `Only ${result.stats.headings} headings found`);
  assert.ok(result.stats.footnotes >= 10, `Only ${result.stats.footnotes} footnotes found`);
  const html = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
  const fragment = await fs.readFile(path.join(directory, 'content.html'), 'utf8');
  assert.equal((html.match(/class="source-page"/g) || []).length, 50);
  assert.ok(html.includes('life science'));
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(html.includes('role="doc-noteref"'));
  assert.ok(html.includes('role="doc-footnote"'));
  assert.ok(result.stats.mergedParagraphs > 0);
  const paragraphs = DomUtils.findAll(node => node.type === 'tag' && node.name === 'p', parseDocument(fragment));
  const repairedParagraph = paragraphs.find(node => DomUtils.textContent(node).includes('Metoden ska ta sin utgångpunkt'));
  assert.ok(repairedParagraph);
  assert.match(DomUtils.textContent(repairedParagraph), /Tillväxtanalys 2 och Vinnova 3\. I utvecklingen/);
  assert.match(DomUtils.getOuterHTML(repairedParagraph), /Tillv[^<]+ <sup><a role="doc-noteref"/);
  assert.ok(!paragraphs.some(node => DomUtils.textContent(node).trim() === '.'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate IDs in report');
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), `Broken anchor ${match[1]}`);
});

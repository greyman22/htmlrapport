import test from 'node:test';
import assert from 'node:assert/strict';
import { planArticle, slugify } from '../lib/article-plan.js';
import { exportArticleDraft } from '../lib/article-export.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const html = `<!-- kommentar -->
<section class="source-page"><div class="page-label">Sida 1</div>
<p>Innehåll</p>
<p>1 Inledning ........................ 3</p>
<p>2 Metod ........................ 5</p>
<p>3 Bilaga ........................ 7</p>
</section>
<section class="source-page"><div class="page-label">Sida 2</div>
<h2>Inledning</h2>
<p>Första <strong>stycket</strong> med <a href="https://vinnova.se/x">länk</a> och<sup><a role="doc-noteref" id="notref-1-1" href="#not-1-1">1</a></sup> fotnot.</p>
<ul><li>Punkt ett</li><li>Punkt två</li></ul>
<figure><img src="${png}" alt="En figur"><figcaption>Bildtext</figcaption></figure>
<figure class="source-page-image"><img src="${png}" alt="Scanned page 1"></figure>
<div class="table-scroll"><table><tr><td><p>Cell<sup><a role="doc-noteref" href="#not-1-2">2</a></sup></p></td></tr></table></div>
<p>Efter tabellen.</p>
<details class="original"><summary>Visa originalsida 1</summary><img src="${png}" alt="Originalsida 1"></details>
<aside class="footnotes"><h3>Fotnoter</h3>
<div class="footnote" id="not-1-1">1 Första fotnoten<a class="footnote-back" href="#notref-1-1">↩</a></div>
<div class="footnote" id="not-1-2">2 Andra fotnoten<a class="footnote-back" href="#x">↩</a></div></aside>
</section>
<section class="source-page"><p>Sent stycke</p></section>`;

test('slugify hanterar svenska tecken', () => {
  assert.equal(slugify('Åsa är över Öland!'), 'asa-ar-over-oland');
  const plan = planArticle({ html: '', title: 'Statistik över svenska life science-företag', reportId: '5466cd6f-1234' });
  assert.equal(plan.slug, 'statistik-o-5466cd6f');
  assert.ok(plan.slug.length <= 20);
});

test('planen mappar innehåll till block, bilder och tabeller', () => {
  const plan = planArticle({ html, title: 'Min rapport', reportId: 'abcdef12-0000', format: 'PDF' });
  assert.equal(plan.slug, 'min-rapport-abcdef12');
  assert.equal(plan.images.length, 1);
  assert.equal(plan.images[0].name, 'rv-min-rapport-001.png');
  assert.equal(plan.images[0].caption, 'Bildtext');
  assert.equal(plan.stats.skippedPageImages, 1);
  assert.deepEqual(plan.parts.map(part => part.kind).slice(0, 3), ['rich', 'table', 'rich']);
  const [first] = plan.parts;
  assert.deepEqual(first.blocks.map(block => block.type), ['heading', 'paragraph', 'list', 'image']);
  const paragraph = first.blocks[1].children;
  assert.ok(paragraph.some(node => node.bold && node.text === 'stycket'));
  assert.ok(paragraph.some(node => node.type === 'link' && node.url === 'https://vinnova.se/x'));
  assert.ok(paragraph.some(node => node.type === 'link' && node.url === `/article/${plan.slug}#fotnot-1-1` && node.children[0].text === '[1]'));
  const footnoteIndex = paragraph.findIndex(node => node.type === 'link' && node.url.endsWith('#fotnot-1-1'));
  assert.ok(paragraph[footnoteIndex - 1].text.endsWith(' '));
  assert.ok(plan.parts[1].html.includes('Cell <a href="#fotnot-1-2">[2]</a>') && !plan.parts[1].html.includes('doc-noteref'));
  assert.deepEqual(plan.parts.map(part => part.kind), ['rich', 'table', 'rich', 'footnotes']);
  const last = plan.parts[2].blocks;
  assert.deepEqual(last.map(block => block.type), ['paragraph', 'paragraph', 'heading']);
  const notes = plan.parts[3].html;
  assert.ok(notes.includes('<a name="fotnot-1-1"></a>[1] Första fotnoten'));
  assert.ok(notes.includes('<a name="fotnot-1-2"></a>[2] Andra fotnoten'));
  assert.equal(plan.truncated, false);
  assert.equal(plan.pageNavigation, true);
  assert.equal(plan.stats.tocLines, 3);
  assert.ok(!JSON.stringify(plan.parts).includes('Metod'));
});

test('Word-bilder i egna eller blandade stycken blir bildblock i läsordning', () => {
  const plan = planArticle({
    html: `<h2>Utgångsläge och syfte</h2><p>Före bilden <img src="${png}" alt="Figur 1"> efter bilden</p>`,
    title: 'W',
    reportId: 'abcdef12',
    format: 'Word (.docx)',
  });
  assert.equal(plan.stats.images, 1);
  assert.deepEqual(plan.parts[0].blocks.map(block => block.type), ['heading', 'paragraph', 'image', 'paragraph']);
  assert.equal(plan.images[0].alt, 'Figur 1');
  assert.equal(plan.parts[0].blocks[1].children[0].text, 'Före bilden');
  assert.equal(plan.parts[0].blocks[3].children[0].text, 'efter bilden');
});

test('Word-innehållsförteckning med _Toc-länkar känns igen utan rubrik', () => {
  const docx = '<p><a href="#_Toc1">1 Inledning\t3</a></p><p><a href="#_Toc2">2 Metod\t5</a></p><h1>Inledning</h1><p>Text.</p>';
  const plan = planArticle({ html: docx, title: 'W', reportId: 'abcdef12', format: 'Word (.docx)' });
  assert.equal(plan.stats.tocLines, 2);
  assert.equal(plan.pageNavigation, true);
  assert.deepEqual(plan.parts[0].blocks.map(block => block.type), ['heading', 'paragraph']);
});

test('PDF-TOC upptäcks med strukturerade sidnummer utan punktledare', () => {
  const pdfHtml = '<section class="source-page"><h2>Contents overview</h2><p>1 Introduction 3</p><p>1.1 Background 4</p><p>2 Methodology 8</p><h2>Introduction</h2><p>Text ending in 2024.</p></section>';
  const plan = planArticle({ html: pdfHtml, title: 'PDF', reportId: 'abcdef12', format: 'PDF' });
  assert.equal(plan.stats.tocLines, 3);
  assert.equal(plan.pageNavigation, true);
  assert.deepEqual(plan.parts[0].blocks.map(block => block.type), ['heading', 'paragraph']);
  assert.ok(!JSON.stringify(plan.parts).includes('Methodology'));
});

test('PDF-rader med årtal behålls när TOC-signalerna är svaga', () => {
  const pdfHtml = '<h2>Contents</h2><p>We started collecting data in 2024</p><p>The work continued throughout 2025</p>';
  const plan = planArticle({ html: pdfHtml, title: 'PDF', reportId: 'abcdef12', format: 'PDF' });
  assert.equal(plan.pageNavigation, false);
  assert.equal(plan.stats.paragraphs, 2);
});

test('Word-TOC med stilklass känns igen oberoende av länkformat', () => {
  const docx = '<h2>Table of contents</h2><p class="toc-entry">Introduction &nbsp; 2</p><p class="toc-entry">Findings &nbsp; 4</p><h1>Introduction</h1><p>Text.</p>';
  const plan = planArticle({ html: docx, title: 'W', reportId: 'abcdef12', format: 'Word (.docx)' });
  assert.equal(plan.stats.tocLines, 2);
  assert.deepEqual(plan.parts[0].blocks.map(block => block.type), ['heading', 'paragraph']);
});

test('Word-TOC med opformaterade rader och avslutande sidnummer känns igen', () => {
  const docx = '<p>Innehåll</p><p>Sammanfattning<strong> 3</strong></p>'
    + '<p>1. Utgångsläge och syfte<strong> 4</strong></p>'
    + '<p>2. Metod och avgränsningar<strong> 5</strong></p>'
    + '<p>3. Syntetiska resultat<strong> 6</strong></p>'
    + '<h2>Sammanfattning</h2><p>Rapportens faktiska innehåll börjar här.</p>';
  const plan = planArticle({ html: docx, title: 'W', reportId: 'abcdef12', format: 'Word (.docx)' });
  assert.equal(plan.stats.tocLines, 4);
  assert.equal(plan.pageNavigation, true);
  const blocks = plan.parts.flatMap(part => part.blocks || []);
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph']);
  assert.equal(blocks[0].children[0].text, 'Sammanfattning');
  assert.equal(blocks[1].children[0].text, 'Rapportens faktiska innehåll börjar här.');
});

test('två opformaterade Word-rader med sidnummer räcker inte ensamma för TOC', () => {
  const docx = '<p>Innehåll</p><p>Resultat 2024</p><p>Utveckling 2025</p>';
  const plan = planArticle({ html: docx, title: 'W', reportId: 'abcdef12', format: 'Word (.docx)' });
  assert.equal(plan.stats.tocLines, 0);
  assert.equal(plan.pageNavigation, false);
  assert.equal(plan.stats.paragraphs, 3);
});

test('Word-fotnoter kopplas från referens till lista sist i artikeln', () => {
  const docx = '<h1>Rapport</h1><p>Text<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p><ol><li id="footnote-1"><p>En generell källnot.<a href="#footnote-ref-1">↑</a></p></li></ol>';
  const plan = planArticle({ html: docx, title: 'W', reportId: 'abcdef12', format: 'Word (.docx)' });
  assert.ok(plan.parts[0].blocks[1].children.some(node => node.type === 'link' && node.children[0].text === '[1]'));
  assert.equal(plan.parts.at(-1).kind, 'footnotes');
  assert.ok(plan.parts.at(-1).html.includes('<a name="fotnot-1"></a>[1] En generell källnot.'));
  assert.equal(plan.stats.footnotes, 1);
  assert.ok(!JSON.stringify(plan.parts).includes('footnote-ref-1'));
});

test('mellanslag infogas före Word-fotnoter även efter punkt, men dubbleras inte', () => {
  const docx = '<h1>Rapport</h1>'
    + '<p>Avslutad mening.<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p>'
    + '<p>Redan ett mellanslag. <sup><a href="#footnote-2" id="footnote-ref-2">[2]</a></sup></p>'
    + '<ol><li id="footnote-1"><p>Första noten.</p></li><li id="footnote-2"><p>Andra noten.</p></li></ol>';
  const plan = planArticle({ html: docx, title: 'W', reportId: 'abcdef12', format: 'Word (.docx)' });
  const paragraphs = plan.parts[0].blocks.filter(block => block.type === 'paragraph');
  for (const paragraph of paragraphs) {
    const refIndex = paragraph.children.findIndex(child => child.type === 'link');
    assert.ok(refIndex > 0);
    assert.ok(paragraph.children[refIndex - 1].text.endsWith(' '));
  }
  assert.equal(paragraphs[0].children[0].text, 'Avslutad mening. ');
  assert.equal(paragraphs[1].children[0].text, 'Redan ett mellanslag. ');

  const tablePlan = planArticle({
    html: '<table><tr><td>Avslutad tabelltext.<sup><a role="doc-noteref" href="#not-1-3">3</a></sup></td></tr></table>',
    title: 'W',
    reportId: 'abcdef12',
    format: 'Word (.docx)',
  });
  assert.ok(tablePlan.parts[0].html.includes('Avslutad tabelltext. <a href="#fotnot-1-3">[3]</a>'));
});

test('utan innehållsförteckning ingen sidnavigering och vanliga stycken bevaras', () => {
  const plan = planArticle({ html: '<h2>Innehåll</h2><p>Vanlig text som inte är en förteckning.</p>', title: 'W', reportId: 'abcdef12', format: 'Word (.docx)' });
  assert.equal(plan.pageNavigation, false);
  assert.equal(plan.stats.paragraphs, 1);
});

test('testläget stannar efter första text, bild och tabell men behåller fotnoter', () => {
  const plan = planArticle({ html, title: 'Min rapport', reportId: 'abcdef12-0000', format: 'PDF', testMode: true });
  assert.equal(plan.truncated, true);
  const text = JSON.stringify(plan.parts);
  assert.ok(!text.includes('Sent stycke'));
  assert.ok(text.includes('Efter tabellen') === false);
  assert.ok(text.includes('Andra fotnoten'));
});

test('exporten skapar bilder och tabeller före artikeln', async () => {
  const calls = [];
  const client = {
    articleSlugExists: async () => false,
    findTaxonomyConcept: async query => { calls.push(['taxonomy', query.slug]); return { documentId: 'tax-report' }; },
    uploadImage: async image => { calls.push(['upload', image.name]); return { id: 7, name: image.name }; },
    createHtmlAsset: async asset => { calls.push(['asset', asset.internalName]); return { documentId: `asset-${calls.length}` }; },
    createArticleDraft: async data => { calls.push(['article', data]); return { data: { documentId: 'art-1' } }; },
  };
  const plan = planArticle({ html, title: 'Min rapport', reportId: 'abcdef12-0000', format: 'PDF' });
  const result = await exportArticleDraft(client, plan);
  assert.equal(result.documentId, 'art-1');
  assert.deepEqual(calls.map(call => call[0]), ['taxonomy', 'upload', 'asset', 'asset', 'article']);
  const article = calls.at(-1)[1];
  assert.deepEqual(article.taxonomySelection, ['tax-report']);
  const zone = article.mainContentBlocks;
  assert.deepEqual(zone.map(item => item.__component), ['main-content.page-navigation', 'main-content.rich-text', 'main-content.html-asset-ref', 'main-content.rich-text', 'main-content.html-asset-ref']);
  assert.equal(zone[0].heading, 'På den här sidan');
  assert.match(zone[2].block, /^asset-/);
  assert.deepEqual(zone[1].content.find(block => block.type === 'image').image, { id: 7, name: 'rv-min-rapport-001.png' });
});

test('exporten avbryter vid dubblett och rapporterar skapade poster vid fel', async () => {
  const plan = planArticle({ html, title: 'Min rapport', reportId: 'abcdef12-0000', format: 'PDF' });
  await assert.rejects(exportArticleDraft({ articleSlugExists: async () => true }, plan), { code: 'duplicate_slug' });
  const failing = {
    articleSlugExists: async () => false,
    findTaxonomyConcept: async () => ({ documentId: 'tax-report' }),
    uploadImage: async () => ({ id: 3 }),
    createHtmlAsset: async () => { throw new Error('boom'); },
  };
  await assert.rejects(exportArticleDraft(failing, plan), error => error.created.files[0] === 3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { inspectWordStructure, markWordTocEntries } from '../lib/word-structure.js';
import { planArticle } from '../lib/article-plan.js';

async function docxWithTocField() {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>
    <w:p><w:r><w:t>1 Overview</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>3</w:t></w:r></w:p>
    <w:p><w:r><w:t>2 Findings</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>5</w:t></w:r></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    <w:p><w:r><w:t>Ordinary section body.</w:t></w:r></w:p>
  </w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('DOCX-läsning identifierar dynamiska TOC-fält och markerar fältets HTML-rader', async () => {
  const buffer = await docxWithTocField();
  const structure = await inspectWordStructure(buffer);
  assert.equal(structure.hasTocField, true);
  assert.deepEqual(structure.tocEntries, ['1 Overview 3', '2 Findings 5']);

  const converted = await mammoth.convertToHtml({ buffer });
  const withBodyHeading = converted.value.replace('<p>Ordinary section body.</p>', '<h2>Overview</h2><p>Ordinary section body.</p>');
  const marked = markWordTocEntries(withBodyHeading, structure.tocEntries);
  assert.equal((marked.match(/class="toc-entry"/g) || []).length, 2);
  const plan = planArticle({ html: marked, title: 'Test', reportId: 'abcdef12', format: 'Word (.docx)' });
  assert.equal(plan.stats.tocLines, 2);
  assert.equal(plan.pageNavigation, true);
  assert.deepEqual(plan.parts[0].blocks.map(block => block.type), ['heading', 'paragraph']);
  assert.equal(plan.parts[0].blocks[1].children[0].text, 'Ordinary section body.');
});

test('DOCX-läsning känner igen enkelt TOC-fält och TOC-formatmallar', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:fldSimple w:instr=" TOC \\o &quot;1-2&quot; ">
      <w:p><w:r><w:t>Chapter A 2</w:t></w:r></w:p>
      <w:p><w:r><w:t>Chapter B 4</w:t></w:r></w:p>
    </w:fldSimple>
  </w:body></w:document>`);
  zip.file('word/styles.xml', `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="TOC 1"/></w:style></w:styles>`);
  const result = await inspectWordStructure(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(result.hasTocField, true);
  assert.deepEqual(result.tocEntries, ['Chapter A 2', 'Chapter B 4']);
});

const TITLE = /^(contents?|table of contents|contents overview|innehåll|innehållsförteckning|innehållsöversikt|innehållslista|inhaltsverzeichnis|sommaire|índice)$/i;
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);

const isTag = node => node.type === 'tag';
const textOf = node => node.type === 'text' ? node.data : node.name === 'br' ? '\n' : (node.children || []).map(textOf).join('');
const normalized = node => textOf(node).replace(/\s+/g, ' ').trim();
const classes = node => (node.attribs?.class || '').toLowerCase().split(/\s+/);

function isWordEntry(node, text) {
  const explicitClass = classes(node).some(value => /^(toc|table-of-contents|contents)(-|$)/.test(value));
  const hasBookmarkLink = (node.children || []).some(child => isTag(child)
    && child.name === 'a'
    && /^#_(?:toc|ref|heading)/i.test(child.attribs?.href || ''));
  return explicitClass || hasBookmarkLink;
}

function isPdfEntry(node, text) {
  if (classes(node).some(value => /^(toc|table-of-contents)(-|$)/.test(value))) return true;
  if (text.length > 300) return false;
  const hasTrailingLeader = /(?:\.{3,}|…{2,}|·{2,}|•{2,}|_{2,}|-{3,})\s*(?:\d{1,4}|[ivxlcdm]{1,8})?$/i.test(text);
  const hasNumberedTitleAndPage = /^\s*\d+(?:\.\d+)*[.)]?\s+\S.+\s+(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(text);
  return hasTrailingLeader || hasNumberedTitleAndPage;
}

function isWordPageEntry(text) {
  return text.length <= 300 && /\S\s+(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(text);
}

function findEntries(records, start, predicate, minimum) {
  const selected = [];
  for (let index = start; index < records.length; index += 1) {
    const record = records[index];
    if (!record.text) continue;
    if (!predicate(record.node, record.text)) break;
    selected.push(record.node);
  }
  return selected.length >= minimum ? selected : [];
}

function findWordEntries(records) {
  for (let index = 0; index < records.length; index += 1) {
    const selected = findEntries(records, index, isWordEntry, 2);
    if (selected.length) return selected;
  }
  return [];
}

function findPdfEntries(records) {
  for (let index = 0; index < records.length; index += 1) {
    const selected = findEntries(records, index, (node, text) => isPdfEntry(node, text), 3);
    if (selected.length) return selected;
  }
  return [];
}

function collectBlocks(node, records) {
  if (isTag(node) && BLOCKS.has(node.name)) {
    records.push({ node, text: normalized(node) });
    return;
  }
  for (const child of node.children || []) collectBlocks(child, records);
}

function findLabeledToc(records, format) {
  for (let index = 0; index < records.length; index += 1) {
    if (!TITLE.test(records[index].text)) continue;
    if (format === 'PDF') {
      const selected = findEntries(records, index + 1, (node, text) => isPdfEntry(node, text)
        || /(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(text) && text.length < 300, 1);
      const strongEntries = selected.filter(node => isPdfEntry(node, normalized(node))).length;
      if (strongEntries >= 2 || selected.length >= 3) return [records[index].node, ...selected];
    } else {
      const explicitEntries = findEntries(records, index + 1, isWordEntry, 2);
      if (explicitEntries.length) return [records[index].node, ...explicitEntries];
      const pageNumberedEntries = findEntries(records, index + 1, (node, text) => isWordPageEntry(text), 3);
      if (pageNumberedEntries.length) return [records[index].node, ...pageNumberedEntries];
    }
  }
  return [];
}

export function identifyTableOfContents(root, format) {
  const records = [];
  collectBlocks(root, records);
  const normalizedFormat = String(format || '').toLowerCase();
  const isWord = normalizedFormat.includes('word') || normalizedFormat.includes('docx');
  const labeled = findLabeledToc(records, isWord ? 'Word' : 'PDF');
  const selected = labeled.length ? labeled : (isWord ? findWordEntries(records) : findPdfEntries(records));
  const nodes = [...new Set(selected)];
  return { nodes: new Set(nodes), lineCount: nodes.filter(node => !TITLE.test(normalized(node))).length };
}

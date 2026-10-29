import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { DomUtils, parseDocument } from 'htmlparser2';

function localName(node) {
  return node.localName || node.nodeName.split(':').at(-1);
}

function attribute(node, name) {
  for (let index = 0; index < (node.attributes?.length || 0); index += 1) {
    const item = node.attributes.item(index);
    if (localName(item) === name) return item.value;
  }
  return '';
}

function descendants(node, name, result = []) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && localName(child) === name) result.push(child);
    descendants(child, name, result);
  }
  return result;
}

function paragraphText(node) {
  const text = current => {
    if (current.nodeType === 3) return current.nodeValue;
    const name = localName(current);
    if (name === 'tab') return '\t';
    if (name === 'br' || name === 'cr') return '\n';
    if (['instrText', 'fldChar', 'drawing', 'pict', 'object'].includes(name)) return '';
    let value = '';
    for (let child = current.firstChild; child; child = child.nextSibling) value += text(child);
    return value;
  };
  return text(node).replace(/\s+/g, ' ').trim();
}

function hasTocStyle(paragraph, styles) {
  const properties = descendants(paragraph, 'pStyle')[0];
  if (!properties) return false;
  const id = attribute(properties, 'val');
  return styles.get(id) === true || /^(?:toc(?:\s|$|\d)|table of contents(?:\s|$|\d)|innehållsförteckning(?:\s|$|\d))/i.test(id);
}

function containsTocInstruction(node) {
  const instruction = localName(node) === 'fldSimple' ? attribute(node, 'instr') : '';
  if (/^\s*TOC(?:\s|$)/i.test(instruction)) return true;
  return descendants(node, 'instrText').some(item => /^\s*TOC(?:\s|$)/i.test(item.textContent || ''));
}

function hasTocBookmark(paragraph) {
  return descendants(paragraph, 'hyperlink').some(link => /^_Toc/i.test(attribute(link, 'anchor')));
}

function updateFields(node, fields) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const name = localName(child);
    if (name === 'fldChar') {
      const type = attribute(child, 'fldCharType');
      if (type === 'begin') fields.push(false);
      else if (type === 'end') fields.pop();
    } else if (name === 'instrText' && /^\s*TOC(?:\s|$)/i.test(child.textContent || '')) {
      if (fields.length) fields[fields.length - 1] = true;
    }
    updateFields(child, fields);
  }
}

function hasTocFieldAncestor(node, body) {
  for (let parent = node.parentNode; parent && parent !== body; parent = parent.parentNode) {
    if (localName(parent) === 'fldSimple' && /^\s*TOC(?:\s|$)/i.test(attribute(parent, 'instr'))) return true;
  }
  return false;
}

export async function inspectWordStructure(input) {
  const zip = await JSZip.loadAsync(input);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Word-filen saknar word/document.xml och kan inte läsas.');
  const documentXml = await documentFile.async('string');
  const stylesFile = zip.file('word/styles.xml');
  const stylesXml = stylesFile ? await stylesFile.async('string') : '<styles/>';
  const parser = new DOMParser({
    onError(level, message) {
      if (level !== 'warning') throw new Error(`Word-filens XML är ogiltig: ${message}`);
    },
  });
  const document = parser.parseFromString(documentXml, 'application/xml');
  const styles = parser.parseFromString(stylesXml, 'application/xml');
  const body = descendants(document, 'body')[0];
  if (!body) throw new Error('Word-filen saknar dokumentets body-element.');
  const tocStyleIds = new Map(descendants(styles, 'style').map(style => {
    const id = attribute(style, 'styleId');
    const name = descendants(style, 'name')[0];
    const value = name ? attribute(name, 'val') : '';
    return [id, /^(?:toc(?:\s|$|\d)|table of contents(?:\s|$|\d)|innehållsförteckning(?:\s|$|\d))/i.test(value)];
  }));
  const fields = [];
  const tocEntries = [];
  const paragraphs = descendants(body, 'p');
  let hasTocField = false;
  for (const paragraph of paragraphs) {
    const simpleField = hasTocFieldAncestor(paragraph, body);
    const isInField = fields.some(Boolean) || simpleField;
    const tocInstruction = containsTocInstruction(paragraph);
    const isEntry = isInField || tocInstruction || hasTocStyle(paragraph, tocStyleIds) || hasTocBookmark(paragraph);
    if (isEntry) {
      const text = paragraphText(paragraph);
      if (text) tocEntries.push(text);
    }
    if (tocInstruction || simpleField) hasTocField = true;
    updateFields(paragraph, fields);
    if (fields.some(Boolean)) hasTocField = true;
  }
  return { tocEntries, hasTocField };
}

function normalizedText(node) {
  const text = current => {
    if (current.type === 'text') return current.data;
    if (current.name === 'br') return '\n';
    return (current.children || []).map(text).join('');
  };
  return text(node).replace(/\s+/g, ' ').trim();
}

export function markWordTocEntries(html, entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = String(entry).replace(/\s+/g, ' ').trim();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return html;
  const root = parseDocument(html, { withStartIndices: true, withEndIndices: true });
  const changes = [];
  for (const paragraph of DomUtils.findAll(node => node.type === 'tag' && node.name === 'p', root)) {
    const key = normalizedText(paragraph);
    const remaining = counts.get(key) || 0;
    if (!remaining) continue;
    counts.set(key, remaining - 1);
    const start = paragraph.startIndex;
    const end = html.indexOf('>', start);
    if (start < 0 || end < 0) continue;
    const opening = html.slice(start, end + 1);
    if (/\bclass\s*=\s*["'][^"']*\btoc-entry\b/i.test(opening)) continue;
    const updated = /\bclass\s*=\s*(["'])(.*?)\1/i.test(opening)
      ? opening.replace(/\bclass\s*=\s*(["'])(.*?)\1/i, (_match, quote, value) => `class=${quote}${value} toc-entry${quote}`)
      : opening.replace(/>$/, ' class="toc-entry">');
    changes.push({ start, end: end + 1, value: updated });
  }
  let result = html;
  for (const change of changes.reverse()) {
    result = result.slice(0, change.start) + change.value + result.slice(change.end);
  }
  return result;
}

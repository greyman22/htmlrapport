import { createHash } from 'node:crypto';
import { parseDocument } from 'htmlparser2';
import { escapeHtml, safeUrl } from './html.js';
import { identifyTableOfContents } from './toc-analysis.js';

const STOP = Symbol('stop');
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const NOTE_REF = /^#?((?:not|footnote|endnote)-[\w-]+)$/i;
const ARTICLE_SLUG_MAX_LENGTH = 20;
const ARTICLE_ID_LENGTH = 8;
// Blocks cannot hold anchors, so notes live in an HTML block. The site keeps <a name> but strips id.
const noteAnchor = id => id.replace(/^(?:not|footnote|endnote)-/i, 'fotnot-');

export function slugify(text, max = 60) {
  return String(text)
    .normalize('NFKD')
    .replace(/å|ä/gi, 'a').replace(/ö/gi, 'o')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

export function articleSlug(title, reportId) {
  const suffix = String(reportId).slice(0, ARTICLE_ID_LENGTH);
  const titleLimit = Math.max(1, ARTICLE_SLUG_MAX_LENGTH - suffix.length - 1);
  return `${slugify(title, titleLimit) || 'r'}-${suffix}`.slice(0, ARTICLE_SLUG_MAX_LENGTH);
}

const isTag = node => node.type === 'tag';
const classes = node => (node.attribs?.class || '').split(/\s+/);
const textOf = node => (node.type === 'text' ? node.data : node.name === 'br' ? '\n' : (node.children || []).map(textOf).join(''));

function mergeInline(nodes) {
  const merged = [];
  for (const node of nodes) {
    const last = merged.at(-1);
    const sameMarks = last && last.type === 'text' && node.type === 'text'
      && ['bold', 'italic', 'underline', 'code'].every(key => Boolean(last[key]) === Boolean(node[key]));
    if (sameMarks) last.text += node.text;
    else merged.push(node);
  }
  return merged;
}

function trimInline(nodes) {
  const result = mergeInline(nodes);
  const first = result[0];
  if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '');
  const last = result.at(-1);
  if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
  return result.filter(node => node.type !== 'text' || node.text !== '');
}

const hasText = nodes => nodes.some(node => node.type === 'link' ? hasText(node.children) : node.text.trim() !== '');
const plain = nodes => nodes.map(node => node.type === 'link' ? plain(node.children) : node.text).join('');

// source: the raw content.html. Returns a Strapi-neutral plan; nothing is sent anywhere.
export function planArticle({ html, title, reportId, format, testMode = false, articlePath = '/article' }) {
  const source = String(html);
  const cleanTitle = String(title || 'Rapport').trim();
  const slug = articleSlug(cleanTitle, reportId);
  // Strapi only accepts absolute or root-relative link URLs, so in-text anchors must carry the page path.
  const noteHref = id => `${articlePath}/${slug}#${noteAnchor(id)}`;
  const root = parseDocument(source, { withStartIndices: true, withEndIndices: true });
  const toc = identifyTableOfContents(root, format || (source.includes('class="source-page"') ? 'PDF' : 'Word'));
  const parts = [];
  const images = [];
  const imageByHash = new Map();
  const footnotesById = new Map();
  const footnoteNodes = new Set();
  const footnoteLists = new Set();
  const refs = new Set();
  const stats = { paragraphs: 0, headings: 0, images: 0, tables: 0, lists: 0, footnotes: 0, skippedPageImages: 0, tocLines: 0 };
  const prefix = `rv-${slugify(title, 24) || 'rapport'}`;
  let introduction = '';

  const squash = node => textOf(node).replace(/\s+/g, ' ').trim();
  stats.tocLines = toc.lineCount;

  const rich = () => {
    if (parts.at(-1)?.kind !== 'rich') parts.push({ kind: 'rich', blocks: [] });
    return parts.at(-1).blocks;
  };
  const added = () => {
    if (testMode && stats.paragraphs && stats.images && stats.tables) throw STOP;
  };

  function inlineChildren(nodes, marks = {}) {
    return nodes.flatMap(child => inline(child, marks));
  }

  function needsFootnoteSpace(node) {
    const target = node.parent?.type === 'tag' && node.parent.name === 'sup' ? node.parent : node;
    const siblings = target.parent?.children || [];
    const previous = siblings[siblings.indexOf(target) - 1];
    const text = previous ? textOf(previous) : '';
    return text.length > 0 && !/\s$/u.test(text);
  }

  function inline(node, marks = {}) {
    if (node.type === 'text') {
      const text = node.data.replace(/\s+/g, ' ');
      return text ? [{ type: 'text', text, ...marks }] : [];
    }
    if (!isTag(node)) return [];
    if (node.name === 'br') return [{ type: 'text', text: '\n', ...marks }];
    if (node.name === 'a' && classes(node).includes('footnote-back')) return [];
    const noteId = node.name === 'a' ? NOTE_REF.exec(node.attribs.href || '')?.[1] : null;
    const isWordNoteReference = node.name === 'a' && /^(?:footnote|endnote)-ref-/i.test(node.attribs.id || '');
    if (node.name === 'a' && (node.attribs.role === 'doc-noteref' || isWordNoteReference || noteId)) {
      const labelText = textOf(node).trim().replace(/^\[|\]$/g, '');
      const label = { type: 'text', text: `[${labelText}]`, ...marks };
      if (!noteId) return [label];
      refs.add(noteId);
      const link = { type: 'link', url: noteHref(noteId), children: [label] };
      return [...(needsFootnoteSpace(node) ? [{ type: 'text', text: ' ' }] : []), link];
    }
    const next = { ...marks };
    if (node.name === 'strong' || node.name === 'b') next.bold = true;
    if (node.name === 'em' || node.name === 'i') next.italic = true;
    if (node.name === 'u') next.underline = true;
    if (node.name === 'code') next.code = true;
    const children = inlineChildren(node.children, next);
    if (node.name === 'a') {
      const url = safeUrl(node.attribs.href || '');
      if (url && !url.startsWith('#') && hasText(children)) return [{ type: 'link', url, children }];
    }
    return children;
  }

  const inlineOf = node => trimInline(inlineChildren(node.children));

  function addImage(img, caption) {
    const match = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(img.attribs.src || '');
    const alt = (img.attribs.alt || '').trim();
    if (!match || !IMAGE_TYPES[match[1]]) return;
    // Older saved PDF exports used alt text instead of the source-page-image marker.
    if (/^Originalsida\b/i.test(alt)) {
      stats.skippedPageImages += 1;
      return;
    }
    const buffer = Buffer.from(match[2], 'base64');
    const hash = createHash('sha256').update(buffer).digest('hex');
    let image = imageByHash.get(hash);
    if (!image) {
      const number = String(images.length + 1).padStart(3, '0');
      image = { key: `img-${images.length + 1}`, name: `${prefix}-${number}.${IMAGE_TYPES[match[1]]}`, mime: match[1], buffer, alt, caption: caption || '' };
      imageByHash.set(hash, image);
      images.push(image);
    }
    rich().push({ type: 'image', imageKey: image.key });
    stats.images += 1;
    added();
  }

  function list(node) {
    const items = [];
    for (const li of node.children.filter(child => isTag(child) && child.name === 'li')) {
      const content = trimInline(li.children.filter(child => !(isTag(child) && /^[uo]l$/.test(child.name))).flatMap(child => inline(child)));
      if (hasText(content)) items.push({ type: 'list-item', children: content });
      for (const nested of li.children.filter(child => isTag(child) && /^[uo]l$/.test(child.name))) items.push(list(nested));
    }
    return { type: 'list', format: node.name === 'ol' ? 'ordered' : 'unordered', children: items };
  }

  function visit(node) {
    if (node.type === 'text') {
      if (node.data.trim()) {
        const children = trimInline(inline(node));
        rich().push({ type: 'paragraph', children });
        stats.paragraphs += 1;
        added();
      }
      return;
    }
    if (!isTag(node)) return;
    const name = node.name;
    if (classes(node).includes('page-label') || (name === 'details' && classes(node).includes('original'))) return;
    if (name === 'aside' && classes(node).includes('footnotes')) return;
    if (footnoteNodes.has(node) || footnoteLists.has(node)) return;
    if (toc.nodes.has(node)) return;
    if (/^h[1-6]$/.test(name)) {
      const children = inlineOf(node);
      if (hasText(children)) {
        rich().push({ type: 'heading', level: Number(name[1]), children });
        stats.headings += 1;
        added();
      }
    } else if (name === 'p') {
      let inlineNodes = [];
      const flushParagraph = () => {
        const children = trimInline(inlineNodes);
        inlineNodes = [];
        if (!hasText(children)) return;
        rich().push({ type: 'paragraph', children });
        stats.paragraphs += 1;
        if (!introduction && plain(children).length >= 120) introduction = plain(children);
        added();
      };
      for (const child of node.children) {
        if (isTag(child) && ['figure', 'img'].includes(child.name)) {
          flushParagraph();
          visit(child);
        } else {
          inlineNodes.push(...inline(child));
        }
      }
      flushParagraph();
    } else if (name === 'ul' || name === 'ol') {
      const block = list(node);
      if (block.children.length) {
        rich().push(block);
        stats.lists += 1;
        added();
      }
    } else if (name === 'blockquote') {
      const children = inlineOf(node);
      if (hasText(children)) {
        rich().push({ type: 'quote', children });
        added();
      }
    } else if (name === 'pre') {
      rich().push({ type: 'code', children: [{ type: 'text', text: textOf(node) }] });
      added();
    } else if (name === 'figure' || name === 'img') {
      if (name === 'figure' && classes(node).includes('source-page-image')) {
        stats.skippedPageImages += 1;
        return;
      }
      const img = name === 'img' ? node : node.children.find(child => isTag(child) && child.name === 'img');
      const caption = name === 'figure' ? node.children.find(child => isTag(child) && child.name === 'figcaption') : null;
      if (img) addImage(img, caption ? textOf(caption).trim() : '');
    } else if (name === 'table') {
      const raw = source.slice(node.startIndex, node.endIndex + 1);
      const markup = raw.replace(/<sup>\s*(<a\b[^>]*>)([\s\S]*?)<\/a>\s*<\/sup>/gi, (whole, open, labelHtml, offset) => {
        const href = /href="([^"]*)"/i.exec(open)?.[1] || '';
        const id = NOTE_REF.exec(href)?.[1];
        const refId = /id="((?:footnote|endnote)-ref-[^"]+)"/i.exec(open)?.[1];
        if (!id || (!/role="doc-noteref"/i.test(open) && !refId)) return whole;
        const number = labelHtml.replace(/<[^>]*>/g, '').trim().replace(/^\[|\]$/g, '');
        refs.add(id);
        const preceding = raw.slice(0, offset).replace(/<[^>]*>/g, '');
        const spacing = preceding.length > 0 && !/\s$/u.test(preceding) ? ' ' : '';
        return `${spacing}<a href="#${noteAnchor(id)}">[${escapeHtml(number)}]</a>`;
      });
      parts.push({ kind: 'table', html: markup });
      stats.tables += 1;
      added();
    } else {
      node.children.forEach(visit);
    }
  }

  // Footnote texts are read from the whole document so test mode can still resolve them.
  function collectFootnotes(node, parent = null) {
    if (!isTag(node)) return;
    if (node.name === 'aside' && classes(node).includes('footnotes')) {
      for (const note of node.children.filter(child => isTag(child) && child.name === 'div')) {
        const text = note.children.filter(child => !(isTag(child) && classes(child).includes('footnote-back'))).map(textOf).join('').replace(/\s+/g, ' ').trim();
        const parsed = /^(\d+)\s+(.*)$/.exec(text);
        if (note.attribs.id) footnotesById.set(note.attribs.id, parsed ? { id: note.attribs.id, number: Number(parsed[1]), text: parsed[2] } : { id: note.attribs.id, number: Number.MAX_SAFE_INTEGER, text });
        footnoteNodes.add(note);
      }
      return;
    }
    if (node.name === 'li' && /^(?:footnote|endnote)-\w[\w-]*$/i.test(node.attribs.id || '')) {
      const withoutBacklinks = child => {
        if (child.type === 'text') return child.data;
        if (isTag(child) && child.name === 'a'
          && (/^(?:footnote|endnote)-ref-/i.test(child.attribs.id || '') || /^[\s↩↑]+$/.test(textOf(child)))) return '';
        return (child.children || []).map(withoutBacklinks).join('');
      };
      const text = node.children.map(withoutBacklinks).join('').replace(/\s+/g, ' ').trim();
      const id = node.attribs.id;
      const numberFromId = /-(\d+)$/.exec(id)?.[1];
      const parsed = /^(\d+)\s+(.*)$/.exec(text);
      footnotesById.set(id, {
        id,
        number: Number(parsed?.[1] || numberFromId || Number.MAX_SAFE_INTEGER),
        text: parsed ? parsed[2] : text,
      });
      footnoteNodes.add(node);
      if (parent && ['ol', 'ul'].includes(parent.name)) footnoteLists.add(parent);
      return;
    }
    node.children.forEach(child => collectFootnotes(child, node));
  }

  let truncated = false;
  try {
    root.children.forEach(collectFootnotes);
    root.children.forEach(visit);
  } catch (error) {
    if (error !== STOP) throw error;
    truncated = true;
  }

  const notes = [...refs].map(id => footnotesById.get(id)).filter(Boolean).sort((a, b) => a.number - b.number);
  if (notes.length) {
    rich().push({ type: 'heading', level: 2, children: [{ type: 'text', text: 'Fotnoter' }] });
    const items = notes.map(note => `<p><a name="${noteAnchor(note.id)}"></a>${note.number === Number.MAX_SAFE_INTEGER ? '' : `[${note.number}] `}${escapeHtml(note.text)}</p>`);
    parts.push({ kind: 'footnotes', html: `<div class="footnotes">${items.join('')}</div>` });
    stats.footnotes = notes.length;
  }

  const pageNavigation = stats.tocLines > 0;
  const warnings = [];
  if (truncated) warnings.push('Testläge: bara den första delen av rapporten är med (till och med första text, bild och tabell).');
  warnings.push(pageNavigation
    ? `Innehållsförteckningen (${stats.tocLines} rader) identifierades och utelämnades. Sidnavigering ligger som första block.`
    : 'Ingen innehållsförteckning identifierades, så ingen sidnavigering lades till.');
  if (stats.skippedPageImages) warnings.push(`${stats.skippedPageImages} sidbilder av originalsidor utelämnades. Sidor utan maskinläsbar text kan därför saknas.`);
  if (refs.size > notes.length) warnings.push(`${refs.size - notes.length} fotnotsreferenser saknar fotnotstext.`);
  warnings.push('Fotnotsreferenser är länkar till en fotnotslista sist i artikeln (HTML-block). Ingressen är automatiskt vald och bör granskas.');

  return {
    heading: cleanTitle,
    slug,
    introduction: introduction.length > 300 ? `${introduction.slice(0, 297).replace(/\s+\S*$/, '')}…` : introduction,
    parts,
    images,
    stats,
    pageNavigation,
    truncated,
    warnings,
    imagePrefix: prefix,
  };
}

export function summarizePlan(plan) {
  return {
    heading: plan.heading,
    slug: plan.slug,
    introduction: plan.introduction,
    truncated: plan.truncated,
    pageNavigation: plan.pageNavigation,
    imagePrefix: plan.imagePrefix,
    stats: plan.stats,
    parts: plan.parts.map(part => (part.kind === 'rich' ? { kind: 'rich', blocks: part.blocks.length } : { kind: part.kind })),
    images: plan.images.map(({ name, mime, buffer, alt }) => ({ name, mime, bytes: buffer.length, alt })),
    warnings: plan.warnings,
  };
}

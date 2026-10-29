import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { DomUtils, parseDocument } from 'htmlparser2';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { cleanHtml, escapeHtml, renderReport, safeUrl } from './html.js';
import { inspectWordStructure, markWordTocEntries } from './word-structure.js';

const pdfAssets = path.join(import.meta.dirname, '..', 'node_modules', 'pdfjs-dist');
const assetPath = name => pathToFileURL(path.join(pdfAssets, name) + path.sep).href;

// PDF.js requires URL-style trailing slashes; its default Node reader expects paths.
class PdfBinaryDataFactory {
  constructor(options) {
    this.options = options;
  }

  async fetch({ kind, filename }) {
    return new Uint8Array(await fs.readFile(new URL(filename, this.options[kind])));
  }
}

export function normalizeText(text) {
  return text.replace(/\u00ad[ \t]*(?:\r?\n[ \t]*)?/g, '').replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, '$1-$2').replace(/\s+/g, ' ').trim();
}

function textFromItems(items) {
  let result = '';
  let previous;
  for (const item of items) {
    if (previous && !/\s$/.test(result) && !/^\s/.test(item.str)) {
      const sameLine = Math.abs(previous.transform[5] - item.transform[5]) < 2;
      const gap = item.transform[4] - previous.transform[4] - previous.width;
      if (!sameLine) result += '\n';
      else if (gap > Math.abs(item.transform[0]) * .15) result += ' ';
    }
    result += item.str + (item.hasEOL ? '\n' : '');
    previous = item;
  }
  return result;
}

function collectMarkedText(items) {
  const map = new Map();
  const stack = [];
  for (const item of items) {
    if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
      stack.push(item.id);
    } else if (item.type === 'endMarkedContent') {
      stack.pop();
    } else if (typeof item.str === 'string') {
      const id = stack.findLast(value => value !== undefined && value !== null);
      if (id) {
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(item);
      }
    }
  }
  return map;
}

function walk(node, fn) {
  if (!node) return;
  fn(node);
  for (const child of node.children || []) walk(child, fn);
}

function contentText(node) {
  if (node.type === 'text') return node.data;
  return (node.children || []).map(contentText).join('');
}

function isSentenceEnd(text) {
  return /[.!?…]["'”’)\]]*$/u.test(text.trim());
}

function isPlainParagraph(node) {
  return node?.type === 'tag' && node.name === 'p' && Object.keys(node.attribs || {}).length === 0;
}

export function repairPdfParagraphFlow(html) {
  const document = parseDocument(html);
  let merged = 0;

  const mergeAdjacentParagraphs = parent => {
    const children = parent.children || [];
    for (let index = 0; index < children.length; index += 1) {
      const current = children[index];
      if (current.children) mergeAdjacentParagraphs(current);
      if (!isPlainParagraph(current) || !isPlainParagraph(children[index + 1])) continue;

      const next = children[index + 1];
      const currentText = contentText(current).replace(/\s+/g, ' ').trim();
      const nextText = contentText(next).replace(/\s+/g, ' ').trim();
      if (!currentText || !nextText) continue;

      const punctuationOnly = /^[,.;:!?…]+$/u.test(nextText);
      const beginsWithPunctuation = /^[,.;:!?…]/u.test(nextText);
      const beginsWithLowercase = /^\p{Ll}/u.test(nextText);
      if (!punctuationOnly && !beginsWithPunctuation && (isSentenceEnd(currentText) || !beginsWithLowercase)) continue;

      if (!beginsWithPunctuation) {
        const last = current.children.at(-1);
        if (last?.type === 'text') {
          if (!/\s$/.test(last.data)) last.data += ' ';
        } else {
          current.children.push({ type: 'text', data: ' ' });
        }
      }
      current.children.push(...next.children);
      children.splice(index + 1, 1);
      merged += 1;
      index -= 1;
    }
  };

  mergeAdjacentParagraphs(document);
  return { html: merged ? DomUtils.getInnerHTML(document) : html, merged };
}

export function addFootnoteSpacing(html) {
  const document = parseDocument(html);
  let changed = false;
  const insertSpacing = node => {
    if (node.type === 'tag' && node.name === 'a'
      && (node.attribs.role === 'doc-noteref' || /^(?:footnote|endnote)-ref-/i.test(node.attribs.id || ''))) {
      const target = node.parent?.type === 'tag' && node.parent.name === 'sup' ? node.parent : node;
      const siblings = target.parent?.children || [];
      const index = siblings.indexOf(target);
      const previous = siblings[index - 1];
      const text = previous?.type === 'text' ? previous.data : previous ? DomUtils.textContent(previous) : '';
      if (index >= 0 && /[\p{L}\p{N}]$/u.test(text)) {
        if (previous?.type === 'text') previous.data += ' ';
        else siblings.splice(index, 0, { type: 'text', data: ' ', parent: target.parent });
        changed = true;
      }
    }
    for (const child of node.children || []) insertSpacing(child);
  };
  insertSpacing(document);
  return changed ? DomUtils.getInnerHTML(document) : html;
}

function nodeText(node, marked) {
  if (node.type === 'content') return textFromItems(marked.get(node.id) || []);
  return (node.children || []).map(child => nodeText(child, marked)).join('');
}

function image(canvas, mime = 'image/png') {
  return canvas.toDataURL(mime);
}

function cropFigure(node, canvas, viewport) {
  if (!node.bbox || node.bbox.length !== 4) return null;
  const box = [
    ...viewport.convertToViewportPoint(node.bbox[0], node.bbox[1]),
    ...viewport.convertToViewportPoint(node.bbox[2], node.bbox[3]),
  ];
  const x = Math.max(0, Math.floor(Math.min(box[0], box[2])) - 3);
  const y = Math.max(0, Math.floor(Math.min(box[1], box[3])) - 3);
  const width = Math.min(canvas.width - x, Math.ceil(Math.abs(box[2] - box[0])) + 6);
  const height = Math.min(canvas.height - y, Math.ceil(Math.abs(box[3] - box[1])) + 6);
  if (width < 2 || height < 2) return null;
  const cropped = createCanvas(width, height);
  cropped.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return image(cropped);
}

function fallbackText(items, pageNumber, headings, stats) {
  const lines = [];
  for (const item of items.filter(i => i.str?.trim())) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - item.transform[5]) < 3) last.items.push(item);
    else lines.push({ y: item.transform[5], items: [item] });
  }
  const sizes = items.filter(i => i.str?.trim()).map(i => Math.abs(i.transform[0])).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 11;
  let html = '';
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) html += `<p>${escapeHtml(normalizeText(paragraph.join('\n')))}</p>`;
    paragraph = [];
  };
  let previousY;
  for (const line of lines) {
    const text = normalizeText(textFromItems(line.items));
    if (line.items.some(i => Math.abs(i.transform[0]) > bodySize * 1.35)) {
      flush();
      const id = `rubrik-${pageNumber}-${headings.length + 1}`;
      headings.push({ id, level: 2, text });
      stats.headings++;
      html += `<h2 id="${id}">${escapeHtml(text)}</h2>`;
    } else {
      if (previousY !== undefined && Math.abs(previousY - line.y) > bodySize * 1.8) flush();
      paragraph.push(text);
    }
    previousY = line.y;
  }
  flush();
  return html;
}

async function convertPdf(filePath, onProgress, sourceName) {
  const task = getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
    useSystemFonts: true,
    cMapUrl: assetPath('cmaps'),
    standardFontDataUrl: assetPath('standard_fonts'),
    wasmUrl: assetPath('wasm'),
    BinaryDataFactory: PdfBinaryDataFactory,
    isEvalSupported: false,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > 300) throw new Error('PDF:en är för lång. Denna prototyp stöder högst 300 sidor per dokument.');
    const metadata = await doc.getMetadata();
    const title = normalizeText(metadata.info?.Title || path.parse(sourceName).name.replace(/[_-]/g, ' '));
    const headings = [];
    const warnings = new Set();
    const stats = { pages: doc.numPages, images: 0, footnotes: 0, headings: 0, mergedParagraphs: 0 };
    let body = '';
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      onProgress({ current: pageNumber, total: doc.numPages, message: `Bearbetar sida ${pageNumber} av ${doc.numPages}` });
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: true });
      const tree = await page.getStructTree();
      const annotations = await page.getAnnotations();
      const links = new Map(annotations.map(a => [a.id, safeUrl(a.url)]));
      const viewport = page.getViewport({ scale: 1.7 });
      if (viewport.width * viewport.height > 20_000_000) throw new Error(`Sida ${pageNumber} är för stor att rendera säkert.`);
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
      const marked = collectMarkedText(content.items);
      const notes = new Map();
      const noteRefs = new Map();
      walk(tree, node => {
        if (node.role === 'Note') {
          const text = normalizeText(nodeText(node, marked));
          const number = text.match(/^\d+/)?.[0];
          if (number) notes.set(number, `not-${pageNumber}-${number}`);
        }
      });
      let figureIndex = 0;
      const inline = node => {
        if (node.type === 'content') return escapeHtml(nodeText(node, marked));
        const children = (node.children || []).map(inline).join('');
        if (node.role === 'Reference') {
          const number = normalizeText(nodeText(node, marked));
          if (notes.has(number)) {
            const refId = `notref-${pageNumber}-${number}-${(noteRefs.get(number) || []).length + 1}`;
            if (!noteRefs.has(number)) noteRefs.set(number, []);
            noteRefs.get(number).push(refId);
            return `<sup><a role="doc-noteref" id="${refId}" href="#${notes.get(number)}" aria-label="Fotnot ${number}">${children}</a></sup>`;
          }
        }
        if (node.role === 'Link') {
          const annotation = node.children?.find(c => c.type === 'annotation');
          const url = annotation && links.get(annotation.id);
          if (url) return `<a href="${escapeHtml(url)}">${children}</a>`;
        }
        return children;
      };
      const noteNodes = [];
      const renderNode = node => {
        if (node.type === 'content') return escapeHtml(nodeText(node, marked));
        const role = node.role;
        if (role === 'Note') {
          noteNodes.push(node);
          return '';
        }
        if (role === 'Figure') {
          figureIndex++;
          const src = cropFigure(node, canvas, viewport);
          if (!src) {
            warnings.add('En eller flera figurer saknar avgränsning i PDF:en. De finns kvar i originalvyn för respektive sida.');
            return `<p class="notice">${escapeHtml(node.alt || 'Figur')} (se originalvyn nedan).</p>`;
          }
          stats.images++;
          if (!node.alt?.trim()) warnings.add('Vissa PDF-bilder saknar alternativtext i källan. Kontrollera och komplettera före publicering.');
          return `<figure><img src="${src}" alt="${escapeHtml(node.alt?.trim() || `Figur ${figureIndex} på sida ${pageNumber}. Alternativtext behöver kompletteras.`)}" loading="lazy"></figure>`;
        }
        if (/^H[1-6]$/.test(role)) {
          const text = normalizeText(nodeText(node, marked));
          if (!text) return '';
          const level = Math.min(6, Number(role[1]) + 1);
          const id = `rubrik-${pageNumber}-${headings.length + 1}`;
          headings.push({ id, level, text });
          stats.headings++;
          return `<h${level} id="${id}">${escapeHtml(text)}</h${level}>`;
        }
        if (['P', 'Caption', 'TOCI'].includes(role)) {
          // Some tagged PDFs put figures, notes and even sections inside P nodes.
          let html = '';
          let buffer = '';
          const flush = () => {
            const text = normalizeText(buffer);
            const className = role === 'Caption' ? 'caption' : role === 'TOCI' ? 'toc-entry' : '';
            if (text) html += `<p${className ? ` class="${className}"` : ''}>${text}</p>`;
            buffer = '';
          };
          for (const child of node.children || []) {
            if (!child.role || ['Span', 'Reference', 'Link', 'Lbl'].includes(child.role)) {
              buffer += inline(child);
            } else {
              flush();
              html += renderNode(child);
            }
          }
          flush();
          return html;
        }
        if (['Span', 'Reference', 'Link', 'Lbl'].includes(role)) return inline(node);
        const children = (node.children || []).map(renderNode).join('');
        const tags = { L: 'ul', LI: 'li', Table: 'table', TR: 'tr', THead: 'thead', TBody: 'tbody', TFoot: 'tfoot', TH: 'th', TD: 'td', BlockQuote: 'blockquote' };
        if (tags[role]) {
          const tag = tags[role];
          return `<${tag}${role === 'TH' ? ' scope="col"' : ''}>${children}</${tag}>`;
        }
        return children;
      };
      let pageHtml;
      const taggedText = [...marked.values()].flat().some(item => item.str.trim());
      if (tree && (taggedText || !content.items.some(i => i.str?.trim()))) {
        pageHtml = renderNode(tree);
      } else {
        warnings.add('Vissa sidor saknar användbara PDF-taggar. Deras läsordning och rubriker är uppskattade och behöver kontrolleras mot originalet.');
        pageHtml = fallbackText(content.items, pageNumber, headings, stats);
      }
      const repaired = repairPdfParagraphFlow(pageHtml);
      pageHtml = repaired.html;
      stats.mergedParagraphs += repaired.merged;
      if (noteNodes.length) {
        stats.footnotes += noteNodes.length;
        pageHtml += `<aside class="footnotes" aria-label="Fotnoter på sida ${pageNumber}"><h3>Fotnoter</h3>${noteNodes.map((note, index) => {
          const number = normalizeText(nodeText(note, marked)).match(/^\d+/)?.[0];
          const id = notes.get(number) || `not-${pageNumber}-extra-${index}`;
          const backlinks = (noteRefs.get(number) || []).map((ref, i) => `<a class="footnote-back" href="#${ref}" aria-label="Tillbaka till hänvisning ${i + 1} för fotnot ${escapeHtml(number)}">↩</a>`).join('');
          return `<div class="footnote" role="doc-footnote" id="${id}">${inline(note)}${backlinks}</div>`;
        }).join('')}</aside>`;
      }
      if (!content.items.some(i => i.str?.trim())) {
        warnings.add('Sidor utan maskinläsbar text visas som originalbild. OCR ingår inte i denna version.');
      }
      const preview = createCanvas(Math.ceil(viewport.width / 1.7), Math.ceil(viewport.height / 1.7));
      preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
      const hasText = content.items.some(i => i.str?.trim());
      const original = `<img src="${image(preview, 'image/webp')}" alt="Originalsida ${pageNumber} ur ${escapeHtml(sourceName)}" width="${preview.width}" height="${preview.height}" loading="lazy">`;
      body += `<section class="source-page" aria-label="Sida ${pageNumber}"><div class="page-label">Sida ${pageNumber}</div>${pageHtml}${hasText ? `<details class="original"><summary>Visa originalsida ${pageNumber}</summary>${original}</details>`       : `<figure class="source-page-image">${original}<figcaption>Sida utan maskinläsbar text. Se bilden ovan.</figcaption></figure>`}</section>`;
      page.cleanup();
    }
    if (stats.mergedParagraphs) {
      warnings.add(`${stats.mergedParagraphs} PDF-styckegränser slogs ihop utifrån skiljetecken och meningsfortsättning. Kontrollera läsflödet mot originalet.`);
    }
    warnings.add('PDF-konvertering behöver redaktionell granskning: kontrollera läsordning, tabeller, länkar och fotnoter mot originalet.');
    return { title, body, headings, warnings: [...warnings], stats, format: 'PDF' };
  } finally {
    await task.destroy();
  }
}

async function convertWord(filePath, onProgress, sourceName) {
  onProgress({ current: 0, total: 1, message: 'Läser Word-dokument, bilder och fotnoter' });
  let imageCount = 0;
  let missingAlt = false;
  const buffer = await fs.readFile(filePath);
  const structure = await inspectWordStructure(buffer);
  const result = await mammoth.convertToHtml({ buffer }, {
    externalFileAccess: false,
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Titel'] => h1:fresh",
      "p[style-name='TOC 1'] => p.toc-entry:fresh",
      "p[style-name='TOC 2'] => p.toc-entry:fresh",
      "p[style-name='TOC 3'] => p.toc-entry:fresh",
      "p[style-name='Table of Contents 1'] => p.toc-entry:fresh",
      "p[style-name='Table of Contents 2'] => p.toc-entry:fresh",
      "p[style-name='Table of Contents 3'] => p.toc-entry:fresh",
      "p[style-name='Innehållsförteckning 1'] => p.toc-entry:fresh",
      "p[style-name='Innehållsförteckning 2'] => p.toc-entry:fresh",
      "p[style-name='Innehållsförteckning 3'] => p.toc-entry:fresh",
      "p[style-name='Rubrik 1'] => h1:fresh",
      "p[style-name='Rubrik 2'] => h2:fresh",
      "p[style-name='Rubrik 3'] => h3:fresh",
    ],
    convertImage: mammoth.images.imgElement(async image => {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(image.contentType)) {
        throw new Error(`Word-filen innehåller en bildtyp som inte stöds (${image.contentType}). Spara bilden som PNG eller JPEG i Word och försök igen.`);
      }
      imageCount++;
      if (!image.altText) missingAlt = true;
      return { src: `data:${image.contentType};base64,${await image.read('base64')}`, alt: image.altText || `Bild ${imageCount}. Alternativtext behöver kompletteras.` };
    }),
  });
  let body = cleanHtml(markWordTocEntries(result.value, structure.tocEntries));
  const headings = [];
  let title;
  body = body.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (match, level, attrs, content) => {
    const text = sanitizeText(content);
    if (!title) title = text;
    const id = `rubrik-${headings.length + 1}`;
    const outputLevel = Math.min(6, Number(level) + 1);
    headings.push({ id, level: outputLevel, text });
    return `<h${outputLevel} id="${id}">${content}</h${outputLevel}>`;
  });
  const warnings = result.messages.map(message => message.message);
  if (missingAlt) warnings.push('Vissa Word-bilder saknar alternativtext. Komplettera före publicering.');
  warnings.push('Kontrollera rubriknivåer, tabeller, alternativtexter och fotnoter före publicering.');
  const stats = { pages: null, images: imageCount, headings: headings.length, footnotes: (body.match(/\bid="(?:footnote|endnote)-(?!ref-)[^"]+"/g) || []).length };
  onProgress({ current: 1, total: 1, message: 'Word-dokumentet är konverterat' });
  return { title: title || path.parse(sourceName).name, body, headings, warnings, stats, format: 'Word (.docx)' };
}

function sanitizeText(html) {
  return normalizeText(cleanHtml(html.replace(/<br\b[^>]*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
}

export async function convertDocument(filePath, outputDir, onProgress = () => {}, sourceName = path.basename(filePath)) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.pdf', '.docx'].includes(ext)) throw new Error('Filtypen stöds inte. Välj en PDF eller en Word-fil i formatet .docx.');
  const result = ext === '.pdf' ? await convertPdf(filePath, onProgress, sourceName) : await convertWord(filePath, onProgress, sourceName);
  result.body = addFootnoteSpacing(result.body);
  result.body = result.body.replace(/<table\b/g, '<div class="table-scroll" tabindex="0" role="region" aria-label="Tabell, kan rullas i sidled"><table').replace(/<\/table>/g, '</table></div>');
  const html = renderReport({ ...result, sourceName });
  const { body, headings, ...summary } = result;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'index.html'), html);
  await fs.writeFile(path.join(outputDir, 'content.html'), `<!-- HTML-fragment för redaktionell bearbetning. Infoga i ert CMS efter granskning. -->\n${body}`);
  return { ...summary, sourceName };
}

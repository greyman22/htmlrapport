import sanitizeHtml from 'sanitize-html';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function cleanHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'figure', 'figcaption', 'sup', 'sub'],
    allowedAttributes: {
      '*': ['id', 'class', 'lang'],
      a: ['href', 'title', 'aria-label', 'role'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      th: ['scope', 'colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      ol: ['start'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
  });
}

export const reportCss = `
:root{--green:#073c2b;--accent:#287c23;--ink:#21272a;--muted:#535c58;--line:#dce2dc;--paper:#f5f6f1}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:2rem}
body{margin:0;color:var(--ink);background:#fff;font:18px/1.7 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}
a{color:#246b22;text-underline-offset:.18em}a:hover{color:#073c2b}
a:focus-visible,summary:focus-visible{outline:3px solid #9c4396;outline-offset:5px}
.skip{position:absolute;top:-100px;left:1rem;background:white;padding:1rem}.skip:focus{top:1rem}
.report-header{border-bottom:1px solid var(--line);padding:1.1rem max(5vw,1.5rem);display:flex;justify-content:space-between;gap:1rem;font-size:.85rem}
.report-brand{font-weight:800;letter-spacing:.12em;color:var(--accent)}
.hero{background:var(--green);color:white;padding:4rem max(5vw,1.5rem)}
.hero-inner{max-width:1100px;margin:auto}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:.75rem;font-weight:700}
h1{font-size:clamp(2rem,4.5vw,3.7rem);line-height:1.14;max-width:1000px;letter-spacing:-.035em;margin:1rem 0 1.5rem}
.hero p{color:#e0eadd;font-size:1rem;margin:0}.layout{max-width:1220px;margin:auto;padding:3rem 2rem;display:grid;grid-template-columns:240px minmax(0,800px);gap:4rem}
.contents{font-size:.85rem;position:sticky;top:2rem;max-height:85vh;overflow:auto;align-self:start;min-width:0}
.contents h2{font-size:1rem;margin:0 0 1rem}.contents ol{list-style:none;padding:0;margin:0}.contents li{margin:0;border-bottom:1px solid var(--line)}
.contents a{display:block;padding:.6rem 0;text-decoration:none;color:var(--green)}.contents .sub{padding-left:1rem}
main{min-width:0}h2,h3,h4,h5,h6{color:var(--green);line-height:1.25;letter-spacing:-.02em;margin:2rem 0 1rem}
h2{font-size:2rem}h3{font-size:1.5rem}h4{font-size:1.2rem}p{margin:0 0 1.25rem}
.source-page{margin-bottom:2.5rem;display:flow-root}.page-label{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--line);padding-top:1rem;margin-bottom:1.5rem}
figure{margin:2rem 0}img{max-width:100%;height:auto}figure img{display:block;margin:auto}figcaption{font-size:.85rem;color:var(--muted);margin-top:.8rem}
.table-scroll{overflow-x:auto;max-width:100%;margin:1.5rem 0}.table-scroll:focus-visible{outline:3px solid #9c4396;outline-offset:3px}table{border-collapse:collapse;width:100%;font-size:.9rem;margin:0}td,th{padding:.65rem;border:1px solid #bac8bc;text-align:left;vertical-align:top}th{background:#edf3e9}
blockquote{border-left:4px solid #7daf37;margin:2rem 0;padding:.5rem 1.5rem;background:var(--paper)}
.footnotes{font-size:.8rem;border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem}.footnotes h3{font-size:1rem;margin-top:0}
.footnote{margin-bottom:.75rem}.footnote p{display:inline}.footnote-back{margin-left:.4rem}sup{line-height:0}
.original{background:var(--paper);border:1px solid var(--line);margin:1.5rem 0;font-size:.8rem}.original summary{cursor:pointer;padding:.75rem 1rem;color:var(--green)}
.original img{display:block;margin:auto}.notice{background:#f4f0db;border-left:4px solid #b69729;padding:1rem;font-size:.9rem;margin-bottom:2rem}
footer{border-top:1px solid var(--line);background:var(--paper);padding:2rem max(5vw,1.5rem);font-size:.8rem;color:var(--muted)}
@media(max-width:850px){.layout{grid-template-columns:1fr;gap:2rem;padding:2rem 1.25rem}.contents{position:static;max-height:18rem}.hero{padding:2.5rem 1.25rem}.report-header{flex-wrap:wrap}h2{font-size:1.7rem}}
@media print{.contents,.original,.skip,.report-header{display:none}.layout{display:block;padding:0}.hero{background:white;color:#073c2b;padding:0 0 2rem}.hero p{color:#333}body{font-size:11pt}.source-page{break-inside:auto}figure,table{break-inside:avoid}footer{background:white}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

const presentationCss = `
html{scroll-padding-top:8rem}.skip:focus{z-index:20}
.view-switcher{position:sticky;top:0;z-index:10;background:#f3f4f1;border-bottom:1px solid #ccd4ca;padding:.65rem 1.5rem;display:flex;align-items:center;justify-content:center;gap:1rem;flex-wrap:wrap;font:13px/1.4 Arial,Helvetica,sans-serif;color:#21272a}
.view-switcher fieldset{border:0;padding:0;margin:0;display:flex;gap:.4rem;align-items:center}.view-switcher legend{float:left;margin-right:.8rem;font-weight:700}
.view-option{position:relative}.view-option input{position:absolute;opacity:0;width:1px;height:1px}
.view-option label{display:block;cursor:pointer;border:1px solid #9baa97;border-radius:3px;padding:.5rem .9rem;background:white}
.view-option input:checked+label{background:#073c2b;border-color:#073c2b;color:white}
.view-option input:focus-visible+label{outline:3px solid #9c4396;outline-offset:3px}.simulation-label{font-size:11px;color:#535c58}
.standard-header,.standard-breadcrumb,.standard-contents,.standard-footer{display:none}
body:has(#view-vinnova:checked){color:#121619;line-height:1.5}
body:has(#view-vinnova:checked) .report-header,body:has(#view-vinnova:checked) .report-footer,body:has(#view-vinnova:checked) .layout>.contents{display:none}
body:has(#view-vinnova:checked) .standard-header{display:block;border-bottom:1px solid #d6d6d6;box-shadow:0 3px 6px #00000014;background:white}
.standard-header-inner{max-width:1280px;margin:auto;padding:1.5rem 2rem;display:flex;align-items:center;justify-content:space-between;gap:1.5rem}
.standard-wordmark{font-size:29px;font-weight:700;letter-spacing:.1em;color:#287c23;text-decoration:none;line-height:1}
.standard-tools{display:flex;align-items:center;gap:2rem;font-size:16px}.standard-tools>a{text-decoration:none;color:#121619}
.standard-tools summary{list-style:none;cursor:pointer;font-size:18px;font-weight:700}.standard-tools summary::-webkit-details-marker{display:none}
.standard-tools summary:before{content:"☰";font-size:24px;vertical-align:middle;margin-right:.5rem}
.standard-menu{position:relative}.standard-menu nav{position:absolute;right:0;top:2.5rem;width:min(330px,80vw);padding:1rem 1.5rem;background:white;border:1px solid #ddd;box-shadow:0 5px 15px #0002;z-index:5}
.standard-menu nav a{display:block;color:#121619;padding:.65rem 0;border-bottom:1px solid #eee;text-decoration:none;font-size:16px;font-weight:400}
body:has(#view-vinnova:checked) .standard-breadcrumb{display:block;max-width:1280px;margin:auto;padding:1.25rem 2rem;font-size:14px;color:#4d5358}
.standard-breadcrumb ol{display:flex;flex-wrap:wrap;gap:.6rem;list-style:none;margin:0;padding:0}.standard-breadcrumb li+li:before{content:"/";margin-right:.6rem;color:#757575}
.standard-breadcrumb a{color:#4d5358}
body:has(#view-vinnova:checked) .hero{background:white;color:#121619;padding:2.75rem 2rem 2rem}
body:has(#view-vinnova:checked) .hero-inner{max-width:780px}
body:has(#view-vinnova:checked) .hero .eyebrow{display:none}
body:has(#view-vinnova:checked) h1{font-family:"Arial Narrow",Arial,Helvetica,sans-serif;font-size:50px;line-height:1.25;letter-spacing:-.025em;margin:0 0 1.5rem;max-width:none}
body:has(#view-vinnova:checked) .hero p{color:#4d5358;font-size:16px;line-height:1.5}
body:has(#view-vinnova:checked) .layout{display:block;max-width:844px;padding:0 2rem 4rem}
body:has(#view-vinnova:checked) main h2,body:has(#view-vinnova:checked) main h3,body:has(#view-vinnova:checked) main h4,body:has(#view-vinnova:checked) main h5,body:has(#view-vinnova:checked) main h6{color:#121619}
body:has(#view-vinnova:checked) main h2{font-size:38px;line-height:1.25}
body:has(#view-vinnova:checked) main h3{font-size:28px;line-height:1.3}
body:has(#view-vinnova:checked) .footnotes h3{font-size:18px}
body:has(#view-vinnova:checked) main a{color:#114599}
body:has(#view-vinnova:checked) .standard-contents{display:block;border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin:0 0 2rem;padding:1rem 0}
.standard-contents summary{font-size:18px;font-weight:700;cursor:pointer}
.standard-contents ol{list-style:none;padding:0;margin:1rem 0 0;columns:2;column-gap:2rem;font-size:16px}
.standard-contents li{break-inside:avoid;margin-bottom:.6rem}.standard-contents .sub{padding-left:1rem}
body:has(#view-vinnova:checked) .standard-footer{display:block;background:#f2f4f5;color:#121619;padding:3.5rem 2rem}
.standard-footer-inner{max-width:1200px;margin:auto}.standard-footer-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3rem}
.standard-footer h2{font-size:22px;margin:0 0 1.5rem;color:#121619}.standard-footer p,.standard-footer a{font-size:16px;line-height:1.7;color:#121619}
.standard-footer ul{list-style:none;margin:0;padding:0}.standard-footer li{margin-bottom:.7rem}
.standard-disclaimer{border-top:1px solid #c8cdd0;margin-top:2rem;padding-top:1.5rem}
.standard-footer .standard-disclaimer p{font-size:13px;margin-bottom:0;color:#4d5358}
@media(max-width:850px){.standard-header-inner{padding:1.25rem}.standard-tools{gap:1rem}.standard-wordmark{font-size:23px}
body:has(#view-vinnova:checked) .standard-breadcrumb{padding:1rem 1.25rem}
body:has(#view-vinnova:checked) .hero{padding:2rem 1.25rem 1.5rem}
body:has(#view-vinnova:checked) h1{font-size:36px}
body:has(#view-vinnova:checked) .layout{padding:0 1.25rem 3rem}
body:has(#view-vinnova:checked) main h2{font-size:30px}
.standard-footer-grid{grid-template-columns:1fr;gap:2rem}.standard-contents ol{columns:1}}
@media(max-width:520px){.view-switcher{padding:.6rem .75rem;gap:.4rem}.view-switcher fieldset{flex-wrap:wrap;justify-content:center}.view-switcher legend{font-size:12px}.view-option label{padding:.5rem .6rem}
.simulation-label{width:100%;text-align:center}.standard-tools>a{display:none}.standard-tools{gap:.5rem}.standard-wordmark{font-size:21px}}
@media print{.view-switcher,.standard-header,.standard-breadcrumb,.standard-contents,.standard-footer{display:none!important}
body:has(#view-vinnova:checked) .hero{padding:0 0 2rem}body:has(#view-vinnova:checked) .layout{padding:0;max-width:none}}
`;

function renderViewSwitcher() {
  return `<div class="view-switcher"><fieldset><legend>Visningsläge</legend>
<span class="view-option"><input type="radio" name="report-view" id="view-report" value="report" checked><label for="view-report">Rapport</label></span>
<span class="view-option"><input type="radio" name="report-view" id="view-vinnova" value="vinnova"><label for="view-vinnova">Vinnova.se</label></span>
</fieldset><span class="simulation-label">Förhandsvisning · Inte en publicerad Vinnova-sida</span></div>`;
}

function renderStandardHeader() {
  return `<header class="standard-header"><div class="standard-header-inner">
<a class="standard-wordmark" href="https://www.vinnova.se/" aria-label="Vinnova, extern webbplats">VINNOVA</a>
<div class="standard-tools"><a href="https://www.vinnova.se/sok/">⌕ &nbsp;Sök</a><a href="https://www.vinnova.se/en/">◎ &nbsp;In English</a>
<details class="standard-menu"><summary>Meny</summary><nav aria-label="Vinnovas huvudmeny, exempel">
<a href="https://www.vinnova.se/">Start</a><a href="https://www.vinnova.se/sok-finansiering/">Sök finansiering</a>
<a href="https://www.vinnova.se/expertisomraden-och-amnen/">Expertisområden och ämnen</a>
<a href="https://www.vinnova.se/expertisomraden-och-amnen/halsa-och-livskvalitet/">Hälsa och livskvalitet</a>
<a href="https://www.vinnova.se/om-oss/">Om Vinnova</a></nav></details></div></div></header>
<nav class="standard-breadcrumb" aria-label="Brödsmulor, exempel"><ol>
<li><a href="https://www.vinnova.se/">Start</a></li><li><a href="https://www.vinnova.se/expertisomraden-och-amnen/">Expertisområden och ämnen</a></li>
<li><a href="https://www.vinnova.se/expertisomraden-och-amnen/halsa-och-livskvalitet/">Hälsa och livskvalitet</a></li><li aria-current="page">Rapport</li></ol></nav>`;
}

function renderStandardFooter() {
  return `<footer class="standard-footer"><div class="standard-footer-inner"><div class="standard-footer-grid">
<section><h2>Kontakta oss</h2><p><a href="mailto:vinnova@vinnova.se">vinnova@vinnova.se</a><br><a href="tel:+4684733000">08-473 30 00</a><br>Vardagar 8:00–16:30</p><p>Mäster Samuelsgatan 56<br>101 58 Stockholm</p></section>
<section><h2>Följ oss</h2><ul><li><a href="https://www.vinnova.se/">Nyheter och nyhetsbrev</a></li><li><a href="https://www.vinnova.se/">På spaning innovation</a></li><li><a href="https://www.vinnova.se/">Vinnovas kanaler</a></li></ul></section>
<section><h2>Om Vinnova</h2><ul><li><a href="https://www.vinnova.se/om-oss/">Detta är Vinnova</a></li><li><a href="https://www.vinnova.se/om-oss/">Arbeta hos oss</a></li><li><a href="https://www.vinnova.se/om-oss/">Tillgänglighet och personuppgifter</a></li></ul></section>
</div><div class="standard-disclaimer"><span class="standard-wordmark">VINNOVA</span><p>Simulerad standardsida i Rapportverkstan. Sidhuvud, meny, brödsmulor och sidfot är hårdkodade exempel; länkarna går till Vinnovas externa webbplats. Detta är inte en officiell eller publicerad Vinnova-sida. Innehåll och tillgänglighet behöver granskas före publicering.</p></div></div></footer>`;
}

export function renderReport({ title, sourceName, format, body, headings, warnings, stats }) {
  const toc = headings.map(h => `<li${h.level > 2 ? ' class="sub"' : ''}><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`).join('');
  return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Rapportverkstan"><title>${escapeHtml(title)}</title><style>${reportCss}${presentationCss}</style></head>
<body><a class="skip" href="#rapport">Hoppa till rapporten</a>
${renderViewSwitcher()}
${renderStandardHeader()}
<header class="report-header"><span class="report-brand">RAPPORTVERKSTAN</span><span>Konverterad rapport · Förhandsgranskning</span></header>
<section class="hero" aria-labelledby="report-title"><div class="hero-inner"><span class="eyebrow">Kunskap &amp; innovation / Rapport</span>
<h1 id="report-title">${escapeHtml(title)}</h1><p>${escapeHtml(format)} · ${escapeHtml(sourceName)}${stats.pages ? ` · ${stats.pages} sidor` : ''}</p></div></section>
<div class="layout"><nav class="contents" aria-label="Rapportens innehåll"><h2>På den här sidan</h2><ol>${toc || '<li><a href="#rapport">Rapportens innehåll</a></li>'}</ol></nav>
<main id="rapport"><details class="standard-contents"><summary>Innehåll på sidan</summary><nav aria-label="Rapportens innehåll i standardsidan"><ol>${toc || '<li><a href="#rapport">Rapportens innehåll</a></li>'}</ol></nav></details>${warnings.length ? `<aside class="notice" aria-label="Om konverteringen"><strong>Kontrollera före publicering.</strong><ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></aside>` : ''}${body}</main></div>
<footer class="report-footer">Skapad lokalt med Rapportverkstan. Formgivningen är inspirerad av vinnova.se; detta är inte en officiell Vinnova-sida. Innehåll och tillgänglighet behöver granskas före publicering.</footer>
${renderStandardFooter()}
</body></html>`;
}

const $ = selector => document.querySelector(selector);
let sources = [];
let busy = false;
let mode = 'existing';
let uploadedSource = null;
let latestJob = null;

function showError(error) {
  $('#error-panel').textContent = error.message || String(error);
  $('#error-panel').hidden = false;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Anropet misslyckades (${response.status}).`);
  return data;
}

function selectedSource() {
  return mode === 'upload' ? uploadedSource : sources.find(source => source.id === $('#source-select').value);
}

function updateButton() {
  $('#convert-button').disabled = busy || !selectedSource();
}

function setBusy(value) {
  busy = value;
  $('#source-select').disabled = value;
  $('#file-input').disabled = value;
  $('#existing-tab').disabled = value;
  $('#upload-tab').disabled = value;
  updateButton();
}

function displaySource() {
  const source = selectedSource();
  const info = $('#source-info');
  info.replaceChildren();
  if (source) {
    const badge = document.createElement('span');
    badge.className = 'file-type';
    badge.textContent = source.format;
    info.append(badge, document.createTextNode(`${(source.size / 1024 / 1024).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} MB · ${source.location === 'sources' ? 'Källmappen' : 'Uppladdad fil'}`));
  }
  updateButton();
}

async function loadSources(preferredId) {
  sources = await request('/api/sources');
  const selected = preferredId || $('#source-select').value;
  $('#source-select').replaceChildren();
  if (!sources.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Inga dokument ännu — ladda upp en fil';
    $('#source-select').append(option);
  }
  for (const source of sources) {
    const option = document.createElement('option');
    option.value = source.id;
    option.textContent = source.name;
    $('#source-select').append(option);
  }
  if (sources.some(source => source.id === selected)) $('#source-select').value = selected;
  displaySource();
}

function setMode(nextMode) {
  if (busy) return;
  mode = nextMode;
  $('#existing-panel').hidden = mode !== 'existing';
  $('#upload-panel').hidden = mode !== 'upload';
  for (const tab of ['existing', 'upload']) {
    $(`#${tab}-tab`).classList.toggle('active', mode === tab);
    $(`#${tab}-tab`).setAttribute('aria-pressed', String(mode === tab));
  }
  $('#error-panel').hidden = true;
  displaySource();
}

async function uploadFile(file) {
  if (busy || !file) return;
  uploadedSource = null;
  $('#error-panel').hidden = true;
  if (!/\.(pdf|docx)$/i.test(file.name)) {
    showError(new Error('Välj PDF eller .docx. Spara först om äldre .doc-filer som .docx i Word.'));
    updateButton();
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    showError(new Error('Filen är för stor. Maximal filstorlek är 30 MB.'));
    updateButton();
    return;
  }
  setBusy(true);
  $('#upload-status').textContent = `Laddar upp ${file.name}…`;
  try {
    const data = new FormData();
    data.append('file', file);
    uploadedSource = await request('/api/upload', { method: 'POST', body: data });
    $('#upload-status').textContent = `${uploadedSource.name} är uppladdad och redo att konverteras.`;
    await loadSources(uploadedSource.id);
  } catch (error) {
    $('#upload-status').textContent = 'Uppladdningen misslyckades.';
    showError(error);
  } finally {
    setBusy(false);
  }
}

function showResult(job, focus = true) {
  const result = job.result;
  $('#result-title').textContent = result.title;
  $('#result-open').href = job.url;
  $('#result-download').href = job.downloadUrl;
  $('#result-fragment').href = job.fragmentUrl;
  $('#result-stats').replaceChildren();
  const stats = [[result.stats.pages, 'sidor'], [result.stats.headings, 'rubriker'], [result.stats.images, 'bilder'], [result.stats.footnotes, 'fotnoter']];
  for (const [count, label] of stats) {
    if (count === null) continue;
    const item = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = count;
    item.append(strong, document.createTextNode(` ${label}`));
    $('#result-stats').append(item);
  }
  $('#result-warnings').replaceChildren();
  for (const warning of result.warnings) {
    const item = document.createElement('li');
    item.textContent = warning;
    $('#result-warnings').append(item);
  }
  $('#warnings-details').hidden = !result.warnings.length;
  $('#warnings-summary').textContent = `Att kontrollera före publicering (${result.warnings.length})`;
  $('#result-panel').hidden = false;
  if (focus) $('#result-panel').focus({ preventScroll: false });
}

async function loadHistory() {
  const reports = await request('/api/reports');
  const list = $('#history-list');
  list.replaceChildren();
  $('#history-count').textContent = reports.length;
  if (!reports.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Här samlas dina rapporter. Börja med att konvertera ett dokument ovan.';
    list.append(empty);
  }
  for (const report of reports) {
    const item = document.createElement('article');
    item.className = 'history-item';
    const badge = document.createElement('span');
    badge.className = 'file-type';
    badge.textContent = report.result.format.startsWith('Word') ? 'DOCX' : 'PDF';
    const details = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = report.result.title;
    const description = document.createElement('p');
    description.textContent = `${new Date(report.createdAt).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })} · ${report.sourceName}`;
    details.append(title, description);
    const link = document.createElement('a');
    link.href = report.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Öppna ↗';
    link.setAttribute('aria-label', `Öppna ${report.result.title}`);
    item.append(badge, details, link);
    list.append(item);
  }
}

async function watchJob(id) {
  let job;
  do {
    job = await request(`/api/jobs/${encodeURIComponent(id)}`);
    latestJob = job;
    $('#progress-text').textContent = job.progress.message;
    const bar = $('#progress-bar');
    if (job.progress.total) {
      bar.max = job.progress.total;
      bar.value = job.progress.current;
    } else bar.removeAttribute('value');
    if (job.status === 'processing') await new Promise(resolve => setTimeout(resolve, 900));
  } while (job.status === 'processing');
  localStorage.removeItem('rapportverkstan-job');
  if (job.status === 'failed') throw new Error(job.error);
  $('#progress-panel').hidden = true;
  showResult(job);
  await Promise.all([loadHistory(), loadStrapiReports()]);
}

async function convert() {
  const source = selectedSource();
  if (busy || !source) return;
  setBusy(true);
  $('#error-panel').hidden = true;
  $('#result-panel').hidden = true;
  $('#progress-panel').hidden = false;
  $('#progress-text').textContent = 'Förbereder konvertering…';
  $('#progress-bar').removeAttribute('value');
  try {
    latestJob = await request('/api/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: source.id }) });
    localStorage.setItem('rapportverkstan-job', latestJob.id);
    await watchJob(latestJob.id);
  } catch (error) {
    showError(error);
    $('#progress-panel').hidden = true;
  } finally {
    setBusy(false);
  }
}

$('#source-select').addEventListener('change', displaySource);
$('#existing-tab').addEventListener('click', () => setMode('existing'));
$('#upload-tab').addEventListener('click', () => setMode('upload'));
$('#file-input').addEventListener('change', event => uploadFile(event.target.files[0]));
$('#convert-button').addEventListener('click', convert);
for (const eventName of ['dragover', 'dragleave', 'drop']) {
  $('#dropzone').addEventListener(eventName, event => {
    event.preventDefault();
    $('#dropzone').classList.toggle('dragover', eventName === 'dragover' && !busy);
    if (eventName === 'drop' && !busy) uploadFile(event.dataTransfer.files[0]);
  });
}

function row(list, label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  list.append(dt, dd);
}

function showStrapiResult(data) {
  const { plan } = data;
  const box = $('#strapi-result');
  box.className = 'strapi-summary';
  box.replaceChildren();
  const list = document.createElement('dl');
  row(list, 'Rubrik', plan.heading);
  row(list, 'Slug', plan.slug);
  row(list, 'Block', `${plan.stats.paragraphs} stycken, ${plan.stats.headings} rubriker, ${plan.stats.footnotes} fotnoter`);
  row(list, 'Bilder', `${plan.images.length} (${plan.imagePrefix}-001…)`);
  row(list, 'Tabeller', `${plan.stats.tables} som HTML-block`);
  row(list, 'Sidnavigering', plan.pageNavigation ? `Ja (innehållsförteckning med ${plan.stats.tocLines} rader utelämnad)` : 'Nej, ingen innehållsförteckning hittades');
  row(list, 'Taxonomi', 'Content Types = Report');
  box.append(list);
  if (plan.warnings.length) {
    const warnings = document.createElement('ul');
    for (const warning of plan.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      warnings.append(item);
    }
    box.append(warnings);
  }
  if (data.adminUrl || data.publicUrl) {
    const links = document.createElement('div');
    links.className = 'strapi-result-links';
    for (const [url, label] of [[data.adminUrl, 'Öppna utkastet i Strapi ↗'], [data.publicUrl, 'Öppna artikeln på webbplatsen ↗']]) {
      if (!url) continue;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = label;
      links.append(link);
    }
    box.append(links);
  }
  box.hidden = false;
}

async function loadStrapiReports() {
  const reports = await request('/api/reports');
  const select = $('#strapi-report');
  select.replaceChildren();
  for (const report of reports) {
    const option = document.createElement('option');
    option.value = report.id;
    option.textContent = `${report.result.title} (${report.sourceName})`;
    select.append(option);
  }
  if (!reports.length) select.append(new Option('Inga konverterade rapporter än', ''));
  updateStrapiButtons();
}

function updateStrapiButtons(isBusy = false) {
  const disabled = isBusy || !$('#strapi-report').value;
  $('#strapi-preview').disabled = disabled;
  $('#strapi-create').disabled = disabled;
}

async function sendToStrapi(dryRun) {
  updateStrapiButtons(true);
  $('#strapi-result').hidden = true;
  $('#strapi-status').textContent = dryRun ? 'Förbereder förhandsgranskning…' : 'Skickar till Strapi. Bilder laddas upp en i taget…';
  try {
    const data = await request('/api/strapi/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: $('#strapi-report').value, testMode: $('#strapi-test').checked, dryRun }),
    });
    showStrapiResult(data);
    $('#strapi-status').textContent = dryRun ? 'Förhandsgranskning klar. Inget har skickats.' : 'Utkastet är skapat. Det är inte publicerat.';
  } catch (error) {
    $('#strapi-status').textContent = error.message;
  } finally {
    updateStrapiButtons();
  }
}

$('#strapi-report').addEventListener('change', () => updateStrapiButtons());
$('#strapi-preview').addEventListener('click', () => sendToStrapi(true));
$('#strapi-create').addEventListener('click', () => sendToStrapi(false));

async function init() {
  try {
    await Promise.all([loadSources(), loadHistory(), loadStrapiReports()]);
    const id = localStorage.getItem('rapportverkstan-job');
    if (id) {
      setBusy(true);
      $('#progress-panel').hidden = false;
      try {
        await watchJob(id);
      } catch (error) {
        localStorage.removeItem('rapportverkstan-job');
        showError(error);
        $('#progress-panel').hidden = true;
      } finally {
        setBusy(false);
      }
    }
  } catch (error) {
    showError(error);
  }
}
void init();

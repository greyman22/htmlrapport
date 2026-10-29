import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { convertDocument } from './lib/convert.js';
import { articlePublicUrl, createStrapiClient, strapiConfig, StrapiError, ARTICLE_UID } from './lib/strapi.js';
import { planArticle, summarizePlan } from './lib/article-plan.js';
import { exportArticleDraft } from './lib/article-export.js';

const root = import.meta.dirname;
const directories = { sources: path.join(root, 'sources'), uploads: path.join(root, 'uploads'), output: path.join(root, 'output') };
const supported = new Set(['.pdf', '.docx']);
const maxFileSize = 30 * 1024 * 1024;
const jobs = new Map();
let activeJob = null;
let strapiExportActive = false;

export async function listSources() {
  const groups = await Promise.all(['sources', 'uploads'].map(async group => {
    const entries = await fs.readdir(directories[group], { withFileTypes: true });
    return Promise.all(entries.filter(entry => entry.isFile() && supported.has(path.extname(entry.name).toLowerCase())).map(async entry => {
      const stat = await fs.stat(path.join(directories[group], entry.name));
      return {
        id: Buffer.from(`${group}/${entry.name}`).toString('base64url'),
        name: group === 'uploads' ? entry.name.replace(/^[a-f0-9-]+--/, '') : entry.name,
        size: stat.size,
        format: path.extname(entry.name).slice(1).toUpperCase(),
        location: group,
      };
    }));
  }));
  return groups.flat().sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

function sourcePath(source) {
  const decoded = Buffer.from(source.id, 'base64url').toString();
  return path.join(root, ...decoded.split('/'));
}

async function validateSource(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > maxFileSize) throw new Error('Filen är för stor. Maximal filstorlek är 30 MB.');
  const handle = await fs.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(5);
    await handle.read(signature, 0, 5, 0);
    if (path.extname(filePath).toLowerCase() === '.pdf') {
      if (signature.toString() !== '%PDF-') throw new Error('Filen är inte en giltig PDF.');
    } else {
      if (signature.readUInt32LE(0) !== 0x04034b50) throw new Error('Filen är inte ett giltigt Word-dokument (.docx).');
      // Bound expanded ZIP size before Mammoth unpacks the document.
      const buffer = await fs.readFile(filePath);
      const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (end < 0 || end + 22 > buffer.length) throw new Error('Word-filen har ett skadat ZIP-format.');
      const count = buffer.readUInt16LE(end + 10);
      let offset = buffer.readUInt32LE(end + 16);
      let expanded = 0;
      if (count === 0xffff || offset === 0xffffffff) throw new Error('Word-filen använder ZIP64, som inte stöds i denna version.');
      for (let i = 0; i < count; i++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Word-filen har en skadad innehållsförteckning.');
        expanded += buffer.readUInt32LE(offset + 24);
        if (expanded > 150 * 1024 * 1024) throw new Error('Word-filens uppackade innehåll är för stort (max 150 MB).');
        offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
      }
    }
  } finally {
    await handle.close();
  }
}

async function runConversion(job, source) {
  const outputDir = path.join(directories.output, job.id);
  try {
    const input = sourcePath(source);
    await validateSource(input);
    const result = await convertDocument(input, outputDir, progress => {
      job.progress = progress;
    }, source.name);
    job.status = 'completed';
    job.result = { ...result, sourceName: source.name };
    job.completedAt = new Date().toISOString();
    job.url = `/reports/${job.id}/index.html`;
    job.downloadUrl = `/api/reports/${job.id}/download`;
    job.fragmentUrl = `/api/reports/${job.id}/fragment`;
    await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(job, null, 2));
  } catch (error) {
    console.error(`Konvertering ${job.id} misslyckades:`, error);
    job.status = 'failed';
    job.error = error.name === 'PasswordException'
      ? 'PDF:en är lösenordsskyddad. Spara en oskyddad kopia och försök igen.'
      : `Konverteringen misslyckades: ${error.message}`;
  } finally {
    activeJob = null;
  }
}

function strapiRoute(action) {
  return async (req, res) => {
    try {
      res.json(await action(createStrapiClient(strapiConfig())));
    } catch (error) {
      if (!(error instanceof StrapiError)) throw error;
      res.status(error.status).json({ error: error.message, code: error.code });
    }
  };
}

export async function createApp() {
  await Promise.all(Object.values(directories).map(dir => fs.mkdir(dir, { recursive: true })));
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      return res.status(403).json({ error: 'Anrop från en annan webbplats är inte tillåtet.' });
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  const upload = multer({
    storage: multer.diskStorage({
      destination: directories.uploads,
      filename: (req, file, cb) => cb(null, `${randomUUID()}--${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`),
    }),
    limits: { fileSize: maxFileSize, files: 1, fields: 0 },
    fileFilter: (req, file, cb) => {
      if (!supported.has(path.extname(file.originalname).toLowerCase())) return cb(new Error('Välj PDF eller .docx. Äldre .doc-filer behöver sparas om som .docx i Word.'));
      cb(null, true);
    },
  });
  app.get('/api/sources', async (req, res) => res.json(await listSources()));
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Ingen fil skickades.' });
    try {
      await validateSource(req.file.path);
    } catch (error) {
      await fs.unlink(req.file.path);
      console.warn('Uppladdad fil avvisades:', error.message);
      return res.status(400).json({ error: error.message });
    }
    const sources = await listSources();
    const id = Buffer.from(`uploads/${req.file.filename}`).toString('base64url');
    res.status(201).json(sources.find(source => source.id === id));
  });
  app.post('/api/convert', async (req, res) => {
    if (activeJob) return res.status(409).json({ error: 'En konvertering pågår redan. Vänta tills den är klar.' });
    const sources = await listSources();
    const source = sources.find(item => item.id === req.body?.sourceId);
    if (!source) return res.status(400).json({ error: 'Källan finns inte. Välj en fil från listan.' });
    // Set the lock before yielding so two simultaneous requests cannot start two jobs.
    if (activeJob) return res.status(409).json({ error: 'En konvertering pågår redan. Vänta tills den är klar.' });
    const job = { id: randomUUID(), status: 'processing', sourceName: source.name, createdAt: new Date().toISOString(), progress: { current: 0, total: 0, message: 'Förbereder konvertering' } };
    activeJob = job.id;
    jobs.set(job.id, job);
    res.status(202).json(job);
    setImmediate(() => { void runConversion(job, source); });
  });
  app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Konverteringen finns inte i den här körningen.' });
    res.json(job);
  });
  app.get('/api/reports', async (req, res) => {
    const entries = await fs.readdir(directories.output, { withFileTypes: true });
    const reports = [];
    for (const entry of entries.filter(e => e.isDirectory())) {
      const manifest = path.join(directories.output, entry.name, 'report.json');
      try {
        reports.push(JSON.parse(await fs.readFile(manifest, 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    res.json(reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  for (const [endpoint, filename] of [['download', 'index.html'], ['fragment', 'content.html']]) {
    app.get(`/api/reports/:id/${endpoint}`, async (req, res) => {
      if (!/^[a-f0-9-]{36}$/.test(req.params.id)) return res.status(404).json({ error: 'Rapporten finns inte.' });
      res.download(path.join(directories.output, req.params.id, filename), endpoint === 'download' ? 'rapport.html' : 'rapport-innehall.html', error => {
        if (error && !res.headersSent) {
          console.warn('Rapport kunde inte hämtas:', error.message);
          res.status(error.status || 500).json({ error: 'Rapporten kunde inte hämtas.' });
        }
      });
    });
  }
  app.get('/api/strapi/status', strapiRoute(client => client.status()));
  app.get('/api/strapi/article-model', strapiRoute(client => client.getArticleModel()));
  app.get('/api/strapi/articles', strapiRoute(client => client.listArticles({ status: 'draft' })));
  app.post('/api/strapi/export', async (req, res) => {
    const { reportId, testMode, dryRun } = req.body || {};
    if (typeof reportId !== 'string' || !/^[a-f0-9-]{36}$/.test(reportId)) return res.status(400).json({ error: 'Välj en rapport att skicka.' });
    let html;
    let report;
    try {
      html = await fs.readFile(path.join(directories.output, reportId, 'content.html'), 'utf8');
      report = JSON.parse(await fs.readFile(path.join(directories.output, reportId, 'report.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'Rapporten finns inte.' });
      throw error;
    }
    const plan = planArticle({ html, title: report.result.title, reportId, format: report.result.format, testMode: testMode === true, articlePath: (process.env.STRAPI_ARTICLE_PATH || '/article').trim().replace(/\/+$/, '') });
    if (dryRun) return res.json({ dryRun: true, plan: summarizePlan(plan) });
    if (strapiExportActive) return res.status(409).json({ error: 'En export till Strapi pågår redan.' });
    strapiExportActive = true;
    try {
      const config = strapiConfig();
      const result = await exportArticleDraft(createStrapiClient(config), plan);
      res.status(201).json({
        dryRun: false,
        plan: summarizePlan(plan),
        documentId: result.documentId,
        created: result.created,
        adminUrl: `${config.baseUrl}/admin/content-manager/collection-types/${ARTICLE_UID}/${result.documentId}`,
        publicUrl: articlePublicUrl(config.publicUrl, plan.slug),
      });
    } catch (error) {
      if (!(error instanceof StrapiError)) throw error;
      res.status(error.status).json({ error: error.message, code: error.code, created: error.created });
    } finally {
      strapiExportActive = false;
    }
  });
  app.use('/reports', (req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'self'; form-action 'none'");
    next();
  }, express.static(directories.output, { index: false, dotfiles: 'deny' }));
  app.use(express.static(path.join(root, 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API-adressen finns inte.' }));
  app.use((error, req, res, next) => {
    console.error('Serverfel:', error);
    if (res.headersSent) return next(error);
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const clientError = error instanceof multer.MulterError || req.path === '/api/upload' || error.type === 'entity.parse.failed';
    res.status(tooLarge ? 413 : clientError ? 400 : 500).json({
      error: tooLarge ? 'Filen är för stor. Maximal filstorlek är 30 MB.' : clientError ? error.message : 'Ett serverfel uppstod. Se terminalen för detaljer.',
    });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT måste vara ett heltal mellan 1 och 65535.');
  const app = await createApp();
  const server = app.listen(port, '127.0.0.1', () => console.log(`Rapportverkstan är redo: http://127.0.0.1:${port}`));
  server.on('error', error => {
    console.error('Kunde inte starta servern:', error.message);
    process.exitCode = 1;
  });
}

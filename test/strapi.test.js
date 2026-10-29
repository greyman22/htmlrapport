import test from 'node:test';
import assert from 'node:assert/strict';
import { articlePublicUrl, createStrapiClient, strapiConfig, StrapiError, ARTICLE_UID } from '../lib/strapi.js';

const articleType = {
  data: {
    uid: ARTICLE_UID,
    schema: {
      displayName: 'Article',
      draftAndPublish: true,
      pluginOptions: { i18n: { localized: true } },
      attributes: {
        heading: { type: 'string' },
        mainContentBlocks: { type: 'dynamiczone', components: ['main-content.rich-text'] },
      },
    },
  },
};

function fakeFetch(calls, overrides = {}) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ path, options });
    if (overrides[path]) return overrides[path];
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (path === '/_health') return { ok: true, status: 204, json: async () => { throw new Error('empty'); } };
    if (path.includes('/content-types/')) return json(articleType);
    if (path.includes('/components/')) return json({ data: { schema: { displayName: 'Rich text', attributes: { body: { type: 'blocks' } } } } });
    if (path.startsWith('/api/vinnova-strapi-common/articles') && options.method === 'POST') return json({ data: { documentId: 'abc' } });
    return json({ data: [] });
  };
}

test('strapiConfig använder standardadress och avvisar ogiltig adress', () => {
  assert.equal(strapiConfig({}).baseUrl, 'http://localhost:1337');
  assert.equal(strapiConfig({}).publicUrl, 'http://localhost:3001');
  assert.equal(strapiConfig({ STRAPI_PUBLIC_URL: 'http://localhost:4000/path' }).publicUrl, 'http://localhost:4000');
  assert.equal(strapiConfig({ STRAPI_URL: 'http://127.0.0.1:1337/admin/', STRAPI_API_TOKEN: ' t ' }).token, 't');
  assert.throws(() => strapiConfig({ STRAPI_URL: 'ftp://x' }), StrapiError);
  assert.throws(() => strapiConfig({ STRAPI_URL: 'inte en url' }), StrapiError);
  assert.throws(() => strapiConfig({ STRAPI_PUBLIC_URL: 'ftp://x' }), StrapiError);
});

test('publicerad artikel får publik URL med artikelns slug', () => {
  assert.equal(articlePublicUrl('http://localhost:3001', 'statistik-o-5466cd6f'), 'http://localhost:3001/article/statistik-o-5466cd6f');
});

test('status rapporterar nåbarhet och autentisering', async () => {
  const calls = [];
  const client = createStrapiClient({ baseUrl: 'http://s', token: 'secret', fetchImpl: fakeFetch(calls) });
  assert.deepEqual(await client.status(), { baseUrl: 'http://s', reachable: true, tokenConfigured: true, authenticated: true });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret');
});

test('status fungerar utan token och när Strapi inte svarar', async () => {
  const noToken = createStrapiClient({ baseUrl: 'http://s', token: '', fetchImpl: fakeFetch([]) });
  assert.equal((await noToken.status()).authenticated, false);
  const down = createStrapiClient({ baseUrl: 'http://s', token: 't', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await down.status()).reachable, false);
  await assert.rejects(noToken.getArticleModel(), { code: 'not_configured' });
});

test('getArticleModel löser upp komponenter', async () => {
  const model = await createStrapiClient({ baseUrl: 'http://s', token: 't', fetchImpl: fakeFetch([]) }).getArticleModel();
  assert.equal(model.localized, true);
  assert.equal(model.draftAndPublish, true);
  assert.equal(model.components['main-content.rich-text'].attributes.body.type, 'blocks');
});

test('felsvar från Strapi ger tydligt fel utan token i texten', async () => {
  const calls = [];
  const client = createStrapiClient({ baseUrl: 'http://s', token: 'secret', fetchImpl: fakeFetch(calls, { [`/api/content-type-builder/content-types/${encodeURIComponent(ARTICLE_UID)}`]: { ok: false, status: 403, json: async () => ({}) } }) });
  await assert.rejects(client.getArticleModel(), error => error.code === 'http_403' && !error.message.includes('secret'));
});

test('findTaxonomyConcept kräver rätt schema och ger tydligt fel annars', async () => {
  const path = '/api/vinnova-strapi-common/taxonomy-concepts?filters%5Bslug%5D%5B%24eq%5D=report&populate=scheme&pagination%5BpageSize%5D=50';
  const ok = { ok: true, status: 200, json: async () => ({ data: [{ documentId: 'x', scheme: { name: 'Other' } }, { documentId: 'rep', scheme: { name: 'Content Types' } }] }) };
  const client = createStrapiClient({ baseUrl: 'http://s', token: 't', fetchImpl: fakeFetch([], { [path]: ok }) });
  assert.equal((await client.findTaxonomyConcept({ scheme: 'content types', slug: 'report' })).documentId, 'rep');
  await assert.rejects(client.findTaxonomyConcept({ scheme: 'Nope', slug: 'report' }), { code: 'taxonomy_missing' });
});

test('createArticleDraft skapar alltid utkast och kräver heading och slug', async () => {
  const calls = [];
  const client = createStrapiClient({ baseUrl: 'http://s', token: 't', fetchImpl: fakeFetch(calls) });
  await assert.rejects(client.createArticleDraft({ heading: 'Bara rubrik' }), { code: 'invalid_article' });
  await client.createArticleDraft({ heading: 'H', slug: 'h' });
  const post = calls.find(call => call.options.method === 'POST');
  assert.ok(post.path.endsWith('?status=draft'));
  assert.equal(JSON.parse(post.options.body).data.publishedAt, null);
});

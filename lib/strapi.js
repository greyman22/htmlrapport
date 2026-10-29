export const ARTICLE_UID = 'plugin::vinnova-strapi-common.article';
const ARTICLE_PATH = '/api/vinnova-strapi-common/articles';
const HTML_ASSET_PATH = '/api/vinnova-strapi-common/html-assets';
const TAXONOMY_CONCEPT_PATH = '/api/vinnova-strapi-common/taxonomy-concepts';

export class StrapiError extends Error {
  constructor(message, { status = 502, code = 'strapi_error' } = {}) {
    super(message);
    Object.assign(this, { status, code });
  }
}

export function articlePublicUrl(baseUrl, slug) {
  return new URL(`/article/${encodeURIComponent(slug)}`, baseUrl).href;
}

export function strapiConfig(env = process.env) {
  const raw = (env.STRAPI_URL || 'http://localhost:1337').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new StrapiError('STRAPI_URL är inte en giltig adress.', { status: 500, code: 'invalid_config' });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new StrapiError('STRAPI_URL måste börja med http:// eller https://.', { status: 500, code: 'invalid_config' });
  }
  const rawPublicUrl = (env.STRAPI_PUBLIC_URL || 'http://localhost:3001').trim();
  let publicUrl;
  try {
    publicUrl = new URL(rawPublicUrl);
  } catch {
    throw new StrapiError('STRAPI_PUBLIC_URL är inte en giltig adress.', { status: 500, code: 'invalid_config' });
  }
  if (!['http:', 'https:'].includes(publicUrl.protocol)) {
    throw new StrapiError('STRAPI_PUBLIC_URL måste börja med http:// eller https://.', { status: 500, code: 'invalid_config' });
  }
  const articlePath = (env.STRAPI_ARTICLE_PATH || '/article').trim().replace(/\/+$/, '');
  if (!/^\/[\w\-./]*$/.test(articlePath)) {
    throw new StrapiError('STRAPI_ARTICLE_PATH måste vara en sökväg som börjar med /, till exempel /article.', { status: 500, code: 'invalid_config' });
  }
  return { baseUrl: url.origin, publicUrl: publicUrl.origin, token: (env.STRAPI_API_TOKEN || '').trim(), articlePath };
}

export function createStrapiClient({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15000 }) {
  async function request(path, { method = 'GET', body, form, auth = true } = {}) {
    if (auth && !token) {
      throw new StrapiError('STRAPI_API_TOKEN saknas. Lägg till den i .env (se .env.example).', { status: 503, code: 'not_configured' });
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: form || (body ? JSON.stringify(body) : undefined),
        signal: AbortSignal.timeout(form ? Math.max(timeoutMs, 60000) : timeoutMs),
      });
    } catch {
      throw new StrapiError(`Kunde inte nå Strapi på ${baseUrl}. Kontrollera att den körs.`, { status: 503, code: 'unreachable' });
    }
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const details = (payload?.error?.details?.errors || []).slice(0, 5).map(item => `${(item.path || []).join('.')}: ${item.message}`).join('; ');
      const hint = response.status === 401 ? 'Token avvisades.' : response.status === 403 ? 'Token saknar behörighet.' : [payload?.error?.message, details].filter(Boolean).join(' ');
      throw new StrapiError(`Strapi svarade ${response.status} för ${path.split('?')[0]}. ${hint}`.trim(), { code: `http_${response.status}` });
    }
    return payload;
  }

  const builder = '/api/content-type-builder';

  async function getContentType(uid) {
    const payload = await request(`${builder}/content-types/${encodeURIComponent(uid)}`);
    if (!payload?.data?.schema) throw new StrapiError(`Innehållsmodellen ${uid} hittades inte.`, { status: 404, code: 'not_found' });
    return payload.data;
  }

  async function getComponent(uid) {
    const payload = await request(`${builder}/components/${encodeURIComponent(uid)}`);
    return payload?.data;
  }

  return {
    async status() {
      const health = await request('/_health', { auth: false }).then(() => true, () => false);
      const result = { baseUrl, reachable: health, tokenConfigured: Boolean(token), authenticated: false };
      if (health && token) {
        try {
          await getContentType(ARTICLE_UID);
          result.authenticated = true;
        } catch (error) {
          result.error = error.message;
        }
      }
      return result;
    },

    async listContentTypes() {
      const payload = await request(`${builder}/content-types`);
      return (payload?.data || [])
        .filter(type => !type.plugin || type.plugin === 'vinnova-strapi-common' || type.uid.startsWith('api::'))
        .map(type => ({ uid: type.uid, displayName: type.schema.displayName, kind: type.schema.kind, draftAndPublish: Boolean(type.schema.draftAndPublish) }));
    },

    // Returns the Article schema with every referenced component resolved, so a mapper can be built against it.
    async getArticleModel() {
      const type = await getContentType(ARTICLE_UID);
      const { attributes, ...rest } = type.schema;
      const componentUids = new Set();
      for (const attribute of Object.values(attributes)) {
        if (attribute.type === 'component') componentUids.add(attribute.component);
        if (attribute.type === 'dynamiczone') attribute.components.forEach(uid => componentUids.add(uid));
      }
      const components = {};
      for (const uid of componentUids) {
        const component = await getComponent(uid);
        if (component) components[uid] = { displayName: component.schema.displayName, attributes: component.schema.attributes };
      }
      return {
        uid: ARTICLE_UID,
        restPath: ARTICLE_PATH,
        displayName: rest.displayName,
        draftAndPublish: Boolean(rest.draftAndPublish),
        localized: Boolean(rest.pluginOptions?.i18n?.localized),
        attributes,
        components,
      };
    },

    async listArticles({ status = 'draft', pageSize = 10 } = {}) {
      const size = Math.min(Math.max(Number(pageSize) || 10, 1), 100);
      const query = new URLSearchParams({ status, 'pagination[pageSize]': String(size), 'fields[0]': 'heading', 'fields[1]': 'slug' });
      return request(`${ARTICLE_PATH}?${query}`);
    },

    // Not exposed through any route yet. Always creates a draft; never publishes.
    async createArticleDraft(data) {
      if (!data?.heading || !data?.slug) {
        throw new StrapiError('Ett utkast kräver både heading och slug.', { status: 400, code: 'invalid_article' });
      }
      return request(`${ARTICLE_PATH}?status=draft`, { method: 'POST', body: { data: { ...data, publishedAt: null } } });
    },

    async articleSlugExists(slug) {
      for (const status of ['draft', 'published']) {
        const query = new URLSearchParams({ status, 'filters[slug][$eq]': slug, 'pagination[pageSize]': '1', 'fields[0]': 'slug' });
        const payload = await request(`${ARTICLE_PATH}?${query}`);
        if (payload?.data?.length) return true;
      }
      return false;
    },

    async findTaxonomyConcept({ scheme, slug }) {
      const query = new URLSearchParams({ 'filters[slug][$eq]': slug, populate: 'scheme', 'pagination[pageSize]': '50' });
      const payload = await request(`${TAXONOMY_CONCEPT_PATH}?${query}`);
      const match = (payload?.data || []).find(concept => concept.scheme?.name?.toLowerCase() === scheme.toLowerCase());
      if (!match?.documentId) {
        throw new StrapiError(`Taxonomivärdet "${slug}" i "${scheme}" finns inte i Strapi.`, { status: 422, code: 'taxonomy_missing' });
      }
      return match;
    },

    async uploadImage({ name, mime, buffer, alt, caption }) {
      const form = new FormData();
      form.append('files', new Blob([buffer], { type: mime }), name);
      form.append('fileInfo', JSON.stringify({ name, alternativeText: alt || null, caption: caption || null }));
      const payload = await request('/api/upload', { method: 'POST', form });
      if (!Array.isArray(payload) || !payload[0]?.id) throw new StrapiError(`Strapi returnerade ingen fil för ${name}.`, { code: 'upload_failed' });
      return payload[0];
    },

    async createHtmlAsset({ internalName, html }) {
      const payload = await request(`${HTML_ASSET_PATH}?status=published`, { method: 'POST', body: { data: { internalName, html } } });
      if (!payload?.data?.documentId) throw new StrapiError(`Strapi returnerade inget id för HTML-tillgången ${internalName}.`, { code: 'asset_failed' });
      return payload.data;
    },
  };
}

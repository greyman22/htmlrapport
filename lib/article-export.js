import { StrapiError } from './strapi.js';

const emptyText = [{ type: 'text', text: '' }];
export const REPORT_TAXONOMY = { scheme: 'Content Types', slug: 'report' };

// Order matters: uploads and html assets must exist before the article that refers to them.
export async function exportArticleDraft(client, plan, { onProgress = () => {} } = {}) {
  if (await client.articleSlugExists(plan.slug)) {
    throw new StrapiError(`Det finns redan en artikel med slug "${plan.slug}" i Strapi. Radera den eller ändra rapporten först.`, { status: 409, code: 'duplicate_slug' });
  }
  const taxonomy = await client.findTaxonomyConcept(REPORT_TAXONOMY);
  const created = { files: [], assets: [] };
  try {
    const files = new Map();
    for (const [index, image] of plan.images.entries()) {
      onProgress(`Laddar upp bild ${index + 1} av ${plan.images.length}`);
      const file = await client.uploadImage(image);
      created.files.push(file.id);
      files.set(image.key, file);
    }

    const zone = plan.pageNavigation ? [{ __component: 'main-content.page-navigation', heading: 'På den här sidan' }] : [];
    let tableNumber = 0;
    for (const part of plan.parts) {
      if (part.kind === 'table' || part.kind === 'footnotes') {
        const isTable = part.kind === 'table';
        if (isTable) tableNumber += 1;
        onProgress(isTable ? `Skapar tabell ${tableNumber} av ${plan.stats.tables}` : 'Skapar fotnotslista');
        const asset = await client.createHtmlAsset({
          internalName: `${plan.imagePrefix} – ${isTable ? `tabell ${tableNumber}` : 'fotnoter'}`,
          html: isTable ? `<div style="overflow-x:auto">${part.html}</div>` : part.html,
        });
        created.assets.push(asset.documentId);
        zone.push({ __component: 'main-content.html-asset-ref', block: asset.documentId });
        continue;
      }
      const content = part.blocks.map(block => {
        if (block.type !== 'image') return block;
        return { type: 'image', image: files.get(block.imageKey), children: emptyText };
      });
      zone.push({ __component: 'main-content.rich-text', content });
    }

    onProgress('Skapar artikelutkast');
    const response = await client.createArticleDraft({
      heading: plan.heading,
      slug: plan.slug,
      ...(plan.introduction ? { introduction: plan.introduction } : {}),
      taxonomySelection: [taxonomy.documentId],
      mainContentBlocks: zone,
    });
    return { documentId: response.data.documentId, created };
  } catch (error) {
    error.created = created;
    throw error;
  }
}

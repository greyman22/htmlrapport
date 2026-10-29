import { createStrapiClient, strapiConfig, StrapiError } from '../lib/strapi.js';

try {
  const client = createStrapiClient(strapiConfig());
  const status = await client.status();
  console.error(`Strapi: ${status.baseUrl} nåbar=${status.reachable} autentiserad=${status.authenticated}`);
  console.log(JSON.stringify(await client.getArticleModel(), null, 2));
} catch (error) {
  if (!(error instanceof StrapiError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}

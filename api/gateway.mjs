import { createHandler } from '../server.mjs';
import { readConfig } from '../server/config.mjs';

const handler = createHandler(readConfig());
export default async function gateway(request, response) {
  const url = new URL(request.url, 'https://localhost');
  const route = request.query?.route || url.searchParams.get('route');
  if (route) {
    url.pathname = '/api/' + (Array.isArray(route) ? route.join('/') : route);
    url.searchParams.delete('route');
    request.url = url.pathname + url.search;
  }
  return handler(request, response);
}

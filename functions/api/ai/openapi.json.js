export async function onRequest({ request }) {
  const origin = new URL(request.url).origin;
  const document = {
    openapi: '3.0.3',
    info: {
      title: 'La Tienda de Alex · API de búsqueda de productos',
      version: '1.0.0',
      description: 'Busca productos en el catálogo público y obtiene precio, disponibilidad e hipervínculo de compra.',
    },
    servers: [{ url: origin }],
    paths: {
      '/api/ai/products/search': {
        get: {
          operationId: 'searchStoreProducts',
          summary: 'Buscar productos de la tienda',
          parameters: [
            { name: 'q', in: 'query', required: true, description: 'Nombre, marca o modelo que busca el cliente.', schema: { type: 'string', minLength: 2, maxLength: 120 } },
            { name: 'category', in: 'query', required: false, description: 'Categoría opcional para filtrar.', schema: { type: 'string' } },
            { name: 'limit', in: 'query', required: false, description: 'Máximo de productos devueltos (1–8).', schema: { type: 'integer', minimum: 1, maximum: 8, default: 6 } },
          ],
          responses: {
            '200': {
              description: 'Productos coincidentes.',
              content: { 'application/json': { schema: { type: 'object', properties: {
                query: { type: 'string' }, currency: { type: 'string', example: 'COP' },
                total: { type: 'integer' }, count: { type: 'integer' },
                products: { type: 'array', items: { type: 'object', properties: {
                  name: { type: 'string' }, brand: { type: 'string' }, description: { type: 'string' },
                  category: { type: 'string' }, price: { type: 'number' }, available: { type: 'boolean' },
                  image: { type: 'string' }, images: { type: 'array', items: { type: 'string' } },
                  url: { type: 'string', format: 'uri' },
                  paymentOptions: { type: 'array', items: { type: 'object', properties: {
                    label: { type: 'string' }, price: { type: 'number' },
                  } } },
                } } },
              } } } },
            },
            '400': { description: 'La búsqueda requiere al menos dos caracteres.' },
            '503': { description: 'El catálogo no está disponible.' },
          },
        },
      },
    },
  };
  return new Response(JSON.stringify(document), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const states = ['queued', 'running', 'succeeded', 'partial', 'blocked', 'failed', 'cancelled'];
export const createBody = {
  type: 'object', additionalProperties: false, required: ['customers', 'region'],
  properties: {
    region: { type: 'string', minLength: 2, maxLength: 100, pattern: '\\S' },
    customers: { type: 'array', minItems: 1, maxItems: 1000, items: {
      type: 'object', additionalProperties: false, required: ['id', 'name'],
      properties: { id: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' }, name: { type: 'string', minLength: 2, maxLength: 200, pattern: '\\S' } }
    } }
  }
};
export const jobParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } } };
export const pagination = { type: 'object', additionalProperties: false, properties: { offset: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 } } };
const error = { description: 'Structured error: {error:{code,message,requestId}}', content: { 'application/json': { schema: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'requestId'], properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } } } } } };
const job = { type: 'object', required: ['id', 'status', 'region', 'total', 'processed', 'errors', 'createdAt', 'updatedAt'], properties: {
  id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: states }, region: { type: 'string' }, total: { type: 'integer' }, processed: { type: 'integer' }, errors: { type: 'integer' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' }, errorCode: { type: ['string', 'null'] }
} };
const json = schema => ({ description: 'Success', content: { 'application/json': { schema } } });
const responseErrors = Object.fromEntries([400, 401, 404, 409, 413, 429, 500, 503].map(code => [code, error]));
export const openapi = {
  openapi: '3.1.0', info: { title: 'Customer Maps Matching API', version: '1.0.0', description: 'Asynchronous business-location matching. Pins are candidates, not verified customer identities. Single instance, durable SQLite. Results include partial progress. Retention defaults to seven days.' },
  servers: [{ url: '/' }], security: [{ ApiKey: [] }],
  components: { securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } }, schemas: { Job: job, CreateJob: createBody } },
  paths: {
    '/health/live': { get: { operationId: 'liveness', security: [], responses: { 200: json({ type: 'object' }) } } },
    '/health/ready': { get: { operationId: 'readiness', security: [], responses: { 200: json({ type: 'object' }), 503: error } } },
    '/v1/jobs': {
      post: { operationId: 'createJob', description: 'Returns 202 immediately. Customer ids must be unique within a job. Optional Idempotency-Key is scoped to the client and retained until job deletion/expiry. Same key with a different body returns 409. Unknown fields are rejected. Queue/storage quotas return 429.', parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string', minLength: 8, maxLength: 128 } }], requestBody: { required: true, content: { 'application/json': { schema: createBody, example: { region: 'Sumatra Selatan', customers: [{ id: 'C001', name: 'PT Bupala Alam Perkasa' }] } } } }, responses: { 202: json(job), ...responseErrors } },
      get: { operationId: 'listJobs', parameters: pageParameters(), responses: { 200: json({ type: 'object', properties: { items: { type: 'array', items: job }, offset: { type: 'integer' }, limit: { type: 'integer' } } }), ...responseErrors } }
    },
    '/v1/jobs/{id}': {
      get: { operationId: 'getJob', parameters: idParameter(), responses: { 200: json(job), ...responseErrors } },
      delete: { operationId: 'deleteJob', description: 'Delete a terminal job, its results and idempotency key. Running/queued jobs return 409; cancel first.', parameters: idParameter(), responses: { 204: { description: 'Deleted' }, ...responseErrors } }
    },
    '/v1/jobs/{id}/results': { get: { operationId: 'getResults', description: 'Available during execution. Ordered by original customer input index, which remains stable across resume. item: {index,customer:{id,name},checkedAt,match:{status,reason,best,candidates}}. best is nullable; candidates contain name,address,phone,website,lat,lng,mapsUrl,coordinateSource and comparison observations. A row failure has errorCode and a null match. total is the number of processed rows, not the number of matched businesses.', parameters: [...idParameter(), ...pageParameters()], responses: { 200: json({ type: 'object', required: ['jobId', 'status', 'total', 'items', 'offset', 'limit'], properties: { jobId: { type: 'string' }, status: { type: 'string', enum: states }, total: { type: 'integer' }, offset: { type: 'integer' }, limit: { type: 'integer' }, items: { type: 'array', items: { type: 'object' } } } }), ...responseErrors } } },
    '/v1/jobs/{id}/cancel': { post: { operationId: 'cancelJob', description: 'Idempotently cancels queued/running work and preserves completed rows. Already-terminal jobs are returned unchanged.', parameters: idParameter(), responses: { 200: json(job), ...responseErrors } } },
    '/v1/openapi.json': { get: { operationId: 'getContract', responses: { 200: json({ type: 'object' }), 401: error } } }
  }
};
function idParameter() { return [{ name: 'id', in: 'path', required: true, schema: jobParams.properties.id }]; }
function pageParameters() { return Object.entries(pagination.properties).map(([name, schema]) => ({ name, in: 'query', schema })); }

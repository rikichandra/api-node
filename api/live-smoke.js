import fs from "node:fs/promises";
import assert from "node:assert/strict";
const headers = {
  "x-api-key": Object.values(JSON.parse(process.env.API_KEYS))[0],
  "content-type": "application/json",
  "idempotency-key": `production-smoke-${Date.now()}`,
};
const base = `http://127.0.0.1:${process.env.PORT || 3108}`;
const first = await fetch(`${base}/v1/jobs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    region: "Sumatra Selatan",
    customers: [{ id: "SMOKE-001", name: "PT Bupala Alam Perkasa" }],
  }),
});
assert.equal(first.status, 202);
const created = await first.json();
let job;
for (let i = 0; i < 120; i++) {
  const response = await fetch(`${base}/v1/jobs/${created.id}`, { headers });
  assert.equal(response.status, 200);
  job = await response.json();
  if (!["queued", "running"].includes(job.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.equal(job.status, "succeeded");
const results = await (
  await fetch(`${base}/v1/jobs/${created.id}/results`, { headers })
).json();
assert.equal(results.total, 1);
assert.equal(results.items[0].match.status, "Nama dan provinsi cocok");
assert.equal(typeof results.items[0].match.best.lat, "number");
assert.equal(typeof results.items[0].match.best.lng, "number");
await fs.writeFile(
  "storage/live-smoke.json",
  JSON.stringify(
    { checkedAt: new Date().toISOString(), job, results },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    status: job.status,
    customerRows: results.total,
    match: results.items[0].match.status,
    coordinatesAvailable: true,
    jobId: job.id,
  }),
);

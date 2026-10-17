const blocked = e => ['GOOGLE_BLOCKED', 'GOOGLE_CONSENT'].includes(e.code);
export class JobRunner {
  constructor(store, factory, config, log) {
    this.store = store; this.factory = factory; this.config = config; this.log = log;
    this.active = new Map(); this.stopping = false; this.fatal = false;
  }
  start() {
    this.store.cleanup();
    this.timer = setInterval(() => this.tick(), 250);
    this.cleaner = setInterval(() => { try { this.store.cleanup(); } catch { this.fail(); } }, 3600000);
    this.tick();
  }
  fail() { if (this.fatal) return; this.fatal = true; this.stopping = true; this.log.error('Storage or worker lifecycle failure; restart required'); for (const a of this.active.values()) a.controller.abort('shutdown'); this.config.onFatal?.(); }
  tick() {
    if (this.stopping || this.store.cooldown() > Date.now()) return;
    try {
      while (this.active.size < this.config.workers) {
        const job = this.store.claim();
        if (!job) break;
        const controller = new AbortController();
        const entry = { controller };
        this.active.set(job.id, entry);
        entry.promise = this.run(job, controller).catch(() => this.fail()).finally(() => this.active.delete(job.id));
      }
    } catch { this.fail(); }
  }
  cancel(id) { this.active.get(id)?.controller.abort('cancel'); }
  async run(job, controller) {
    const { signal } = controller;
    let matcher;
    const remaining = this.config.jobTimeoutMs - (Date.now() - job.started_at);
    const timeout = setTimeout(() => controller.abort('timeout'), Math.max(0, remaining));
    try {
      if (remaining <= 0) throw Object.assign(new Error('Job deadline reached'), { code: 'JOB_TIMEOUT' });
      matcher = await this.factory({ signal });
      const customers = JSON.parse(job.customers), done = this.store.doneIndices(job.id);
      for (let index = 0; index < customers.length; index++) {
        if (signal.aborted) throw new Error('Aborted');
        if (done.has(index)) continue;
        const customer = customers[index];
        let match, errorCode;
        try {
          const found = await matcher.find(customer.name, job.region);
          const safeCandidate = c => {
            if (!c) return null;
            const { coordinateError, ...rest } = c;
            return { ...rest, ...(coordinateError ? { coordinateError: 'COORDINATES_UNAVAILABLE' } : {}) };
          };
          match = { status: found.status, reason: found.reason, best: safeCandidate(found.best), candidates: (found.candidates || []).map(safeCandidate) };
          if (found.status === 'Pencarian gagal' || found.errors?.length) errorCode = 'UPSTREAM_DETAIL_ERROR';
        } catch (e) {
          if (blocked(e) || signal.aborted) throw e;
          errorCode = e.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR';
        }
        if (signal.aborted) throw new Error('Aborted');
        this.store.append(job.id, index, { index, customer, checkedAt: new Date().toISOString(), match: match || null, ...(errorCode ? { errorCode } : {}) });
      }
      this.store.finish(job.id, this.store.read(job.id).errors ? 'partial' : 'succeeded');
    } catch (e) {
      if (signal.reason === 'shutdown') this.store.finish(job.id, 'queued');
      else if (signal.reason === 'cancel') this.store.finish(job.id, 'cancelled');
      else if (signal.reason === 'timeout' || e.code === 'JOB_TIMEOUT') this.store.finish(job.id, 'failed', 'JOB_TIMEOUT');
      else if (blocked(e)) {
        this.store.blockUntil(Date.now() + this.config.cooldownMs);
        this.store.finish(job.id, 'blocked', e.code);
        // Stop other browsers too; preserve their checkpoints for a later resume.
        for (const [id, a] of this.active) if (id !== job.id) a.controller.abort('shutdown');
      } else this.store.finish(job.id, 'failed', 'BROWSER_ERROR');
    } finally {
      clearTimeout(timeout);
      await matcher?.close().catch(() => {});
    }
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer); clearInterval(this.cleaner);
    for (const a of this.active.values()) a.controller.abort('shutdown');
    await Promise.allSettled([...this.active.values()].map(a => a.promise));
  }
}

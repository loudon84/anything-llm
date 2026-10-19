function createWorker({ store, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout, renewalMs = 20_000 } = {}) {
  if (!store || typeof store.acquireLease !== 'function') throw new Error('MGW_WORKER_DEPENDENCIES_REQUIRED');
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') throw new Error('MGW_WORKER_TIMER_REQUIRED');

  async function runGeneration(generationId, workerId, execute) {
    if (typeof generationId !== 'string' || !generationId || typeof workerId !== 'string' || !workerId.trim())
      throw new Error('MGW_WORKER_INPUT_INVALID');
    if (typeof execute !== 'function') throw new Error('MGW_WORKER_EXECUTOR_REQUIRED');
    if (!Number.isInteger(renewalMs) || renewalMs < 1 || renewalMs >= 60_000)
      throw new Error('MGW_WORKER_RENEWAL_INTERVAL_INVALID');

    const lease = await store.acquireLease(generationId, workerId);
    if (lease.lease_owner !== workerId || !Number.isInteger(lease.fencing_token)) throw new Error('MGW_LEASE_INVALID');

    const controller = new AbortController();
    let renewalTimer;
    let expiryTimer;
    let stopped = false;
    let rejectLost;
    const lost = new Promise((_, reject) => { rejectLost = reject; });
    // Keep the rejection handled even if execute settles before the first renewal.
    lost.catch(() => {});

    const stopForLeaseLoss = (cause) => {
      if (stopped) return;
      stopped = true;
      if (renewalTimer !== undefined) clearTimeout(renewalTimer);
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      controller.abort(cause);
      const error = new Error('MGW_LEASE_LOST');
      error.cause = cause;
      rejectLost(error);
    };

    const deadlineTime = (candidate) => {
      const value = candidate instanceof Date ? candidate.getTime() : new Date(candidate).getTime();
      if (!Number.isFinite(value)) throw new Error('MGW_LEASE_INVALID');
      return value;
    };

    const scheduleExpiry = (deadline) => {
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      // Stop one second early so a delayed or hung renewal cannot run on an expired lease.
      const deadlineValue = deadlineTime(deadline);
      if (deadlineValue <= Date.now() + 1_000) throw new Error('MGW_LEASE_EXPIRED');
      const delay = deadlineValue - Date.now() - 1_000;
      expiryTimer = setTimeout(() => stopForLeaseLoss(new Error('MGW_LEASE_EXPIRED')), delay);
    };

    const renewAtInterval = () => {
      if (stopped) return;
      renewalTimer = setTimeout(async () => {
        renewalTimer = undefined;
        try {
          const renewed = await store.acquireLease(generationId, workerId);
          if (stopped) return;
          if (renewed.lease_owner !== workerId || renewed.fencing_token !== lease.fencing_token) {
            throw new Error('MGW_STALE_FENCE');
          }
          scheduleExpiry(renewed.lease_deadline);
          renewAtInterval();
        } catch (error) {
          stopForLeaseLoss(error);
        }
      }, renewalMs);
    };

    try {
      scheduleExpiry(lease.lease_deadline);
      renewAtInterval();
      const execution = Promise.resolve().then(() => execute({ generationId, workerId, fence: lease.fencing_token, signal: controller.signal }));
      const result = await Promise.race([execution, lost]);
      if (controller.signal.aborted) throw new Error('MGW_LEASE_LOST');
      return result;
    } finally {
      stopped = true;
      if (renewalTimer !== undefined) clearTimeout(renewalTimer);
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    }
  }

  return { runGeneration };
}

module.exports = { createWorker };

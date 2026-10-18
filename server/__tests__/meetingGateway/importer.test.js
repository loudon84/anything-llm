const { createWorker } = require('../../utils/meetingGateway/worker');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('meeting gateway import worker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => jest.useRealTimers());

  test('renews the same lease without changing its fence and clears timers when work finishes', async () => {
    const first = { id: 'generation-1', lease_owner: 'worker-a', fencing_token: 4, lease_deadline: new Date(60_000) };
    const renewed = { ...first, lease_deadline: new Date(80_000) };
    const run = deferred();
    const store = { acquireLease: jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(renewed) };
    const worker = createWorker({ store });

    const running = worker.runGeneration('generation-1', 'worker-a', ({ fence, signal }) => {
      expect(fence).toBe(4);
      expect(signal.aborted).toBe(false);
      return run.promise;
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(store.acquireLease).toHaveBeenNthCalledWith(2, 'generation-1', 'worker-a');
    run.resolve('committed');
    await expect(running).resolves.toBe('committed');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('cancels work before the current lease expires when renewal hangs', async () => {
    const renewal = deferred();
    const work = deferred();
    const store = {
      acquireLease: jest.fn().mockResolvedValueOnce({
        id: 'generation-1', lease_owner: 'worker-a', fencing_token: 4, lease_deadline: new Date(60_000),
      }).mockReturnValueOnce(renewal.promise),
    };
    const worker = createWorker({ store });
    let signal;
    const running = worker.runGeneration('generation-1', 'worker-a', (context) => {
      signal = context.signal;
      return work.promise;
    });
    const result = running.then((value) => ({ value }), (error) => ({ error }));

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(store.acquireLease).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(39_000);
    await expect(result).resolves.toMatchObject({ error: { message: 'MGW_LEASE_LOST' } });
    expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    renewal.resolve({ lease_owner: 'worker-a', fencing_token: 4, lease_deadline: new Date(80_000) });
    work.resolve('late result');
  });

  test.each([0, 500])('rejects a lease with only %i ms remaining before executing', async (remainingMs) => {
    const execute = jest.fn().mockResolvedValue('should not run');
    const store = {
      acquireLease: jest.fn().mockResolvedValue({
        id: 'generation-1', lease_owner: 'worker-a', fencing_token: 4,
        lease_deadline: new Date(Date.now() + remainingMs),
      }),
    };
    const worker = createWorker({ store });

    await expect(worker.runGeneration('generation-1', 'worker-a', execute)).rejects.toThrow('MGW_LEASE_EXPIRED');
    expect(execute).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  test.each([
    ['fencing token', { lease_owner: 'worker-a', fencing_token: 5 }],
    ['lease owner', { lease_owner: 'worker-b', fencing_token: 4 }],
  ])('cancels work when renewal changes the %s', async (_label, renewal) => {
    const work = deferred();
    const store = {
      acquireLease: jest.fn()
        .mockResolvedValueOnce({ id: 'generation-1', lease_owner: 'worker-a', fencing_token: 4, lease_deadline: new Date(60_000) })
        .mockResolvedValueOnce({ ...renewal, lease_deadline: new Date(80_000) }),
    };
    const worker = createWorker({ store });
    let signal;
    const running = worker.runGeneration('generation-1', 'worker-a', (context) => {
      signal = context.signal;
      return work.promise;
    });
    const result = running.then((value) => ({ value }), (error) => ({ error }));
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toMatchObject({ error: { message: 'MGW_LEASE_LOST' } });
    expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    work.resolve('late result');
  });
});

import { it, expect, vi } from 'vitest';
import { KuboEngine } from '../../src/main/ipfs/engine';

it('resolves an IPNS name once per window, shares in-flight lookups and does not cache failures', async () => {
  vi.useFakeTimers();
  try {
    const engine = new KuboEngine('/missing', '/tmp/unused');
    const json = vi
      .spyOn(engine, 'json')
      .mockResolvedValueOnce({ Path: '/ipfs/one' })
      .mockRejectedValueOnce(Error('could not resolve name'))
      .mockResolvedValueOnce({ Path: '/ipfs/two' })
      .mockResolvedValueOnce({ Path: '/ipfs/three' });
    const [a, b] = await Promise.all([
      engine.resolveIPNS('a'),
      engine.resolveIPNS('a'),
    ]);
    expect([a, b]).toEqual(['/ipfs/one', '/ipfs/one']);
    expect(json).toHaveBeenCalledTimes(1);
    await expect(engine.resolveIPNS('b')).rejects.toThrow('could not resolve');
    expect(await engine.resolveIPNS('b')).toBe('/ipfs/two');
    vi.advanceTimersByTime(31000);
    expect(await engine.resolveIPNS('a')).toBe('/ipfs/three');
  } finally {
    vi.useRealTimers();
  }
});

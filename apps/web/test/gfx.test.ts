/**
 * Graphics presets.
 *
 * The thing worth testing here is not how anything looks — it is that `low` genuinely costs
 * less than `high` on every axis, and that an unknown or missing value lands somewhere safe.
 * A preset that silently does the expensive thing is worse than no preset, because the
 * players who pick it are exactly the ones who cannot afford it.
 */
import { describe, expect, it } from 'vitest';

import { defaultState, sanitizeSave } from '@crown/shared';
import type { Quality } from '@crown/shared';
import { getQuality, profile, setQuality } from '../src/gfx';

const ORDER: Quality[] = ['low', 'med', 'high'];

describe('quality presets', () => {
  it('each step up costs at least as much as the one below, on every axis', () => {
    const p = ORDER.map((q) => {
      setQuality(q);
      return profile();
    });
    for (let i = 1; i < p.length; i++) {
      expect(p[i].particleScale, `${ORDER[i]} particles`).toBeGreaterThanOrEqual(p[i - 1].particleScale);
      expect(p[i].hqUnitLimit, `${ORDER[i]} hq limit`).toBeGreaterThanOrEqual(p[i - 1].hqUnitLimit);
      expect(p[i].bloomScale, `${ORDER[i]} bloom scale`).toBeGreaterThanOrEqual(p[i - 1].bloomScale);
      expect(p[i].bloomStrength, `${ORDER[i]} bloom strength`).toBeGreaterThanOrEqual(p[i - 1].bloomStrength);
    }
  });

  it('low skips the offscreen buffers entirely rather than shrinking them', () => {
    setQuality('low');
    const p = profile();
    // The point of `low` is that a phone which cannot afford a second canvas never allocates
    // one. A tiny bloom buffer would still cost a full-screen composite every frame.
    expect(p.bloom).toBe(false);
    expect(p.ambience).toBe(false);
    expect(p.hitStop).toBe(false);
    // ...but soft additive particles stay on at every tier: they are the bulk of the look and
    // they are cheaper than the squares they replaced were readable.
    expect(p.softParticles).toBe(true);
  });

  it('high turns everything on', () => {
    setQuality('high');
    const p = profile();
    expect(p.bloom).toBe(true);
    expect(p.ambience).toBe(true);
    expect(p.hitStop).toBe(true);
    expect(p.particleScale).toBe(1);
  });

  it('falls back to high for anything unrecognised', () => {
    setQuality('nonsense' as Quality);
    expect(getQuality()).toBe('high');
    setQuality(undefined as unknown as Quality);
    expect(getQuality()).toBe('high');
  });

  it('every preset degrades before the arena gets crowded', () => {
    // A 10-card Bone Horde plus a Behemoth splitting is ~40 units; each preset must have
    // dropped its expensive per-unit shadows well before that.
    for (const q of ORDER) {
      setQuality(q);
      expect(profile().hqUnitLimit, `${q}`).toBeLessThan(40);
    }
  });
});

describe('quality on the save', () => {
  it('defaults to high for a new account', () => {
    expect(defaultState().quality).toBe('high');
  });

  it('survives sanitisation, and a junk value is clamped rather than trusted', () => {
    for (const q of ORDER) {
      expect(sanitizeSave({ ...defaultState(), quality: q }).save.quality).toBe(q);
    }
    expect(sanitizeSave({ ...defaultState(), quality: 'ultra' }).save.quality).toBe('high');
    expect(sanitizeSave({ ...defaultState(), quality: 42 }).save.quality).toBe('high');
    // Old saves written before the setting existed.
    const legacy = { ...defaultState() } as Record<string, unknown>;
    delete legacy.quality;
    expect(sanitizeSave(legacy).save.quality).toBe('high');
  });
});

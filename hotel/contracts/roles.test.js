import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from './permissions.js';
import { matrixUpdateSchema } from './roles.js';

describe('matrixUpdateSchema', () => {
  it('geçerli matrisi kabul eder', () => {
    const result = matrixUpdateSchema.safeParse({
      grants: [{ role: 'FRONT_DESK', permissions: [PERMISSIONS.ROOMS_VIEW, PERMISSIONS.MESSAGES_VIEW] }],
    });
    assert.equal(result.success, true);
  });

  it('bilinmeyen rolü reddeder', () => {
    assert.equal(matrixUpdateSchema.safeParse({ grants: [{ role: 'KRAL', permissions: [] }] }).success, false);
  });

  it('bilinmeyen izni reddeder', () => {
    assert.equal(
      matrixUpdateSchema.safeParse({ grants: [{ role: 'FRONT_DESK', permissions: ['nope.perm'] }] }).success,
      false,
    );
  });

  it('aynı izni iki kez reddeder', () => {
    assert.equal(
      matrixUpdateSchema.safeParse({
        grants: [{ role: 'FRONT_DESK', permissions: [PERMISSIONS.ROOMS_VIEW, PERMISSIONS.ROOMS_VIEW] }],
      }).success,
      false,
    );
  });

  it('aynı rolü iki kez reddeder', () => {
    assert.equal(
      matrixUpdateSchema.safeParse({
        grants: [
          { role: 'FRONT_DESK', permissions: [] },
          { role: 'FRONT_DESK', permissions: [] },
        ],
      }).success,
      false,
    );
  });
});

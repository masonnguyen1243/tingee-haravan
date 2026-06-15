import { generateReconcileCode } from '../../src/utils/reconcile';

describe('generateReconcileCode', () => {
  test('format matches TG[A-Z0-9]{7}', () => {
    const code = generateReconcileCode();
    expect(code).toMatch(/^TG[A-Z0-9]{7}$/);
  });

  test('total length is 9 characters', () => {
    expect(generateReconcileCode()).toHaveLength(9);
  });

  test('1000 generated codes are all unique', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateReconcileCode));
    expect(codes.size).toBe(1000);
  });
});

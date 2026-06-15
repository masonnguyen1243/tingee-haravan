import { validateToken, getOrder, markOrderPaid } from '../../src/services/haravan';

const HARAVAN_BASE = 'https://apis.haravan.com/com';

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => jest.restoreAllMocks());

describe('validateToken', () => {
  test('succeeds on 200', async () => {
    const spy = mockFetch(200, { shop: { id: 1 } });
    await expect(validateToken('tok_abc')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      `${HARAVAN_BASE}/shop.json`,
      expect.objectContaining({ headers: { Authorization: 'Bearer tok_abc' } })
    );
  });

  test('throws on 401', async () => {
    mockFetch(401, {});
    await expect(validateToken('bad_token')).rejects.toThrow('401');
  });
});

describe('getOrder', () => {
  test('returns order on 200', async () => {
    const order = { id: '99', total_price: '500000' };
    const spy = mockFetch(200, { order });
    const result = await getOrder('tok_abc', '99');
    expect(result).toEqual(order);
    expect(spy).toHaveBeenCalledWith(
      `${HARAVAN_BASE}/orders/99.json`,
      expect.objectContaining({ headers: { Authorization: 'Bearer tok_abc' } })
    );
  });

  test('throws on 404', async () => {
    mockFetch(404, {});
    await expect(getOrder('tok_abc', '999')).rejects.toThrow('404');
  });
});

describe('markOrderPaid', () => {
  test('calls correct URL and body on success', async () => {
    const spy = mockFetch(200, {});
    await expect(markOrderPaid('tok_abc', '42', 150000)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      `${HARAVAN_BASE}/orders/42/transactions.json`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok_abc' }),
        body: JSON.stringify({ transaction: { kind: 'Capture', amount: 150000 } }),
      })
    );
  });

  test('throws on non-200', async () => {
    mockFetch(422, {});
    await expect(markOrderPaid('tok_abc', '42', 150000)).rejects.toThrow('422');
  });
});

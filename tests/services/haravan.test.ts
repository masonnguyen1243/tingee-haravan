import { getShop, getOrder, markOrderPaid, registerScriptTag } from '../../src/services/haravan';

const HARAVAN_BASE = 'https://apis.haravan.com/com';

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => jest.restoreAllMocks());

describe('getShop', () => {
  test('returns shop data on 200', async () => {
    const shopData = { id: 1, domain: 'test.myharavan.com' };
    const spy = mockFetch(200, { shop: shopData });
    const result = await getShop('tok_abc');
    expect(result).toEqual(shopData);
    expect(spy).toHaveBeenCalledWith(
      `${HARAVAN_BASE}/shop.json`,
      expect.objectContaining({ headers: { Authorization: 'Bearer tok_abc' } })
    );
  });

  test('throws on 401', async () => {
    mockFetch(401, {});
    await expect(getShop('bad_token')).rejects.toThrow('401');
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

describe('registerScriptTag', () => {
  test('calls correct URL and body on success', async () => {
    const spy = mockFetch(201, { script_tag: { id: 1 } });
    const scriptUrl = 'https://app.example.com/payment-redirect.js';
    await expect(registerScriptTag('tok_abc', scriptUrl)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      `${HARAVAN_BASE}/script_tags.json`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok_abc' }),
        body: JSON.stringify({ script_tag: { event: 'onload', src: scriptUrl } }),
      })
    );
  });

  test('throws on non-200', async () => {
    mockFetch(422, {});
    await expect(registerScriptTag('tok_abc', 'https://x.com/s.js')).rejects.toThrow('422');
  });
});

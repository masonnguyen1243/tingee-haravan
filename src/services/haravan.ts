const HARAVAN_BASE = 'https://apis.haravan.com/com';

export async function validateToken(token: string): Promise<void> {
  const res = await fetch(`${HARAVAN_BASE}/shop.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Haravan token invalid: ${res.status}`);
}

export async function getOrder(token: string, orderId: string): Promise<any> {
  const res = await fetch(`${HARAVAN_BASE}/orders/${orderId}.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getOrder failed: ${res.status}`);
  const data = await res.json() as { order: any };
  return data.order;
}

export async function markOrderPaid(
  token: string,
  orderId: string,
  amount: number
): Promise<void> {
  const res = await fetch(`${HARAVAN_BASE}/orders/${orderId}/transactions.json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transaction: { kind: 'Capture', amount } }),
  });
  if (!res.ok) throw new Error(`markOrderPaid failed: ${res.status}`);
}

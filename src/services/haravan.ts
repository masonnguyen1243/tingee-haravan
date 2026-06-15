const HARAVAN_BASE = 'https://apis.haravan.com/com';

export async function getShop(accessToken: string): Promise<any> {
  const res = await fetch(`${HARAVAN_BASE}/shop.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`getShop failed: ${res.status}`);
  const data = await res.json() as { shop: any };
  return data.shop;
}

export async function getOrder(accessToken: string, orderId: string): Promise<any> {
  const res = await fetch(`${HARAVAN_BASE}/orders/${orderId}.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`getOrder failed: ${res.status}`);
  const data = await res.json() as { order: any };
  return data.order;
}

export async function markOrderPaid(
  accessToken: string,
  orderId: string,
  amount: number
): Promise<void> {
  const res = await fetch(`${HARAVAN_BASE}/orders/${orderId}/transactions.json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transaction: { kind: 'Capture', amount } }),
  });
  if (!res.ok) throw new Error(`markOrderPaid failed: ${res.status}`);
}

export async function registerScriptTag(
  accessToken: string,
  scriptUrl: string
): Promise<void> {
  const res = await fetch(`${HARAVAN_BASE}/script_tags.json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ script_tag: { event: 'onload', src: scriptUrl } }),
  });
  if (!res.ok) throw new Error(`registerScriptTag failed: ${res.status}`);
}

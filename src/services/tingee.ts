import { TingeeClient } from '@tingee/sdk-node';
import type { OpenApiGetVAPagedOuputDto } from '@tingee/sdk-node';

export async function getVaList(
  clientId: string,
  secretToken: string
): Promise<OpenApiGetVAPagedOuputDto[]> {
  const client = new TingeeClient({ clientId, secretKey: secretToken });
  const res = await client.bank.getVaPaging({
    skipCount: 0,
    maxResultCount: 50,
    merchantId: 0,
    accountType: 'personal-account',
    dataAccess: 'with-package-only',
  });
  if (res.code !== '00') {
    throw new Error(`Tingee getVaList error: ${res.code} ${res.message}`);
  }
  return res.data?.items ?? [];
}

export interface GenerateQROptions {
  bankBin: string;
  accountNumber: string;
  amount: number;
  content: string;
}

export async function generateQR(
  clientId: string,
  secretToken: string,
  opts: GenerateQROptions
): Promise<{ qrCode: string; qrCodeImage: string }> {
  const client = new TingeeClient({ clientId, secretKey: secretToken });
  const res = await client.bank.generateVietQr({
    bankBin: opts.bankBin,
    accountNumber: opts.accountNumber,
    amount: opts.amount,
    content: opts.content,
  });
  if (res.code !== '00') {
    throw new Error(`Tingee generateQR error: ${res.code} ${res.message}`);
  }
  return {
    qrCode: res.data!.qrCode,
    qrCodeImage: res.data!.qrCodeImage,
  };
}

import { getVaList, generateQR } from '../../src/services/tingee';

const mockGetVaPaging = jest.fn();
const mockGenerateVietQr = jest.fn();

jest.mock('@tingee/sdk-node', () => ({
  TingeeClient: jest.fn().mockImplementation(() => ({
    bank: {
      getVaPaging: mockGetVaPaging,
      generateVietQr: mockGenerateVietQr,
    },
  })),
}));

afterEach(() => jest.clearAllMocks());

describe('getVaList', () => {
  test('returns items on success', async () => {
    const items = [
      { accountNumber: '123456789', bankBin: '970422', bankName: 'MB' as const },
    ];
    mockGetVaPaging.mockResolvedValueOnce({ code: '00', message: 'Success', data: { items } });

    const result = await getVaList('client_id', 'secret');
    expect(result).toEqual(items);
  });

  test('passes correct pagination and filter fields', async () => {
    mockGetVaPaging.mockResolvedValueOnce({ code: '00', message: 'Success', data: { items: [] } });
    await getVaList('client_id', 'secret');
    expect(mockGetVaPaging).toHaveBeenCalledWith(
      expect.objectContaining({ skipCount: 0, maxResultCount: 50 })
    );
  });

  test('throws on error code', async () => {
    mockGetVaPaging.mockResolvedValueOnce({ code: '97', message: 'Bad signature', data: null });
    await expect(getVaList('client_id', 'secret')).rejects.toThrow('97');
  });

  test('returns empty array when data has no items', async () => {
    mockGetVaPaging.mockResolvedValueOnce({ code: '00', message: 'Success', data: { items: [] } });
    await expect(getVaList('client_id', 'secret')).resolves.toEqual([]);
  });
});

describe('generateQR', () => {
  const opts = {
    bankBin: '970422',
    accountNumber: '123456789',
    amount: 500000,
    content: 'TGABC1234',
  };

  test('returns qrCode and qrCodeImage on success', async () => {
    mockGenerateVietQr.mockResolvedValueOnce({
      code: '00',
      message: 'Success',
      data: { qrCode: 'qr_string', qrCodeImage: 'base64_image', qrAccount: '', referenceLabelCode: '' },
    });

    const result = await generateQR('client_id', 'secret', opts);
    expect(result).toEqual({ qrCode: 'qr_string', qrCodeImage: 'base64_image' });
  });

  test('passes all required fields including content', async () => {
    mockGenerateVietQr.mockResolvedValueOnce({
      code: '00',
      message: 'Success',
      data: { qrCode: 'qr', qrCodeImage: 'img', qrAccount: '', referenceLabelCode: '' },
    });

    await generateQR('client_id', 'secret', opts);
    expect(mockGenerateVietQr).toHaveBeenCalledWith(
      expect.objectContaining({
        bankBin: '970422',
        accountNumber: '123456789',
        amount: 500000,
        content: 'TGABC1234',
      })
    );
  });

  test('throws on error code', async () => {
    mockGenerateVietQr.mockResolvedValueOnce({ code: '97', message: 'Bad signature', data: null });
    await expect(generateQR('client_id', 'secret', opts)).rejects.toThrow('97');
  });
});

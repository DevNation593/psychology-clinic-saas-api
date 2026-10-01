import { PrismaService } from './prisma.service';
import { runSerializableTransaction } from './serializable-transaction';

describe('runSerializableTransaction', () => {
  const prisma = { $transaction: jest.fn(), applyRlsContext: jest.fn() };
  const run = () =>
    runSerializableTransaction(
      prisma as unknown as PrismaService,
      'tenant-1',
      'user-1',
      async () => 'done',
    );
  const rawSerializationFailure = {
    code: 'P2010',
    meta: { code: '40001', message: 'could not serialize access due to concurrent update' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({}));
  });

  it('retries a transaction conflict reported by Prisma', async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(run()).resolves.toBe('done');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('retries a serialization failure raised inside a raw query', async () => {
    prisma.$transaction.mockRejectedValueOnce(rawSerializationFailure);
    await expect(run()).resolves.toBe('done');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry other raw query failures', async () => {
    const failure = { code: 'P2010', meta: { code: '23505' } };
    prisma.$transaction.mockRejectedValueOnce(failure);
    await expect(run()).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('gives up after three attempts', async () => {
    prisma.$transaction.mockRejectedValue(rawSerializationFailure);
    await expect(run()).rejects.toBe(rawSerializationFailure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { SpecialtiesService } from '../src/specialties/specialties.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Specialty selection pricing', () => {
  it('writes an absolute price from the transactional subscription snapshot', async () => {
    const subscription = {
      planType: 'CLINIC_BASIC',
      includedSpecialties: 2,
      specialtyPrice: new Decimal(15),
      featureClinicalNotes: true,
      featureAdvancedAnalytics: true,
    };
    const tx = {
      tenantSubscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
        update: jest.fn().mockResolvedValue({}),
      },
      tenantSpecialty: {
        count: jest.fn().mockResolvedValue(1),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      tenantModule: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const db: any = {
      tenantSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          ...subscription,
          planType: 'TRIAL',
          includedSpecialties: 1,
          featureAdvancedAnalytics: false,
        }),
      },
      tenantSpecialty: { count: jest.fn().mockResolvedValue(1) },
      specialty: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', code: 'A', name: 'A', modules: [] },
          { id: 'b', code: 'B', name: 'B', modules: [] },
          { id: 'c', code: 'C', name: 'C', modules: [] },
          { id: 'd', code: 'D', name: 'D', modules: [] },
        ]),
      },
      applyRlsContext: jest.fn().mockResolvedValue(undefined),
      $transaction: jest
        .fn()
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockImplementation(async (callback) => callback(tx)),
    };
    const service = new SpecialtiesService(db as PrismaService);

    await service.setForTenant('clinic-1', ['A', 'B', 'C', 'D'], 'user-1');

    expect(tx.tenantSubscription.update).toHaveBeenCalledWith({
      where: { tenantId: 'clinic-1' },
      data: { basePrice: new Decimal(139) },
    });
    expect(tx.tenantSubscription.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'clinic-1' },
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
});

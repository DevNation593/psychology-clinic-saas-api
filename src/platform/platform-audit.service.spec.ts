import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';

describe('PlatformAuditService', () => {
  it('writes an UPDATE audit row attributed to the actor on the target tenant', async () => {
    const create = jest.fn(async () => ({}));
    const service = new PlatformAuditService({ auditLog: { create } } as unknown as PrismaService);
    await service.record({
      tenantId: 'tenant-1',
      actorId: 'admin-1',
      entity: 'TENANT',
      entityId: 'tenant-1',
      reason: 'plan change',
      changes: { before: { a: 1 }, after: { a: 2 } },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        userId: 'admin-1',
        action: 'UPDATE',
        entity: 'TENANT',
        entityId: 'tenant-1',
        reason: 'plan change',
        changes: { before: { a: 1 }, after: { a: 2 } },
      },
    });
  });

  it('omits reason and changes when they are not given', async () => {
    const create = jest.fn(async () => ({}));
    const service = new PlatformAuditService({ auditLog: { create } } as unknown as PrismaService);
    await service.record({ tenantId: 't', actorId: 'a', entity: 'USER', entityId: 'u' });
    const data = (create.mock.calls[0] as any)[0].data;
    expect(data.reason).toBeUndefined();
    expect(data.changes).toBeUndefined();
    expect(data.entity).toBe('USER');
  });
});

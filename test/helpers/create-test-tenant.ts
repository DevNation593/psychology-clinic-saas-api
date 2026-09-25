import { TenantType } from '@prisma/client';
import { TenantsService } from '../../src/tenants/tenants.service';

export const TEST_PASSWORD = 'Password123!';

export async function createTestTenant(tenantsService: TenantsService, sequence: number) {
  return tenantsService.create({
    name: 'Tenant ' + sequence + ' Clinic',
    tenantType: TenantType.CLINIC,
    email: 'contact+' + sequence + '@tenant.test',
    adminFirstName: 'Admin',
    adminLastName: String(sequence),
    adminEmail: 'admin+' + sequence + '@tenant.test',
    adminPassword: TEST_PASSWORD,
  });
}

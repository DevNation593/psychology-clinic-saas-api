import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { SubscriptionService } from '../src/subscription/subscription.service';

/**
 * `docs/plan-catalog.contract.json` is the published shape of `GET /subscription/plans`.
 * The web keeps a copy and checks its public pricing page and its panel against it, so a
 * price or limit changed here must be changed there too. To update it after an intended
 * change: `npm run contract:plan-catalog`, then copy the file to
 * `web/src/features/subscription/plan-catalog.contract.json`.
 */
describe('plan catalog contract', () => {
  const contract = JSON.parse(
    readFileSync(join(__dirname, '..', 'docs', 'plan-catalog.contract.json'), 'utf8'),
  );
  const catalog = new SubscriptionService({} as PrismaService).getAvailablePlans();

  it('matches the catalog the API serves', () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(contract);
  });

  it('lists every plan once with numeric prices and limits', () => {
    expect(catalog.plans.map((plan) => plan.planType)).toEqual([
      'TRIAL',
      'PERSONAL_BASIC',
      'PERSONAL_PRO',
      'CLINIC_BASIC',
      'CLINIC_PRO',
      'CLINIC_ENTERPRISE',
    ]);
    for (const plan of catalog.plans) {
      for (const field of [
        'basePrice',
        'pricePerSeat',
        'seatsIncluded',
        'maxActivePatients',
        'storageGB',
        'monthlyNotificationsLimit',
        'includedSpecialties',
      ] as const) {
        expect(typeof plan[field]).toBe('number');
      }
    }
  });
});

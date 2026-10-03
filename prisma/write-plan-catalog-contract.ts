import { writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { SubscriptionService } from '../src/subscription/subscription.service';

// Regenerates docs/plan-catalog.contract.json from the canonical pricing code. No database needed.
const catalog = new SubscriptionService({} as PrismaService).getAvailablePlans();
const target = join(__dirname, '..', 'docs', 'plan-catalog.contract.json');
writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Wrote ${target}`);

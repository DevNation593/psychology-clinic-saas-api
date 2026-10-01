# Patient Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the billing module issue invoices to a patient (or a third-party payer stored on the patient) instead of to the clinic itself.

**Architecture:** Billing data lives in five optional columns on `Patient`; `Invoice` gains a nullable `patientId` and keeps its own snapshot of the customer. A pure resolver merges request overrides, stored billing data and patient defaults into a validated customer before anything is written or sent to Faktur. The web reuses one controlled field group for the billing form and the patient forms.

**Tech Stack:** API — NestJS, Prisma 6, PostgreSQL, class-validator, Jest. Web — Next.js 14, React 18, TanStack Query, react-hook-form + zod, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-01-patient-invoicing-design.md` (API repo)

## Global Constraints

- Two repositories, branch `feat/patient-invoicing` from `dev` in each. API tasks (1–6) run in the API worktree; web tasks (7–10) in the web worktree. API merges first.
- The migration is additive only: no column is dropped, renamed or made required; existing invoices keep `patientId` null.
- Tax ID types are exactly `CEDULA`, `RUC`, `PASSPORT`. Formats: cédula 10 digits, RUC 13 digits, passport 5–20 alphanumeric characters. No check-digit validation.
- Incomplete or invalid customer → HTTP 422, code `INVOICE_CUSTOMER_INCOMPLETE`, `details.fields` listing the offending fields from `name`, `taxIdType`, `taxId`, `email`. Nothing is created and no sequential is reserved.
- Patient missing, in another tenant or archived → 404 `Paciente no encontrado`.
- An invoice's customer snapshot never changes after creation.
- New invoices do not set `subscriptionId`.
- Issuer checks, monthly limit, sequential reservation/return and Faktur error handling stay as they are.
- User-facing copy is Spanish; identifiers and comments are English.
- No new dependencies.
- Tests are behavioural: assert on returned values, calls to collaborators and rendered output, never on source text.
- Run each verification command on its own and stop on failure; do not chain a commit or push after a check with `;`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tax ID typed with spaces or dashes** (`171 234 5678`, `1790-000000-001`): the form and the API must accept it by stripping separators, not reject a valid number. → Task 2 test, Task 8 test.
2. **Override that blanks a stored value** (`customer.taxId: ""` while the patient has one saved): an empty override means "not provided", so the stored value is used rather than failing. → Task 2 test.
3. **Double click on "Emitir factura"**: one invoice, not two. The button disables while pending and the idempotency key is generated once per form fill, not per click. → Task 8 test.
4. **Patient switched after editing the customer block**: the block must reload from the newly selected patient so one patient's payer is never invoiced under another. → Task 8 test.
5. **Clinic with hundreds of patients**: the patient selector must stay usable; it is a native select fed by the existing patient list, sorted by last name. → Task 8 test asserts ordering.

---

## File Structure

API (`api/`):

```
prisma/schema.prisma                               Patient billing columns, Invoice.patientId + customerAddress
prisma/migrations/20261001000000_add_patient_invoicing/migration.sql
src/billing/invoice-customer.ts                    tax ID rules + customer resolver (pure)
src/billing/invoice-customer.spec.ts
src/billing/dto/create-invoice.dto.ts              patientId, customer, saveCustomerToPatient
src/billing/billing.service.ts                     issue to a patient; list/get with patient
src/billing/billing.service.spec.ts
src/billing/billing.controller.ts                  patientId query filter
src/patients/patient-billing.ts                    merge + validate billing fields on a patient (pure)
src/patients/patient-billing.spec.ts
src/patients/dto/patient.dto.ts                    five billing fields
src/patients/patients.service.ts                   apply merged billing fields
test/patient-invoicing.e2e-spec.ts
test/patient-invoicing-schema.spec.ts
```

Web (`web/`):

```
src/types/index.ts                                 Patient billing fields, Invoice.patient + customer fields
src/lib/api/endpoints.ts                           patient payload fields, billingApi signatures
src/lib/validations/schemas.ts                     patientSchema billing fields
src/features/billing/billing-customer.ts           types, validation, defaults (pure)
src/features/billing/billing-customer.test.ts
src/features/billing/billing-customer-fields.tsx   controlled field group
src/features/billing/patient-invoices-tab.tsx
src/features/billing/patient-invoices-tab.test.tsx
src/features/billing/billing-page.test.tsx         rewritten for the patient flow
src/app/(dashboard)/admin/billing/page.tsx
src/app/(dashboard)/patients/new/page.tsx
src/app/(dashboard)/patients/[id]/edit/page.tsx
src/app/(dashboard)/patients/[id]/page.tsx         "Facturas" tab
src/app/(dashboard)/patients/patient-forms.test.tsx
```

---

# Part A — API

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (models `Patient`, `Invoice`)
- Create: `prisma/migrations/20261001000000_add_patient_invoicing/migration.sql`
- Test: `test/patient-invoicing-schema.spec.ts`

**Interfaces:**
- Produces: Prisma fields `Patient.billingName|billingTaxIdType|billingTaxId|billingEmail|billingAddress` (all `String?`), `Patient.invoices`, `Invoice.patientId` (`String?`), `Invoice.patient`, `Invoice.customerAddress` (`String?`).

- [ ] **Step 1: Write the failing test**

```ts
// test/patient-invoicing-schema.spec.ts
import { Prisma } from '@prisma/client';

const model = (name: string) => Prisma.dmmf.datamodel.models.find((item) => item.name === name)!;
const field = (modelName: string, fieldName: string) =>
  model(modelName).fields.find((item) => item.name === fieldName);

describe('patient invoicing data model', () => {
  it.each(['billingName', 'billingTaxIdType', 'billingTaxId', 'billingEmail', 'billingAddress'])(
    'stores optional %s on the patient',
    (name) => {
      expect(field('Patient', name)).toMatchObject({ type: 'String', isRequired: false });
    },
  );

  it('links an invoice to a patient without requiring one', () => {
    expect(field('Invoice', 'patientId')).toMatchObject({ type: 'String', isRequired: false });
    expect(field('Invoice', 'patient')).toMatchObject({ type: 'Patient', isRequired: false });
    expect(field('Invoice', 'patient')?.relationOnDelete).toBe('SetNull');
    expect(field('Invoice', 'customerAddress')).toMatchObject({ type: 'String', isRequired: false });
  });

  it('keeps every existing invoice customer column required', () => {
    for (const name of ['customerName', 'customerEmail', 'customerTaxIdType', 'customerTaxId']) {
      expect(field('Invoice', name)).toMatchObject({ isRequired: true });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest test/patient-invoicing-schema.spec.ts`
Expected: FAIL — `billingName` and `patientId` are undefined.

- [ ] **Step 3: Change the schema**

In `model Patient`, after `notes String? // General notes (not clinical)`:

```prisma
  // Billing recipient for this patient's invoices. May be the patient or a third party.
  billingName      String?
  billingTaxIdType String? // RUC, CEDULA or PASSPORT
  billingTaxId     String?
  billingEmail     String?
  billingAddress   String?
```

In the same model's relation list, after `professionalAssignments PatientProfessional[]`:

```prisma
  invoices         Invoice[]
```

In `model Invoice`, after the `issuer` relation line:

```prisma
  patientId      String?
  patient        Patient?            @relation(fields: [patientId], references: [id], onDelete: SetNull)
```

after `customerTaxId String`:

```prisma
  customerAddress String?
```

and with the other indexes:

```prisma
  @@index([tenantId, patientId, createdAt])
```

- [ ] **Step 4: Write the migration**

```sql
-- prisma/migrations/20261001000000_add_patient_invoicing/migration.sql
-- Additive only: existing patients and invoices are left untouched.

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "billingName" TEXT,
ADD COLUMN "billingTaxIdType" TEXT,
ADD COLUMN "billingTaxId" TEXT,
ADD COLUMN "billingEmail" TEXT,
ADD COLUMN "billingAddress" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "patientId" TEXT,
ADD COLUMN "customerAddress" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_tenantId_patientId_createdAt_idx" ON "Invoice"("tenantId", "patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Regenerate and verify**

Run: `npx prisma validate`
Expected: "The schema at prisma\schema.prisma is valid".

Run: `npx prisma generate`
Expected: "Generated Prisma Client".

Run: `npx jest test/patient-invoicing-schema.spec.ts`
Expected: PASS (7 tests).

Run: `npx jest test/patient-team-migration.spec.ts`
Expected: PASS — the patient-team verifier stages migrations by name and must be unaffected by a later one.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261001000000_add_patient_invoicing test/patient-invoicing-schema.spec.ts
git commit -m "feat(api): add patient billing data and invoice patient link"
```

---

### Task 2: Customer resolver

**Files:**
- Create: `src/billing/invoice-customer.ts`
- Test: `src/billing/invoice-customer.spec.ts`

**Interfaces:**
- Produces:
  - `TAX_ID_TYPES: readonly ['CEDULA', 'RUC', 'PASSPORT']`, `type TaxIdType`
  - `normalizeTaxId(value: string): string` — removes spaces and dashes, upper-cases
  - `isValidTaxId(type: string, value: string): boolean`
  - `type CustomerField = 'name' | 'taxIdType' | 'taxId' | 'email'`
  - `interface InvoiceCustomer { name: string; taxIdType: TaxIdType; taxId: string; email: string; address: string | null }`
  - `interface CustomerOverride { name?: string | null; taxIdType?: string | null; taxId?: string | null; email?: string | null; address?: string | null }`
  - `interface PatientBillingSource { firstName: string; lastName: string; email: string | null; billingName: string | null; billingTaxIdType: string | null; billingTaxId: string | null; billingEmail: string | null; billingAddress: string | null }`
  - `resolveInvoiceCustomer(patient: PatientBillingSource, override?: CustomerOverride): { customer: InvoiceCustomer; invalid: [] } | { customer: null; invalid: CustomerField[] }`

- [ ] **Step 1: Write the failing test**

```ts
// src/billing/invoice-customer.spec.ts
import {
  isValidTaxId,
  normalizeTaxId,
  PatientBillingSource,
  resolveInvoiceCustomer,
} from './invoice-customer';

const patient = (overrides: Partial<PatientBillingSource> = {}): PatientBillingSource => ({
  firstName: 'Ana',
  lastName: 'Vega',
  email: 'ana@example.com',
  billingName: null,
  billingTaxIdType: null,
  billingTaxId: null,
  billingEmail: null,
  billingAddress: null,
  ...overrides,
});
const stored = patient({
  billingName: 'Luis Vega',
  billingTaxIdType: 'CEDULA',
  billingTaxId: '1712345678',
  billingEmail: 'luis@example.com',
  billingAddress: 'Av. 1',
});

describe('tax ID rules', () => {
  it.each([
    ['CEDULA', '1712345678', true],
    ['CEDULA', '171234567', false],
    ['CEDULA', '17123456789', false],
    ['RUC', '1790000000001', true],
    ['RUC', '179000000000', false],
    ['PASSPORT', 'AB12345', true],
    ['PASSPORT', 'AB1', false],
    ['PASSPORT', 'AB-12345', false],
    ['DNI', '1712345678', false],
  ])('%s %s → %s', (type, value, expected) => {
    expect(isValidTaxId(type, value)).toBe(expected);
  });

  it('strips separators people type and upper-cases passports', () => {
    expect(normalizeTaxId(' 171 234-5678 ')).toBe('1712345678');
    expect(normalizeTaxId('1790-000000-001')).toBe('1790000000001');
    expect(normalizeTaxId('ab12345')).toBe('AB12345');
  });
});

describe('resolveInvoiceCustomer', () => {
  it('uses the billing data stored on the patient', () => {
    expect(resolveInvoiceCustomer(stored)).toEqual({
      invalid: [],
      customer: {
        name: 'Luis Vega',
        taxIdType: 'CEDULA',
        taxId: '1712345678',
        email: 'luis@example.com',
        address: 'Av. 1',
      },
    });
  });

  it('falls back to the patient for name and e-mail only', () => {
    const result = resolveInvoiceCustomer(
      patient({ billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' }),
    );
    expect(result.customer).toMatchObject({ name: 'Ana Vega', email: 'ana@example.com', address: null });
  });

  it('never assumes a tax ID', () => {
    expect(resolveInvoiceCustomer(patient())).toEqual({
      customer: null,
      invalid: ['taxIdType', 'taxId'],
    });
  });

  it('lets the request override individual fields and keeps the rest', () => {
    const result = resolveInvoiceCustomer(stored, {
      name: 'Seguros Andina S.A.',
      taxIdType: 'RUC',
      taxId: '1790-000000-001',
    });
    expect(result.customer).toEqual({
      name: 'Seguros Andina S.A.',
      taxIdType: 'RUC',
      taxId: '1790000000001',
      email: 'luis@example.com',
      address: 'Av. 1',
    });
  });

  it('treats an empty or blank override as not provided', () => {
    const result = resolveInvoiceCustomer(stored, { taxId: '', name: '   ', email: null });
    expect(result.customer).toMatchObject({
      name: 'Luis Vega',
      taxId: '1712345678',
      email: 'luis@example.com',
    });
  });

  it.each([
    ['name', { name: 'A' }, patient({ firstName: '', lastName: '', billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' })],
    ['email', { email: 'not-an-email' }, stored],
    ['taxIdType', { taxIdType: 'DNI' }, stored],
    ['taxId', { taxId: '123' }, stored],
  ])('reports an invalid %s', (fieldName, override, source) => {
    const result = resolveInvoiceCustomer(source, override);
    expect(result.customer).toBeNull();
    expect(result.invalid).toContain(fieldName);
  });

  it('reports a number that does not match an overridden type', () => {
    const result = resolveInvoiceCustomer(stored, { taxIdType: 'RUC' });
    expect(result).toEqual({ customer: null, invalid: ['taxId'] });
  });

  it('reports a missing e-mail when neither the payer nor the patient has one', () => {
    const result = resolveInvoiceCustomer(
      patient({ email: null, billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' }),
    );
    expect(result).toEqual({ customer: null, invalid: ['email'] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/billing/invoice-customer.spec.ts`
Expected: FAIL — cannot find module `./invoice-customer`.

- [ ] **Step 3: Implement**

```ts
// src/billing/invoice-customer.ts
export const TAX_ID_TYPES = ['CEDULA', 'RUC', 'PASSPORT'] as const;
export type TaxIdType = (typeof TAX_ID_TYPES)[number];
export type CustomerField = 'name' | 'taxIdType' | 'taxId' | 'email';

export interface InvoiceCustomer {
  name: string;
  taxIdType: TaxIdType;
  taxId: string;
  email: string;
  address: string | null;
}

export interface CustomerOverride {
  name?: string | null;
  taxIdType?: string | null;
  taxId?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface PatientBillingSource {
  firstName: string;
  lastName: string;
  email: string | null;
  billingName: string | null;
  billingTaxIdType: string | null;
  billingTaxId: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
}

// Format only; check digits are deliberately not verified.
const TAX_ID_PATTERNS: Record<TaxIdType, RegExp> = {
  CEDULA: /^\d{10}$/,
  RUC: /^\d{13}$/,
  PASSPORT: /^[A-Z0-9]{5,20}$/,
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeTaxId(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isTaxIdType(value: string): value is TaxIdType {
  return (TAX_ID_TYPES as readonly string[]).includes(value);
}

export function isValidTaxId(type: string, value: string): boolean {
  return isTaxIdType(type) && TAX_ID_PATTERNS[type].test(value);
}

/** First non-blank value, so an empty override never hides a stored one. */
function firstFilled(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function resolveInvoiceCustomer(
  patient: PatientBillingSource,
  override: CustomerOverride = {},
): { customer: InvoiceCustomer; invalid: [] } | { customer: null; invalid: CustomerField[] } {
  const patientName = `${patient.firstName} ${patient.lastName}`.trim();
  const name = firstFilled(override.name, patient.billingName, patientName);
  const email = firstFilled(override.email, patient.billingEmail, patient.email);
  const taxIdType = firstFilled(override.taxIdType, patient.billingTaxIdType);
  const rawTaxId = firstFilled(override.taxId, patient.billingTaxId);
  const taxId = rawTaxId ? normalizeTaxId(rawTaxId) : null;
  const address = firstFilled(override.address, patient.billingAddress);

  const invalid: CustomerField[] = [];
  if (!name || name.length < 2) invalid.push('name');
  if (!taxIdType || !isTaxIdType(taxIdType)) invalid.push('taxIdType');
  if (!taxId || (taxIdType && isTaxIdType(taxIdType) && !isValidTaxId(taxIdType, taxId))) {
    invalid.push('taxId');
  }
  if (!email || !EMAIL_PATTERN.test(email)) invalid.push('email');

  if (invalid.length > 0) return { customer: null, invalid };
  return {
    invalid: [],
    customer: { name: name!, taxIdType: taxIdType as TaxIdType, taxId: taxId!, email: email!, address },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/billing/invoice-customer.spec.ts`
Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add src/billing/invoice-customer.ts src/billing/invoice-customer.spec.ts
git commit -m "feat(api): resolve and validate the invoice customer"
```

---

### Task 3: Billing data on the patient

**Files:**
- Create: `src/patients/patient-billing.ts`
- Test: `src/patients/patient-billing.spec.ts`
- Modify: `src/patients/dto/patient.dto.ts`, `src/patients/patients.service.ts` (`sanitizeCreatePayload`, `sanitizeUpdatePayload`, `update`)

**Interfaces:**
- Consumes: `isValidTaxId`, `isTaxIdType`, `normalizeTaxId` from `../billing/invoice-customer`.
- Produces:
  - `interface PatientBillingFields { billingName: string | null; billingTaxIdType: string | null; billingTaxId: string | null; billingEmail: string | null; billingAddress: string | null }`
  - `mergePatientBilling(current: PatientBillingFields | null, changes: Partial<Record<keyof PatientBillingFields, string | null | undefined>>): PatientBillingFields` — throws `BadRequestException` on an invalid result.
  - `CreatePatientDto` / `UpdatePatientDto` accept the five fields; patient responses include them (Prisma returns every scalar).

- [ ] **Step 1: Write the failing test**

```ts
// src/patients/patient-billing.spec.ts
import { BadRequestException } from '@nestjs/common';
import { mergePatientBilling, PatientBillingFields } from './patient-billing';

const empty: PatientBillingFields = {
  billingName: null,
  billingTaxIdType: null,
  billingTaxId: null,
  billingEmail: null,
  billingAddress: null,
};
const saved: PatientBillingFields = {
  billingName: 'Luis Vega',
  billingTaxIdType: 'CEDULA',
  billingTaxId: '1712345678',
  billingEmail: 'luis@example.com',
  billingAddress: 'Av. 1',
};

describe('mergePatientBilling', () => {
  it('leaves billing data empty when nothing is provided on create', () => {
    expect(mergePatientBilling(null, {})).toEqual(empty);
  });

  it('stores a complete payer, normalizing the number', () => {
    expect(
      mergePatientBilling(null, {
        billingName: ' Seguros Andina ',
        billingTaxIdType: 'RUC',
        billingTaxId: '1790-000000-001',
        billingEmail: 'pagos@andina.test',
      }),
    ).toEqual({
      billingName: 'Seguros Andina',
      billingTaxIdType: 'RUC',
      billingTaxId: '1790000000001',
      billingEmail: 'pagos@andina.test',
      billingAddress: null,
    });
  });

  it('keeps stored values that an update does not mention', () => {
    expect(mergePatientBilling(saved, { billingEmail: 'nuevo@example.com' })).toEqual({
      ...saved,
      billingEmail: 'nuevo@example.com',
    });
  });

  it.each(['', null])('clears a field sent as %p', (value) => {
    expect(mergePatientBilling(saved, { billingAddress: value }).billingAddress).toBeNull();
  });

  it('clears the whole identification when both parts are emptied', () => {
    expect(
      mergePatientBilling(saved, { billingTaxIdType: '', billingTaxId: '' }),
    ).toMatchObject({ billingTaxIdType: null, billingTaxId: null });
  });

  it.each([
    ['a type without a number', { billingTaxIdType: 'CEDULA' }, empty],
    ['a number without a type', { billingTaxId: '1712345678' }, empty],
    ['an unknown type', { billingTaxIdType: 'DNI', billingTaxId: '1712345678' }, empty],
    ['a number in the wrong format', { billingTaxId: '123' }, saved],
    ['a type that no longer matches the stored number', { billingTaxIdType: 'RUC' }, saved],
    ['an invalid e-mail', { billingEmail: 'nope' }, saved],
    ['a one-letter name', { billingName: 'A' }, saved],
  ])('rejects %s', (_label, changes, current) => {
    expect(() => mergePatientBilling(current, changes)).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/patients/patient-billing.spec.ts`
Expected: FAIL — cannot find module `./patient-billing`.

- [ ] **Step 3: Implement the merge**

```ts
// src/patients/patient-billing.ts
import { BadRequestException } from '@nestjs/common';
import { isTaxIdType, isValidTaxId, normalizeTaxId } from '../billing/invoice-customer';

export interface PatientBillingFields {
  billingName: string | null;
  billingTaxIdType: string | null;
  billingTaxId: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
}

const FIELDS = [
  'billingName',
  'billingTaxIdType',
  'billingTaxId',
  'billingEmail',
  'billingAddress',
] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(message: string): never {
  throw new BadRequestException({ statusCode: 400, code: 'PATIENT_BILLING_INVALID', message });
}

/**
 * Applies the billing fields present in `changes` over the stored ones and validates the
 * result. `undefined` keeps the stored value; an empty string or null clears it.
 */
export function mergePatientBilling(
  current: PatientBillingFields | null,
  changes: Partial<Record<keyof PatientBillingFields, string | null | undefined>>,
): PatientBillingFields {
  const merged = {} as PatientBillingFields;
  for (const field of FIELDS) {
    const change = changes[field];
    merged[field] = change === undefined ? (current?.[field] ?? null) : change?.trim() || null;
  }
  if (merged.billingTaxId) merged.billingTaxId = normalizeTaxId(merged.billingTaxId);

  if (merged.billingName && merged.billingName.length < 2) {
    invalid('El nombre de facturación debe tener al menos 2 caracteres.');
  }
  if (merged.billingEmail && !EMAIL_PATTERN.test(merged.billingEmail)) {
    invalid('El correo de facturación no es válido.');
  }
  if (!!merged.billingTaxIdType !== !!merged.billingTaxId) {
    invalid('Indica el tipo y el número de identificación de facturación.');
  }
  if (merged.billingTaxIdType && merged.billingTaxId) {
    if (!isTaxIdType(merged.billingTaxIdType)) {
      invalid('El tipo de identificación debe ser CEDULA, RUC o PASSPORT.');
    }
    if (!isValidTaxId(merged.billingTaxIdType, merged.billingTaxId)) {
      invalid('El número de identificación no tiene el formato de su tipo.');
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/patients/patient-billing.spec.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Accept the fields in the DTO**

In `src/patients/dto/patient.dto.ts`, add to `CreatePatientDto` after `notes`:

```ts
  // Billing recipient. Format and pairing rules are enforced in the service, where the
  // stored values are known; null or an empty string clears a field.
  @ApiPropertyOptional({ example: 'Luis Pérez', nullable: true })
  @IsString()
  @IsOptional()
  billingName?: string | null;

  @ApiPropertyOptional({ example: 'CEDULA', enum: ['CEDULA', 'RUC', 'PASSPORT'], nullable: true })
  @IsString()
  @IsOptional()
  billingTaxIdType?: string | null;

  @ApiPropertyOptional({ example: '1712345678', nullable: true })
  @IsString()
  @IsOptional()
  billingTaxId?: string | null;

  @ApiPropertyOptional({ example: 'luis.perez@email.com', nullable: true })
  @IsString()
  @IsOptional()
  billingEmail?: string | null;

  @ApiPropertyOptional({ example: 'Av. Amazonas 100', nullable: true })
  @IsString()
  @IsOptional()
  billingAddress?: string | null;
```

`@IsOptional()` skips validation for `null` and `undefined`, so `null` passes through to the service.

- [ ] **Step 6: Apply the merge in the service, test first**

Append to the `describe` in `src/patients/patients.service.spec.ts` that covers `create`/`update` (read the file's existing setup and reuse its `service`, transaction mock and patient fixture; the assertions below are what must hold):

```ts
  it('stores normalized billing data when creating a patient', async () => {
    await service.create(
      tenantId,
      {
        firstName: 'Ana',
        lastName: 'Vega',
        billingTaxIdType: 'CEDULA',
        billingTaxId: '171 234 5678',
      } as never,
      'admin-1',
      'ADMIN',
    );
    expect(tx.patient.create.mock.calls[0][0].data).toMatchObject({
      billingTaxIdType: 'CEDULA',
      billingTaxId: '1712345678',
      billingName: null,
    });
  });

  it('rejects a billing type without a number before writing', async () => {
    await expect(
      service.create(
        tenantId,
        { firstName: 'Ana', lastName: 'Vega', billingTaxIdType: 'RUC' } as never,
        'admin-1',
        'ADMIN',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'PATIENT_BILLING_INVALID' } });
    expect(tx.patient.create).not.toHaveBeenCalled();
  });

  it('merges billing changes over the stored values on update', async () => {
    tx.patient.findFirst.mockResolvedValue({
      id: 'patient-1',
      tenantId,
      deletedAt: null,
      billingName: 'Luis Vega',
      billingTaxIdType: 'CEDULA',
      billingTaxId: '1712345678',
      billingEmail: 'luis@example.com',
      billingAddress: null,
    });
    await service.update(tenantId, 'patient-1', { billingAddress: 'Av. 1' } as never, 'admin-1', 'ADMIN');
    expect(tx.patient.update.mock.calls[0][0].data).toMatchObject({
      billingName: 'Luis Vega',
      billingTaxId: '1712345678',
      billingAddress: 'Av. 1',
    });
  });

  it('does not touch billing columns when an update omits them', async () => {
    await service.update(tenantId, 'patient-1', { firstName: 'Anabel' } as never, 'admin-1', 'ADMIN');
    const data = tx.patient.update.mock.calls[0][0].data;
    for (const key of ['billingName', 'billingTaxIdType', 'billingTaxId', 'billingEmail', 'billingAddress']) {
      expect(data).not.toHaveProperty(key);
    }
  });
```

If the spec names its tenant id, transaction client or actors differently, use the spec's own names; keep the assertions.

Run: `npx jest src/patients/patients.service.spec.ts`
Expected: the four new tests FAIL (billing number not normalized, no rejection, no merge).

- [ ] **Step 7: Implement in the service**

In `src/patients/patients.service.ts`:

```ts
import { mergePatientBilling, PatientBillingFields } from './patient-billing';

const BILLING_FIELDS = [
  'billingName',
  'billingTaxIdType',
  'billingTaxId',
  'billingEmail',
  'billingAddress',
] as const;
```

In `sanitizeCreatePayload`, add as the last property of the returned object:

```ts
      ...mergePatientBilling(null, createPatientDto),
```

Add a helper method:

```ts
  /** Billing columns to write on update, or nothing when the request does not mention them. */
  private billingUpdate(current: PatientBillingFields, dto: UpdatePatientDto) {
    if (!BILLING_FIELDS.some((field) => dto[field] !== undefined)) return {};
    return mergePatientBilling(current, dto);
  }
```

`sanitizeUpdatePayload` spreads the whole DTO, so raw billing values would reach Prisma unvalidated. Add this module-level helper and use it for the spread:

```ts
/** The DTO without its billing keys; those are written only through mergePatientBilling. */
function withoutBilling(dto: UpdatePatientDto): Omit<UpdatePatientDto, (typeof BILLING_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...dto };
  for (const field of BILLING_FIELDS) delete copy[field];
  return copy;
}
```

and in `sanitizeUpdatePayload` change the first line of the returned object from `...updatePatientDto,` to:

```ts
      ...withoutBilling(updatePatientDto),
```

The normalized properties that follow stay as they are.

In `update`, where `tx.patient.update` builds `data`, add after `...otherData`:

```ts
            ...this.billingUpdate(patient, updatePatientDto),
```

`patient` is the row already loaded by `tx.patient.findFirst` in that method, so it carries the stored billing values.

- [ ] **Step 8: Run the patient tests**

Run: `npx jest src/patients`
Expected: PASS, including the four new tests and every pre-existing one.

- [ ] **Step 9: Commit**

```bash
git add src/patients
git commit -m "feat(api): store billing data on patients"
```

---

### Task 4: Issue an invoice to a patient

**Files:**
- Modify: `src/billing/dto/create-invoice.dto.ts`, `src/billing/billing.service.ts` (`createInvoice`), `src/billing/billing.service.spec.ts`

**Interfaces:**
- Consumes: `resolveInvoiceCustomer`, `PatientBillingSource`, `InvoiceCustomer` (Task 2).
- Produces: `CreateInvoiceDto` with `patientId: string`, `customer?: InvoiceCustomerDto`, `saveCustomerToPatient?: boolean`; `BillingService.createInvoice(tenantId, issuerId, dto)` unchanged in signature.

- [ ] **Step 1: Extend the DTO**

```ts
// src/billing/dto/create-invoice.dto.ts — add the imports and members below
import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, ValidateNested } from 'class-validator';

export class InvoiceCustomerDto {
  @ApiPropertyOptional({ example: 'Luis Pérez' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'CEDULA', enum: ['CEDULA', 'RUC', 'PASSPORT'] })
  @IsString()
  @IsOptional()
  taxIdType?: string;

  @ApiPropertyOptional({ example: '1712345678' })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiPropertyOptional({ example: 'luis.perez@email.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'Av. Amazonas 100' })
  @IsString()
  @IsOptional()
  address?: string;
}
```

and inside `CreateInvoiceDto`, as its first members:

```ts
  @ApiProperty({ description: 'Paciente al que corresponde la factura' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiPropertyOptional({ description: 'Datos del receptor para esta factura; lo omitido sale de la ficha del paciente' })
  @ValidateNested()
  @Type(() => InvoiceCustomerDto)
  @IsOptional()
  customer?: InvoiceCustomerDto;

  @ApiPropertyOptional({ default: false, description: 'Guarda los datos del receptor en la ficha del paciente' })
  @IsBoolean()
  @IsOptional()
  saveCustomerToPatient?: boolean;
```

Customer formats are checked by the resolver, not here, so every problem is reported together as `INVOICE_CUSTOMER_INCOMPLETE`.

- [ ] **Step 2: Update the spec's fixtures and write the failing tests**

In `src/billing/billing.service.spec.ts`:

1. Add to the `prisma` mock object: `patient: { findFirst: jest.fn(), update: jest.fn() }` and `$transaction: jest.fn()`.
2. In the outer `beforeEach`, after `jest.resetAllMocks()`:

```ts
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma));
    prisma.patient.findFirst.mockResolvedValue(patientRow());
```

3. Above the first `describe`, add the fixture:

```ts
const patientRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'patient-1',
  firstName: 'Ana',
  lastName: 'Vega',
  email: 'ana@example.com',
  billingName: 'Luis Vega',
  billingTaxIdType: 'CEDULA',
  billingTaxId: '1712345678',
  billingEmail: 'luis@example.com',
  billingAddress: 'Av. 1',
  ...overrides,
});
```

4. Add `patientId: 'patient-1'` to every existing `createInvoice` argument in the file (the two inline `{ subtotal: 20, description: 'Consulta' }` objects and the `dto` constant in `describe('issuing')`).

5. Append inside `describe('issuing', …)`:

```ts
    describe('to a patient', () => {
      it('issues to the payer stored on the patient and links the invoice', async () => {
        await service.createInvoice('tenant-1', 'issuer-1', dto);

        expect(prisma.patient.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'patient-1', tenantId: 'tenant-1', deletedAt: null } }),
        );
        expect(prisma.invoice.create.mock.calls[0][0].data).toMatchObject({
          patientId: 'patient-1',
          customerName: 'Luis Vega',
          customerEmail: 'luis@example.com',
          customerTaxIdType: 'CEDULA',
          customerTaxId: '1712345678',
          customerAddress: 'Av. 1',
        });
        expect(prisma.invoice.create.mock.calls[0][0].data).not.toHaveProperty('subscriptionId');
        expect(faktur.issueInvoice.mock.calls[0][0].customer).toEqual({
          legalName: 'Luis Vega',
          email: 'luis@example.com',
          identificationType: 'CEDULA',
          identificationNumber: '1712345678',
          address: 'Av. 1',
        });
      });

      it('issues to a third party given in the request without changing the patient', async () => {
        await service.createInvoice('tenant-1', 'issuer-1', {
          ...dto,
          customer: { name: 'Seguros Andina S.A.', taxIdType: 'RUC', taxId: '1790000000001' },
        });

        expect(prisma.invoice.create.mock.calls[0][0].data).toMatchObject({
          patientId: 'patient-1',
          customerName: 'Seguros Andina S.A.',
          customerTaxIdType: 'RUC',
          customerTaxId: '1790000000001',
          customerEmail: 'luis@example.com',
        });
        expect(prisma.patient.update).not.toHaveBeenCalled();
      });

      it('saves the resolved payer on the patient when asked', async () => {
        prisma.patient.findFirst.mockResolvedValue(
          patientRow({ billingName: null, billingTaxIdType: null, billingTaxId: null, billingEmail: null, billingAddress: null }),
        );
        await service.createInvoice('tenant-1', 'issuer-1', {
          ...dto,
          customer: { taxIdType: 'CEDULA', taxId: '171 234 5678' },
          saveCustomerToPatient: true,
        });

        expect(prisma.patient.update).toHaveBeenCalledWith({
          where: { id: 'patient-1' },
          data: {
            billingName: 'Ana Vega',
            billingTaxIdType: 'CEDULA',
            billingTaxId: '1712345678',
            billingEmail: 'ana@example.com',
            billingAddress: null,
          },
        });
      });

      it('keeps the saved payer when the provider then fails', async () => {
        faktur.issueInvoice.mockRejectedValue(new Error('Faktur no disponible'));
        await expect(
          service.createInvoice('tenant-1', 'issuer-1', { ...dto, saveCustomerToPatient: true }),
        ).rejects.toThrow('Faktur no disponible');

        expect(prisma.patient.update).toHaveBeenCalledTimes(1);
        expect(prisma.invoice.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED' });
      });

      it('answers 404 for a patient that is missing, archived or in another clinic', async () => {
        prisma.patient.findFirst.mockResolvedValue(null);
        await expect(service.createInvoice('tenant-1', 'issuer-1', dto)).rejects.toMatchObject({
          status: 404,
          message: 'Paciente no encontrado',
        });
        expect(prisma.invoice.create).not.toHaveBeenCalled();
        expect(faktur.issueInvoice).not.toHaveBeenCalled();
      });

      it('rejects an incomplete payer before creating the invoice or reserving a sequential', async () => {
        prisma.patient.findFirst.mockResolvedValue(
          patientRow({ billingTaxIdType: null, billingTaxId: null }),
        );
        await expect(service.createInvoice('tenant-1', 'issuer-1', dto)).rejects.toMatchObject({
          status: 422,
          response: { code: 'INVOICE_CUSTOMER_INCOMPLETE', details: { fields: ['taxIdType', 'taxId'] } },
        });
        expect(prisma.invoice.create).not.toHaveBeenCalled();
        expect(prisma.billingSettings.update).not.toHaveBeenCalled();
        expect(faktur.issueInvoice).not.toHaveBeenCalled();
      });

      it('returns an existing invoice for a repeated key without re-reading or saving the patient', async () => {
        prisma.invoice.findFirst.mockResolvedValue({ id: 'existing' });
        await expect(
          service.createInvoice('tenant-1', 'issuer-1', { ...dto, saveCustomerToPatient: true }),
        ).resolves.toEqual({ id: 'existing' });
        expect(prisma.patient.findFirst).not.toHaveBeenCalled();
        expect(prisma.patient.update).not.toHaveBeenCalled();
      });
    });
```

The patient lookup scopes by `tenantId` and `deletedAt: null`, so a patient in another clinic or an archived one is the same `null` row as a missing one; the `where` assertion in the first test pins that scoping.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest src/billing/billing.service.spec.ts`
Expected: the seven new tests FAIL (customer still taken from the tenant; no patient lookup).

- [ ] **Step 4: Implement**

In `src/billing/billing.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { resolveInvoiceCustomer } from './invoice-customer';
```

Replace the block from `const invoice = await this.prisma.invoice.create({` through its closing `});` with:

```ts
    // Resolved only after the idempotency check, so a repeated request is answered
    // from the stored invoice without touching the patient again.
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, tenantId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        billingName: true,
        billingTaxIdType: true,
        billingTaxId: true,
        billingEmail: true,
        billingAddress: true,
      },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }
    const resolved = resolveInvoiceCustomer(patient, dto.customer);
    if (!resolved.customer) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: 'INVOICE_CUSTOMER_INCOMPLETE',
        message: 'Completa los datos del receptor de la factura.',
        details: { fields: resolved.invalid },
      });
    }
    const customer = resolved.customer;

    const invoice = await this.prisma.$transaction(async (tx) => {
      if (dto.saveCustomerToPatient) {
        await tx.patient.update({
          where: { id: patient.id },
          data: {
            billingName: customer.name,
            billingTaxIdType: customer.taxIdType,
            billingTaxId: customer.taxId,
            billingEmail: customer.email,
            billingAddress: customer.address,
          },
        });
      }
      return tx.invoice.create({
        data: {
          tenantId,
          patientId: patient.id,
          issuerId,
          status: InvoiceStatus.PENDING,
          subtotal: new Prisma.Decimal(dto.subtotal),
          tax: new Prisma.Decimal(tax),
          total: new Prisma.Decimal(total),
          // Snapshot: later edits to the patient must not change an issued document.
          customerName: customer.name,
          customerEmail: customer.email,
          customerTaxIdType: customer.taxIdType,
          customerTaxId: customer.taxId,
          customerAddress: customer.address,
          description: dto.description,
          idempotencyKey,
        },
      });
    });
```

In the `this.fakturClient.issueInvoice({ … customer: { … } })` call, change the address line from `address: tenant.address || undefined,` to:

```ts
            address: invoice.customerAddress || undefined,
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx jest src/billing`
Expected: PASS — the new tests and every pre-existing billing test.

- [ ] **Step 6: Commit**

```bash
git add src/billing
git commit -m "feat(api): issue invoices to a patient or their payer"
```

---

### Task 5: Read invoices with their patient

**Files:**
- Modify: `src/billing/billing.service.ts` (`listInvoices`, `getInvoice`), `src/billing/billing.controller.ts`, `src/billing/billing.service.spec.ts`

**Interfaces:**
- Produces: `listInvoices(tenantId: string, filters?: { patientId?: string })`; both read methods include `patient: { id, firstName, lastName } | null`.

- [ ] **Step 1: Write the failing tests**

Add `findMany: jest.fn()` to the `invoice` mock in the spec and append a top-level `describe`:

```ts
  describe('reading', () => {
    const patientSelect = { select: { id: true, firstName: true, lastName: true } };

    it('lists the clinic invoices with their patient', async () => {
      prisma.invoice.findMany.mockResolvedValue([{ id: 'invoice-1', patient: null }]);
      await expect(service.listInvoices('tenant-1')).resolves.toEqual([{ id: 'invoice-1', patient: null }]);

      const query = prisma.invoice.findMany.mock.calls[0][0];
      expect(query.where).toEqual({ tenantId: 'tenant-1' });
      expect(query.include.patient).toEqual(patientSelect);
    });

    it('filters by patient inside the clinic', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      await service.listInvoices('tenant-1', { patientId: 'patient-1' });
      expect(prisma.invoice.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 'tenant-1',
        patientId: 'patient-1',
      });
    });

    it('ignores a blank patient filter', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      await service.listInvoices('tenant-1', { patientId: '  ' });
      expect(prisma.invoice.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-1' });
    });

    it('returns one invoice with its patient', async () => {
      prisma.invoice.findFirst.mockResolvedValue({ id: 'invoice-1' });
      await service.getInvoice('tenant-1', 'invoice-1');
      expect(prisma.invoice.findFirst.mock.calls[0][0].include.patient).toEqual(patientSelect);
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/billing/billing.service.spec.ts -t reading`
Expected: FAIL — no `patient` in `include`, no filter.

- [ ] **Step 3: Implement**

```ts
// src/billing/billing.service.ts
const invoiceInclude = {
  issuer: { select: { id: true, firstName: true, lastName: true, role: true } },
  patient: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InvoiceInclude;
```

```ts
  listInvoices(tenantId: string, filters: { patientId?: string } = {}) {
    const patientId = filters.patientId?.trim();
    return this.prisma.invoice.findMany({
      where: { tenantId, ...(patientId && { patientId }) },
      include: invoiceInclude,
      orderBy: { createdAt: 'desc' },
    });
  }
```

In `getInvoice`, replace its `include` with `include: invoiceInclude`.

```ts
// src/billing/billing.controller.ts — add Query to the @nestjs/common import and ApiQuery to @nestjs/swagger
  @Get('invoices')
  @Roles('CLIENTE', 'PSICOLOGO')
  @ApiOperation({ summary: 'Listar facturas del tenant' })
  @ApiQuery({ name: 'patientId', required: false })
  listInvoices(@Param('tenantId') tenantId: string, @Query('patientId') patientId?: string) {
    return this.billingService.listInvoices(tenantId, { patientId });
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/billing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/billing
git commit -m "feat(api): return and filter invoices by patient"
```

---

### Task 6: End-to-end coverage and API verification

**Files:**
- Create: `test/patient-invoicing.e2e-spec.ts`

**Interfaces:**
- Consumes: every earlier API task; `createTestTenant`, `TEST_PASSWORD` from `test/helpers/create-test-tenant`.

- [ ] **Step 1: Write the E2E suite**

```ts
// test/patient-invoicing.e2e-spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FakturClient } from '../src/billing/faktur.client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { createTestTenant, TEST_PASSWORD } from './helpers/create-test-tenant';

jest.setTimeout(30000);

describe('Patient invoicing (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const faktur = { issueInvoice: jest.fn() };
  let tenantId: string;
  let otherTenantId: string;
  let token: string;
  let otherToken: string;

  const auth = (value: string) => ({ Authorization: `Bearer ${value}` });
  const server = () => app.getHttpServer();

  async function login(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return response.body.accessToken;
  }

  async function createPatient(body: Record<string, unknown>, tenant = tenantId, bearer = token) {
    const response = await request(server())
      .post(`/api/v1/tenants/${tenant}/patients`)
      .set(auth(bearer))
      .send({ firstName: 'Ana', lastName: 'Vega', email: 'ana@patient.test', ...body })
      .expect(201);
    return response.body as { id: string } & Record<string, unknown>;
  }

  const issue = (body: Record<string, unknown>, tenant = tenantId, bearer = token) =>
    request(server())
      .post(`/api/v1/tenants/${tenant}/billing/invoices`)
      .set(auth(bearer))
      .send({ subtotal: 100, tax: 15, description: 'Consulta', ...body });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FakturClient)
      .useValue(faktur)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.cleanDatabase();

    const tenantsService = app.get(TenantsService);
    tenantId = (await createTestTenant(tenantsService, 1)).id;
    otherTenantId = (await createTestTenant(tenantsService, 2)).id;
    // The clinic is the issuer and needs its own fiscal data to invoice.
    await prisma.tenant.updateMany({
      where: { id: { in: [tenantId, otherTenantId] } },
      data: { taxIdentificationType: 'RUC', taxIdentificationNumber: '1790000000001' },
    });
    token = await login('admin+1@tenant.test');
    otherToken = await login('admin+2@tenant.test');
  });

  beforeEach(() => {
    faktur.issueInvoice.mockReset();
    faktur.issueInvoice.mockResolvedValue({ externalId: 'ext-1', pdfUrl: 'https://files.test/a.pdf' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues to the payer stored on the patient and lists it under that patient', async () => {
    const patient = await createPatient({
      billingName: 'Luis Vega',
      billingTaxIdType: 'CEDULA',
      billingTaxId: '171 234 5678',
      billingEmail: 'luis@payer.test',
    });
    expect(patient.billingTaxId).toBe('1712345678');

    const created = await issue({ patientId: patient.id, idempotencyKey: 'stored-1' }).expect(201);
    expect(created.body).toMatchObject({
      status: 'ISSUED',
      patientId: patient.id,
      customerName: 'Luis Vega',
      customerTaxIdType: 'CEDULA',
      customerTaxId: '1712345678',
      customerEmail: 'luis@payer.test',
    });
    expect(faktur.issueInvoice.mock.calls[0][0].customer).toMatchObject({
      legalName: 'Luis Vega',
      identificationNumber: '1712345678',
    });

    const list = await request(server())
      .get(`/api/v1/tenants/${tenantId}/billing/invoices`)
      .query({ patientId: patient.id })
      .set(auth(token))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].patient).toEqual({ id: patient.id, firstName: 'Ana', lastName: 'Vega' });
  });

  it('issues to a third party and saves it on the patient when asked', async () => {
    const patient = await createPatient({ firstName: 'Niño', lastName: 'Mora', email: null });

    await issue({
      patientId: patient.id,
      idempotencyKey: 'third-1',
      customer: {
        name: 'Rosa Mora',
        taxIdType: 'CEDULA',
        taxId: '0912345678',
        email: 'rosa@payer.test',
        address: 'Calle 2',
      },
      saveCustomerToPatient: true,
    }).expect(201);

    const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(stored).toMatchObject({
      billingName: 'Rosa Mora',
      billingTaxIdType: 'CEDULA',
      billingTaxId: '0912345678',
      billingEmail: 'rosa@payer.test',
      billingAddress: 'Calle 2',
    });
  });

  it('keeps an issued invoice unchanged when the patient billing data is edited later', async () => {
    const patient = await createPatient({
      billingName: 'Primer Pagador',
      billingTaxIdType: 'CEDULA',
      billingTaxId: '1712345678',
    });
    const created = await issue({ patientId: patient.id, idempotencyKey: 'snapshot-1' }).expect(201);

    await request(server())
      .patch(`/api/v1/tenants/${tenantId}/patients/${patient.id}`)
      .set(auth(token))
      .send({ billingName: 'Segundo Pagador' })
      .expect(200);

    const invoice = await request(server())
      .get(`/api/v1/tenants/${tenantId}/billing/invoices/${created.body.id}`)
      .set(auth(token))
      .expect(200);
    expect(invoice.body.customerName).toBe('Primer Pagador');
  });

  it('rejects an incomplete payer without creating an invoice or calling the provider', async () => {
    const patient = await createPatient({ firstName: 'Sin', lastName: 'Datos' });
    const before = await prisma.invoice.count({ where: { tenantId } });

    const response = await issue({ patientId: patient.id }).expect(422);
    expect(response.body.code).toBe('INVOICE_CUSTOMER_INCOMPLETE');
    expect(response.body.details.fields).toEqual(['taxIdType', 'taxId']);
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(before);
    expect(faktur.issueInvoice).not.toHaveBeenCalled();
  });

  it('requires a patient and hides patients of another clinic or archived ones', async () => {
    await issue({}).expect(400);

    const foreign = await createPatient(
      { billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' },
      otherTenantId,
      otherToken,
    );
    await issue({ patientId: foreign.id }).expect(404);

    const archived = await createPatient({ billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' });
    await request(server())
      .delete(`/api/v1/tenants/${tenantId}/patients/${archived.id}`)
      .set(auth(token))
      .expect(200);
    await issue({ patientId: archived.id }).expect(404);
    expect(faktur.issueInvoice).not.toHaveBeenCalled();
  });

  it('does not list another clinic invoices', async () => {
    const list = await request(server())
      .get(`/api/v1/tenants/${otherTenantId}/billing/invoices`)
      .set(auth(otherToken))
      .expect(200);
    expect(list.body).toEqual([]);
    await request(server())
      .get(`/api/v1/tenants/${tenantId}/billing/invoices`)
      .set(auth(otherToken))
      .expect(403);
  });

  it('rejects a billing type without a number on the patient', async () => {
    const response = await request(server())
      .post(`/api/v1/tenants/${tenantId}/patients`)
      .set(auth(token))
      .send({ firstName: 'Tipo', lastName: 'Solo', billingTaxIdType: 'RUC' })
      .expect(400);
    expect(response.body.code).toBe('PATIENT_BILLING_INVALID');
  });
});
```

This suite needs the disposable database and therefore runs only in CI. If the patient delete endpoint returns a status other than 200, or the patient create DTO rejects `email: null`, adjust that single line to the API's real behaviour and record why; do not relax an assertion about invoicing.

- [ ] **Step 2: Run the local API matrix**

Run each on its own:

```bash
npx prisma validate
npm run build
npm run lint
npx jest --runInBand
```

Expected: valid schema, build succeeds, lint reports 0 errors, every unit suite passes (the E2E file is not matched by the unit config).

- [ ] **Step 3: Commit**

```bash
git add test/patient-invoicing.e2e-spec.ts
git commit -m "test(api): cover patient invoicing end to end"
```

- [ ] **Step 4: Hand off**

Push and open the API pull request toward `dev` only when the human partner asks. CI runs the E2E suite against the disposable database; a failure there is fixed on this branch before the web part merges.

---

# Part B — Web

### Task 7: Types, API client and billing customer rules

**Files:**
- Modify: `src/types/index.ts` (`Patient`, `Invoice`, patient input type), `src/lib/api/endpoints.ts` (`patientFields`, `billingApi`)
- Create: `src/features/billing/billing-customer.ts`
- Test: `src/features/billing/billing-customer.test.ts`

**Interfaces:**
- Produces:
  - `Patient` gains `billingName | billingTaxIdType | billingTaxId | billingEmail | billingAddress` (`string | null`).
  - `Invoice` gains `patientId: string | null`, `patient: { id: string; firstName: string; lastName: string } | null`, `customerEmail: string`, `customerTaxIdType: string`, `customerTaxId: string`, `customerAddress: string | null`.
  - `billingApi.listInvoices(params?: { patientId?: string })`, `billingApi.createInvoice(data: CreateInvoiceInput)` with `CreateInvoiceInput = { patientId: string; subtotal: number; tax?: number; description: string; idempotencyKey?: string; customer?: Partial<Record<'name' | 'taxIdType' | 'taxId' | 'email' | 'address', string>>; saveCustomerToPatient?: boolean }`.
  - From `billing-customer.ts`: `TAX_ID_TYPES`, `type TaxIdType`, `TAX_ID_TYPE_LABELS`, `interface BillingCustomer { name: string; taxIdType: TaxIdType | ''; taxId: string; email: string; address: string }`, `EMPTY_BILLING_CUSTOMER`, `normalizeTaxId(value)`, `customerFromPatient(patient)`, `hasSavedTaxId(patient)`, `invoiceCustomerErrors(customer)`, `patientBillingErrors(customer)`, `type BillingCustomerErrors = Partial<Record<keyof BillingCustomer, string>>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/billing/billing-customer.test.ts
import { describe, expect, it } from 'vitest';
import {
  customerFromPatient, hasSavedTaxId, invoiceCustomerErrors, normalizeTaxId, patientBillingErrors,
  type BillingCustomer,
} from './billing-customer';

const patient = {
  firstName: 'Ana', lastName: 'Vega', email: 'ana@example.com', address: 'Centro',
  billingName: null, billingTaxIdType: null, billingTaxId: null, billingEmail: null, billingAddress: null,
};
const complete: BillingCustomer = {
  name: 'Luis Vega', taxIdType: 'CEDULA', taxId: '1712345678', email: 'luis@example.com', address: '',
};

describe('customerFromPatient', () => {
  it('starts from the patient name and e-mail when no payer is stored', () => {
    expect(customerFromPatient(patient)).toEqual({
      name: 'Ana Vega', taxIdType: '', taxId: '', email: 'ana@example.com', address: '',
    });
    expect(hasSavedTaxId(patient)).toBe(false);
  });

  it('uses the stored payer when there is one', () => {
    const stored = {
      ...patient, billingName: 'Luis Vega', billingTaxIdType: 'CEDULA', billingTaxId: '1712345678',
      billingEmail: 'luis@example.com', billingAddress: 'Av. 1',
    };
    expect(customerFromPatient(stored)).toEqual({
      name: 'Luis Vega', taxIdType: 'CEDULA', taxId: '1712345678', email: 'luis@example.com', address: 'Av. 1',
    });
    expect(hasSavedTaxId(stored)).toBe(true);
  });

  it('ignores a stored type the form does not know', () => {
    expect(customerFromPatient({ ...patient, billingTaxIdType: 'DNI', billingTaxId: '1' }).taxIdType).toBe('');
  });
});

describe('normalizeTaxId', () => {
  it('removes the separators people type', () => {
    expect(normalizeTaxId(' 171 234-5678 ')).toBe('1712345678');
    expect(normalizeTaxId('ab12345')).toBe('AB12345');
  });
});

describe('invoiceCustomerErrors', () => {
  it('accepts a complete payer, including a number typed with separators', () => {
    expect(invoiceCustomerErrors(complete)).toEqual({});
    expect(invoiceCustomerErrors({ ...complete, taxId: '171 234 5678' })).toEqual({});
    expect(invoiceCustomerErrors({ ...complete, taxIdType: 'RUC', taxId: '1790-000000-001' })).toEqual({});
  });

  it.each([
    ['name', { name: 'A' }],
    ['taxIdType', { taxIdType: '' as const }],
    ['taxId', { taxId: '123' }],
    ['taxId', { taxIdType: 'RUC' as const }],
    ['email', { email: 'nope' }],
    ['email', { email: '' }],
  ])('requires a valid %s', (field, change) => {
    expect(Object.keys(invoiceCustomerErrors({ ...complete, ...change }))).toContain(field);
  });
});

describe('patientBillingErrors', () => {
  const empty: BillingCustomer = { name: '', taxIdType: '', taxId: '', email: '', address: '' };

  it('allows a patient with no billing data at all', () => {
    expect(patientBillingErrors(empty)).toEqual({});
  });

  it('allows a name and e-mail without an identification', () => {
    expect(patientBillingErrors({ ...empty, name: 'Luis Vega', email: 'luis@example.com' })).toEqual({});
  });

  it.each([
    ['taxId', { taxIdType: 'CEDULA' as const }],
    ['taxIdType', { taxId: '1712345678' }],
    ['taxId', { taxIdType: 'CEDULA' as const, taxId: '12' }],
    ['email', { email: 'nope' }],
    ['name', { name: 'A' }],
  ])('flags %s when what was entered is inconsistent', (field, change) => {
    expect(Object.keys(patientBillingErrors({ ...empty, ...change }))).toContain(field);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/billing/billing-customer.test.ts`
Expected: FAIL — cannot resolve `./billing-customer`.

- [ ] **Step 3: Implement the rules**

```ts
// src/features/billing/billing-customer.ts
export const TAX_ID_TYPES = ['CEDULA', 'RUC', 'PASSPORT'] as const;
export type TaxIdType = (typeof TAX_ID_TYPES)[number];

export const TAX_ID_TYPE_LABELS: Record<TaxIdType, string> = {
  CEDULA: 'Cédula',
  RUC: 'RUC',
  PASSPORT: 'Pasaporte',
};

export interface BillingCustomer {
  name: string;
  taxIdType: TaxIdType | '';
  taxId: string;
  email: string;
  address: string;
}
export type BillingCustomerErrors = Partial<Record<keyof BillingCustomer, string>>;

export const EMPTY_BILLING_CUSTOMER: BillingCustomer = {
  name: '', taxIdType: '', taxId: '', email: '', address: '',
};

interface PatientBillingSource {
  firstName: string;
  lastName: string;
  email: string | null;
  billingName: string | null;
  billingTaxIdType: string | null;
  billingTaxId: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
}

// Mirrors the API rules: format only, no check digit.
const TAX_ID_PATTERNS: Record<TaxIdType, RegExp> = {
  CEDULA: /^\d{10}$/,
  RUC: /^\d{13}$/,
  PASSPORT: /^[A-Z0-9]{5,20}$/,
};
const TAX_ID_HINTS: Record<TaxIdType, string> = {
  CEDULA: 'La cédula tiene 10 dígitos.',
  RUC: 'El RUC tiene 13 dígitos.',
  PASSPORT: 'El pasaporte tiene de 5 a 20 letras o números.',
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeTaxId(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

function isTaxIdType(value: string | null): value is TaxIdType {
  return !!value && (TAX_ID_TYPES as readonly string[]).includes(value);
}

export function hasSavedTaxId(patient: PatientBillingSource): boolean {
  return isTaxIdType(patient.billingTaxIdType) && !!patient.billingTaxId;
}

/** The payer to show for a patient: what is stored, else the patient's own name and e-mail. */
export function customerFromPatient(patient: PatientBillingSource): BillingCustomer {
  return {
    name: patient.billingName || `${patient.firstName} ${patient.lastName}`.trim(),
    taxIdType: isTaxIdType(patient.billingTaxIdType) ? patient.billingTaxIdType : '',
    taxId: patient.billingTaxId ?? '',
    email: patient.billingEmail || patient.email || '',
    address: patient.billingAddress ?? '',
  };
}

function formatErrors(customer: BillingCustomer): BillingCustomerErrors {
  const errors: BillingCustomerErrors = {};
  const name = customer.name.trim();
  const email = customer.email.trim();
  const taxId = normalizeTaxId(customer.taxId);
  if (name && name.length < 2) errors.name = 'Escribe el nombre o la razón social.';
  if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Correo inválido.';
  if (customer.taxIdType && taxId && !TAX_ID_PATTERNS[customer.taxIdType].test(taxId)) {
    errors.taxId = TAX_ID_HINTS[customer.taxIdType];
  }
  return errors;
}

/** Everything an invoice needs; used before issuing. */
export function invoiceCustomerErrors(customer: BillingCustomer): BillingCustomerErrors {
  const errors = formatErrors(customer);
  if (!customer.name.trim()) errors.name = 'Escribe el nombre o la razón social.';
  if (!customer.taxIdType) errors.taxIdType = 'Selecciona el tipo de identificación.';
  if (!normalizeTaxId(customer.taxId)) errors.taxId = 'Escribe el número de identificación.';
  if (!customer.email.trim()) errors.email = 'Escribe el correo del receptor.';
  return errors;
}

/** Billing data on a patient is optional, but what is entered must be consistent. */
export function patientBillingErrors(customer: BillingCustomer): BillingCustomerErrors {
  const errors = formatErrors(customer);
  const taxId = normalizeTaxId(customer.taxId);
  if (customer.taxIdType && !taxId) errors.taxId = 'Escribe el número de identificación.';
  if (!customer.taxIdType && taxId) errors.taxIdType = 'Selecciona el tipo de identificación.';
  return errors;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/features/billing/billing-customer.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Extend the types and the API client**

In `src/types/index.ts`, add to `interface Patient` after `notes: string | null;`:

```ts
  billingName: string | null;
  billingTaxIdType: string | null;
  billingTaxId: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
```

Add to `interface Invoice` after `customerName: string;`:

```ts
  customerEmail: string;
  customerTaxIdType: string;
  customerTaxId: string;
  customerAddress?: string | null;
  patientId?: string | null;
  patient?: { id: string; firstName: string; lastName: string } | null;
```

Find the patient input type used by `patientsApi` (`PatientInput`) and add the five billing fields as `string | null | undefined` (optional members typed `string | null`).

In `src/lib/api/endpoints.ts`, extend the whitelist:

```ts
const patientFields = [
  'firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'gender', 'address',
  'emergencyContactName', 'emergencyContactPhone', 'notes',
  'billingName', 'billingTaxIdType', 'billingTaxId', 'billingEmail', 'billingAddress',
] as const;
```

and replace `billingApi`:

```ts
export interface CreateInvoiceInput {
  patientId: string;
  subtotal: number;
  tax?: number;
  description: string;
  idempotencyKey?: string;
  customer?: Partial<Record<'name' | 'taxIdType' | 'taxId' | 'email' | 'address', string>>;
  saveCustomerToPatient?: boolean;
}

export const billingApi = {
  listInvoices: (params?: { patientId?: string }) =>
    apiClient.get<Invoice[]>(
      API_ENDPOINTS.BILLING_INVOICES(getTenantId()),
      params?.patientId ? { params: { patientId: params.patientId } } : undefined,
    ),
  createInvoice: (data: CreateInvoiceInput) =>
    apiClient.post<Invoice>(API_ENDPOINTS.BILLING_INVOICES(getTenantId()), data),
};
```

`useQuery({ queryFn: billingApi.listInvoices })` passes the query context as the first argument; change that call site in the billing page to `queryFn: () => billingApi.listInvoices()` (done in Task 8).

- [ ] **Step 6: Type-check and commit**

Run: `npm run type-check`
Expected: errors only where test fixtures build a `Patient` without the new fields, if any; add the five `null` fields to those fixtures. No other errors.

```bash
git add src/types/index.ts src/lib/api/endpoints.ts src/features/billing/billing-customer.ts src/features/billing/billing-customer.test.ts
git commit -m "feat(web): add patient billing data contracts and payer rules"
```

---

### Task 8: Billing page issues to a patient

**Files:**
- Create: `src/features/billing/billing-customer-fields.tsx`
- Modify: `src/app/(dashboard)/admin/billing/page.tsx`, `src/features/billing/billing-page.test.tsx`

**Interfaces:**
- Consumes: Task 7 exports; `usePatients()` from `@/hooks/usePatients` (returns `{ data: Patient[] | undefined, isLoading, isError }`); `QUERY_KEYS`.
- Produces: `<BillingCustomerFields value={BillingCustomer} onChange={(next: BillingCustomer) => void} errors={BillingCustomerErrors} idPrefix={string} disabled?={boolean} />`.

- [ ] **Step 1: Write the field group**

```tsx
// src/features/billing/billing-customer-fields.tsx
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TAX_ID_TYPES, TAX_ID_TYPE_LABELS,
  type BillingCustomer, type BillingCustomerErrors, type TaxIdType,
} from './billing-customer';

interface Props {
  value: BillingCustomer;
  onChange: (next: BillingCustomer) => void;
  errors?: BillingCustomerErrors;
  /** Keeps ids unique when the group appears in more than one form. */
  idPrefix: string;
  disabled?: boolean;
}

export function BillingCustomerFields({ value, onChange, errors = {}, idPrefix, disabled }: Props) {
  const set = <K extends keyof BillingCustomer>(key: K, next: BillingCustomer[K]) =>
    onChange({ ...value, [key]: next });
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor={id('name')}>Nombre o razón social</Label>
        <Input id={id('name')} value={value.name} disabled={disabled} error={errors.name}
          onChange={(event) => set('name', event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id('taxIdType')}>Tipo de identificación</Label>
        <select
          id={id('taxIdType')}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value.taxIdType}
          disabled={disabled}
          onChange={(event) => set('taxIdType', event.target.value as TaxIdType | '')}
        >
          <option value="">Seleccionar</option>
          {TAX_ID_TYPES.map((type) => <option key={type} value={type}>{TAX_ID_TYPE_LABELS[type]}</option>)}
        </select>
        {errors.taxIdType && <p role="alert" className="text-sm text-destructive">{errors.taxIdType}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor={id('taxId')}>Número de identificación</Label>
        <Input id={id('taxId')} value={value.taxId} disabled={disabled} error={errors.taxId} inputMode="text"
          onChange={(event) => set('taxId', event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id('email')}>Correo del receptor</Label>
        <Input id={id('email')} type="email" value={value.email} disabled={disabled} error={errors.email}
          onChange={(event) => set('email', event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id('address')}>Dirección</Label>
        <Input id={id('address')} value={value.address} disabled={disabled}
          onChange={(event) => set('address', event.target.value)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the page tests for the patient flow**

Replace the contents of `src/features/billing/billing-page.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import BillingPage from '@/app/(dashboard)/admin/billing/page';
import { useAuthStore } from '@/store/authStore';
import { UserRole, type Invoice, type Patient, type User } from '@/types';

const api = vi.hoisted(() => ({ listInvoices: vi.fn(), createInvoice: vi.fn() }));
const patients = vi.hoisted(() => ({ data: [] as unknown[], isLoading: false, isError: false }));
vi.mock('@/lib/api/endpoints', () => ({
  billingApi: { listInvoices: api.listInvoices, createInvoice: api.createInvoice },
}));
vi.mock('@/hooks/usePatients', () => ({ usePatients: () => patients }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const patient = (overrides: Partial<Patient>): Patient => ({
  id: 'patient-1', tenantId: 'tenant-1', firstName: 'Ana', lastName: 'Vega', email: 'ana@example.com',
  billingName: null, billingTaxIdType: null, billingTaxId: null, billingEmail: null, billingAddress: null,
  ...overrides,
} as Patient);
const withPayer = patient({
  id: 'patient-2', firstName: 'Niño', lastName: 'Mora', email: null,
  billingName: 'Rosa Mora', billingTaxIdType: 'CEDULA', billingTaxId: '0912345678',
  billingEmail: 'rosa@payer.test', billingAddress: 'Calle 2',
});
const withoutPayer = patient({});

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: 'invoice-1', status: 'ISSUED', issueDate: '2026-10-01T15:00:00.000Z',
    customerName: 'Rosa Mora', customerEmail: 'rosa@payer.test', customerTaxIdType: 'CEDULA',
    customerTaxId: '0912345678', description: 'Consulta', subtotal: 100, tax: 15, total: 115,
    patient: { id: 'patient-2', firstName: 'Niño', lastName: 'Mora' },
    ...overrides,
  };
}

function renderPage(role: UserRole = UserRole.ADMIN) {
  useAuthStore.setState({ user: { id: 'user-1', role, tenantId: 'tenant-1' } as User });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><BillingPage /></QueryClientProvider>);
}

const choosePatient = (id: string) =>
  fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: id } });
function fillAmounts(subtotal = '100', taxRate = '15', description = 'Consulta general') {
  fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: description } });
  fireEvent.change(screen.getByLabelText('Subtotal (USD)'), { target: { value: subtotal } });
  fireEvent.change(screen.getByLabelText('Impuesto (%)'), { target: { value: taxRate } });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));

beforeEach(() => {
  vi.clearAllMocks();
  patients.data = [withPayer, withoutPayer];
  patients.isLoading = false;
  patients.isError = false;
  api.listInvoices.mockResolvedValue([]);
  api.createInvoice.mockResolvedValue(invoice({}));
});

describe('BillingPage patient selection', () => {
  it('lists patients by last name and asks for one before showing the payer', () => {
    renderPage();
    const options = within(screen.getByLabelText('Paciente')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Seleccionar paciente', 'Mora, Niño', 'Vega, Ana']);
    expect(screen.queryByRole('group', { name: 'Facturar a' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emitir factura' })).toBeDisabled();
  });

  it('fills the payer from the patient record', () => {
    renderPage();
    choosePatient('patient-2');
    const payer = screen.getByRole('group', { name: 'Facturar a' });
    expect(within(payer).getByLabelText('Nombre o razón social')).toHaveValue('Rosa Mora');
    expect(within(payer).getByLabelText('Tipo de identificación')).toHaveValue('CEDULA');
    expect(within(payer).getByLabelText('Número de identificación')).toHaveValue('0912345678');
    expect(within(payer).getByLabelText('Correo del receptor')).toHaveValue('rosa@payer.test');
    expect(screen.getByLabelText('Guardar en la ficha del paciente')).not.toBeChecked();
  });

  it('starts from the patient name and offers to save when no identification is stored', () => {
    renderPage();
    choosePatient('patient-1');
    expect(screen.getByLabelText('Nombre o razón social')).toHaveValue('Ana Vega');
    expect(screen.getByLabelText('Número de identificación')).toHaveValue('');
    expect(screen.getByLabelText('Guardar en la ficha del paciente')).toBeChecked();
  });

  it('reloads the payer when another patient is chosen, discarding edits', () => {
    renderPage();
    choosePatient('patient-2');
    fireEvent.change(screen.getByLabelText('Nombre o razón social'), { target: { value: 'Editado' } });
    choosePatient('patient-1');
    expect(screen.getByLabelText('Nombre o razón social')).toHaveValue('Ana Vega');
    expect(screen.getByLabelText('Número de identificación')).toHaveValue('');
  });
});

describe('BillingPage issuing', () => {
  it('sends the patient, the payer and the tax as an amount', async () => {
    renderPage();
    choosePatient('patient-2');
    fillAmounts('19.99', '15');
    submit();

    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    expect(api.createInvoice.mock.calls[0][0]).toMatchObject({
      patientId: 'patient-2',
      subtotal: 19.99,
      tax: 3,
      description: 'Consulta general',
      saveCustomerToPatient: false,
      customer: {
        name: 'Rosa Mora', taxIdType: 'CEDULA', taxId: '0912345678',
        email: 'rosa@payer.test', address: 'Calle 2',
      },
    });
  });

  it('accepts an identification typed with separators and sends it clean', async () => {
    renderPage();
    choosePatient('patient-1');
    fireEvent.change(screen.getByLabelText('Tipo de identificación'), { target: { value: 'CEDULA' } });
    fireEvent.change(screen.getByLabelText('Número de identificación'), { target: { value: '171 234-5678' } });
    fillAmounts();
    submit();

    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    expect(api.createInvoice.mock.calls[0][0]).toMatchObject({
      patientId: 'patient-1',
      saveCustomerToPatient: true,
      customer: { name: 'Ana Vega', taxIdType: 'CEDULA', taxId: '1712345678' },
    });
  });

  it('blocks issuing and explains what is missing while the payer is incomplete', () => {
    renderPage();
    choosePatient('patient-1');
    fillAmounts();
    expect(screen.getByRole('button', { name: 'Emitir factura' })).toBeDisabled();
    expect(screen.getByText('Selecciona el tipo de identificación.')).toBeInTheDocument();
    expect(screen.getByText('Escribe el número de identificación.')).toBeInTheDocument();
  });

  it('issues once when the button is clicked twice', async () => {
    let finish!: (value: Invoice) => void;
    api.createInvoice.mockReturnValue(new Promise<Invoice>((resolve) => { finish = resolve; }));
    renderPage();
    choosePatient('patient-2');
    fillAmounts();
    submit();
    submit();

    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Emitir factura' })).toBeDisabled();
    finish(invoice({}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Factura emitida'));
    expect(api.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('reuses one idempotency key for a retry of the same form and a new one after success', async () => {
    api.createInvoice.mockRejectedValueOnce(new Error('Faktur no disponible'));
    renderPage();
    choosePatient('patient-2');
    fillAmounts();
    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Faktur no disponible'));
    submit();
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledTimes(2));
    const [first, second] = api.createInvoice.mock.calls.map(([body]) => body.idempotencyKey);
    expect(first).toBeTruthy();
    expect(second).toBe(first);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    choosePatient('patient-2');
    fillAmounts();
    submit();
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledTimes(3));
    expect(api.createInvoice.mock.calls[2][0].idempotencyKey).not.toBe(first);
  });

  it('confirms success, clears the form and keeps it on failure', async () => {
    renderPage();
    choosePatient('patient-2');
    fillAmounts();
    submit();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Factura emitida'));
    expect(screen.getByLabelText('Paciente')).toHaveValue('');
    expect(screen.getByLabelText('Descripción')).toHaveValue('');

    api.createInvoice.mockRejectedValue(new Error('Faktur no disponible'));
    choosePatient('patient-2');
    fillAmounts();
    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Faktur no disponible'));
    expect(screen.getByLabelText('Paciente')).toHaveValue('patient-2');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Consulta general');
  });

  it('names the missing payer data reported by the API', async () => {
    api.createInvoice.mockRejectedValue({
      code: 'INVOICE_CUSTOMER_INCOMPLETE', message: 'x', details: { fields: ['taxId', 'email'] },
    });
    renderPage();
    choosePatient('patient-2');
    fillAmounts();
    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Faltan datos del receptor: número de identificación, correo.',
    ));
  });

  it('shows the total before issuing and no longer says the clinic is the recipient', () => {
    renderPage();
    choosePatient('patient-2');
    fillAmounts('100', '15');
    const summary = screen.getByRole('group', { name: 'Resumen del comprobante' });
    expect(within(summary).getByText('$115.00')).toBeInTheDocument();
    expect(screen.queryByText(/a nombre del consultorio/)).not.toBeInTheDocument();
  });
});

describe('BillingPage patients list states', () => {
  it('explains when there are no patients to invoice', () => {
    patients.data = [];
    renderPage();
    expect(screen.getByText('Registra un paciente para poder facturar.')).toBeInTheDocument();
  });

  it('reports a failure to load patients', () => {
    patients.data = undefined as unknown as unknown[];
    patients.isError = true;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar los pacientes.');
  });
});

describe('BillingPage history', () => {
  it('shows the patient and the payer of each invoice', async () => {
    api.listInvoices.mockResolvedValue([invoice({})]);
    renderPage();
    const row = (await screen.findByText('Rosa Mora')).closest('tr')!;
    expect(within(row).getByText('Niño Mora')).toBeInTheDocument();
    expect(within(row).getByText('CEDULA 0912345678')).toBeInTheDocument();
  });

  it('shows a dash for invoices issued before patients were linked', async () => {
    api.listInvoices.mockResolvedValue([invoice({ patient: null, customerName: 'Consultorio Demo' })]);
    renderPage();
    const row = (await screen.findByText('Consultorio Demo')).closest('tr')!;
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('—');
  });

  it('keeps the failure reason, document links, retry and settings link', async () => {
    api.listInvoices.mockResolvedValue([
      invoice({ status: 'FAILED', errorMessage: 'RUC del emisor no autorizado' }),
      invoice({ id: 'b', pdfUrl: 'https://files.example.com/a.pdf', xmlUrl: 'javascript:alert(1)' }),
    ]);
    renderPage();
    expect(await screen.findByText('RUC del emisor no autorizado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', 'https://files.example.com/a.pdf');
    expect(screen.queryByRole('link', { name: 'XML' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configurar Faktur' })).toHaveAttribute('href', '/admin/settings');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/billing/billing-page.test.tsx`
Expected: FAIL — there is no "Paciente" field.

- [ ] **Step 4: Implement the page**

Edit `src/app/(dashboard)/admin/billing/page.tsx` (keep `STATUS_LABELS`, `STATUS_VARIANTS`, `INVOICES_KEY`, `toCents`, `money`, `isWebUrl`, the header and the settings link as they are).

Imports to add:

```tsx
import { useMemo, useRef, useState } from 'react';
import { usePatients } from '@/hooks/usePatients';
import { BillingCustomerFields } from '@/features/billing/billing-customer-fields';
import {
  EMPTY_BILLING_CUSTOMER, customerFromPatient, hasSavedTaxId, invoiceCustomerErrors, normalizeTaxId,
  type BillingCustomer,
} from '@/features/billing/billing-customer';
```

Helpers above the component:

```tsx
const FIELD_NAMES: Record<string, string> = {
  name: 'nombre', taxIdType: 'tipo de identificación', taxId: 'número de identificación', email: 'correo',
};
const newKey = () => `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function issueErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { code, details, message } = error as { code?: string; details?: { fields?: unknown }; message?: string };
    if (code === 'INVOICE_CUSTOMER_INCOMPLETE' && Array.isArray(details?.fields)) {
      const names = details.fields.map((field) => FIELD_NAMES[String(field)] ?? String(field));
      return `Faltan datos del receptor: ${names.join(', ')}.`;
    }
    if (message) return message;
  }
  return 'No fue posible emitir la factura';
}
```

State and derived values inside the component (replacing the current `description`/`subtotal`/`taxRate` block; keep those three states):

```tsx
  const patients = usePatients();
  const [patientId, setPatientId] = useState('');
  const [customer, setCustomer] = useState<BillingCustomer>(EMPTY_BILLING_CUSTOMER);
  const [saveToPatient, setSaveToPatient] = useState(false);
  // One key per filled form: a retry or a double click must not create a second invoice.
  const idempotencyKey = useRef(newKey());
  // `isPending` only updates on the next render; this blocks a second click in the same tick.
  const submitting = useRef(false);

  const sortedPatients = useMemo(
    () => [...(patients.data ?? [])].sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es')),
    [patients.data],
  );
  const selectedPatient = sortedPatients.find((item) => item.id === patientId) ?? null;
  const customerErrors = selectedPatient ? invoiceCustomerErrors(customer) : {};
  const customerIsValid = !!selectedPatient && Object.keys(customerErrors).length === 0;

  const selectPatient = (id: string) => {
    setPatientId(id);
    const next = (patients.data ?? []).find((item) => item.id === id);
    // Always reload from the record so one patient's payer is never billed under another.
    setCustomer(next ? customerFromPatient(next) : EMPTY_BILLING_CUSTOMER);
    setSaveToPatient(next ? !hasSavedTaxId(next) : false);
  };
```

Replace the query and mutation:

```tsx
  const invoicesQuery = useQuery({ queryKey: INVOICES_KEY, queryFn: () => billingApi.listInvoices() });

  const createInvoice = useMutation({
    mutationFn: () => billingApi.createInvoice({
      patientId,
      subtotal: toCents(subtotalAmount),
      tax: taxAmount,
      description: description.trim(),
      idempotencyKey: idempotencyKey.current,
      saveCustomerToPatient: saveToPatient,
      customer: {
        name: customer.name.trim(),
        taxIdType: customer.taxIdType,
        taxId: normalizeTaxId(customer.taxId),
        email: customer.email.trim(),
        address: customer.address.trim(),
      },
    }),
    onSuccess: () => {
      setDescription('');
      setSubtotal('');
      setTaxRate('0');
      selectPatient('');
      idempotencyKey.current = newKey();
      toast.success('Factura emitida');
      queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
      // The patient record may now hold the saved payer.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PATIENTS });
    },
    onError: (error: unknown) => {
      toast.error(issueErrorMessage(error));
      queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const canSubmit = amountsAreValid && customerIsValid && description.trim() !== '' && !createInvoice.isPending;
```

Use the query key your `usePatients` hook invalidates on patient changes; if it is tenant-scoped, invalidate with the same helper that hook's mutations use (`invalidateScopedLists(queryClient, 'patients', tenantId)`).

Form markup, replacing the current card body. The card description becomes "Elige el paciente y confirma a nombre de quién sale el comprobante.":

```tsx
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit || submitting.current) return;
              submitting.current = true;
              createInvoice.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="invoice-patient">Paciente</Label>
              <select
                id="invoice-patient"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:max-w-md"
                value={patientId}
                disabled={patients.isLoading || createInvoice.isPending}
                onChange={(event) => selectPatient(event.target.value)}
              >
                <option value="">Seleccionar paciente</option>
                {sortedPatients.map((item) => (
                  <option key={item.id} value={item.id}>{item.lastName}, {item.firstName}</option>
                ))}
              </select>
              {patients.isLoading && <p role="status" className="text-sm text-muted-foreground">Cargando pacientes...</p>}
              {patients.isError && <p role="alert" className="text-sm text-destructive">No se pudieron cargar los pacientes.</p>}
              {!patients.isLoading && !patients.isError && sortedPatients.length === 0 && (
                <p className="text-sm text-muted-foreground">Registra un paciente para poder facturar.</p>
              )}
            </div>

            {selectedPatient && (
              <fieldset className="space-y-4 rounded-lg border p-4">
                <legend className="px-1 text-sm font-semibold">Facturar a</legend>
                <p className="text-sm text-muted-foreground">
                  Puede ser el paciente u otra persona o empresa que paga. Los cambios aplican a esta factura.
                </p>
                <BillingCustomerFields
                  idPrefix="invoice-customer"
                  value={customer}
                  onChange={setCustomer}
                  errors={customerErrors}
                  disabled={createInvoice.isPending}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={saveToPatient}
                    onChange={(event) => setSaveToPatient(event.target.checked)}
                  />
                  Guardar en la ficha del paciente
                </label>
              </fieldset>
            )}

            {/* existing description / subtotal / tax-rate grid, unchanged */}
            {/* existing summary + submit row, unchanged */}
          </form>
```

A `<fieldset>` with a `<legend>` exposes the `group` role named "Facturar a", which the tests query. Keep the two existing blocks (the fields grid and the summary row) exactly as they are inside the form.

History table: change the header cells to Fecha, **Paciente**, **Facturado a**, Emisor, Descripción, Total, Estado, Documentos and the first body cells to:

```tsx
                      <td className="whitespace-nowrap p-3">{formatDate(invoice.issueDate, 'dd/MM/yyyy')}</td>
                      <td className="p-3">
                        {invoice.patient ? `${invoice.patient.firstName} ${invoice.patient.lastName}` : '—'}
                      </td>
                      <td className="p-3">
                        <span className="block">{invoice.customerName}</span>
                        {invoice.customerTaxId && (
                          <span className="block text-xs text-muted-foreground">
                            {invoice.customerTaxIdType} {invoice.customerTaxId}
                          </span>
                        )}
                      </td>
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/features/billing`
Expected: PASS — the rewritten page tests and the Task 7 rule tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/billing "src/app/(dashboard)/admin/billing/page.tsx"
git commit -m "feat(web): issue invoices to a patient or their payer"
```

---

### Task 9: Billing data in the patient forms

**Files:**
- Modify: `src/lib/validations/schemas.ts` (`patientSchema`), `src/app/(dashboard)/patients/new/page.tsx`, `src/app/(dashboard)/patients/[id]/edit/page.tsx`, `src/app/(dashboard)/patients/patient-forms.test.tsx`

**Interfaces:**
- Consumes: `BillingCustomerFields`, `patientBillingErrors`, `normalizeTaxId`, `BillingCustomer` (Tasks 7–8).
- Produces: `PatientFormData` includes `billingName`, `billingTaxIdType`, `billingTaxId`, `billingEmail`, `billingAddress` (all optional strings).

- [ ] **Step 1: Write the failing tests**

In `src/app/(dashboard)/patients/patient-forms.test.tsx`, add to the hoisted `mocks.patient` object:

```ts
    billingName: 'Luis Vega', billingTaxIdType: 'CEDULA', billingTaxId: '1712345678',
    billingEmail: 'luis@example.com', billingAddress: null,
```

and append:

```tsx
describe('patient billing data', () => {
  const fillRequired = () => {
    fireEvent.change(document.getElementById('firstName')!, { target: { value: 'Ana' } });
    fireEvent.change(document.getElementById('lastName')!, { target: { value: 'Vega' } });
  };

  it('creates a patient with a third-party payer, cleaning the number', async () => {
    renderPage(<NewPatientPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText('Nombre o razón social'), { target: { value: 'Seguros Andina' } });
    fireEvent.change(screen.getByLabelText('Tipo de identificación'), { target: { value: 'RUC' } });
    fireEvent.change(screen.getByLabelText('Número de identificación'), { target: { value: '1790-000000-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear Paciente' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      billingName: 'Seguros Andina', billingTaxIdType: 'RUC', billingTaxId: '1790000000001',
    });
  });

  it('creates a patient with no billing data', async () => {
    renderPage(<NewPatientPage />);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Crear Paciente' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ billingTaxIdType: '', billingTaxId: '' });
  });

  it('copies the patient name, e-mail and address into the payer', () => {
    renderPage(<NewPatientPage />);
    fillRequired();
    fireEvent.change(document.getElementById('email')!, { target: { value: 'ana@example.com' } });
    fireEvent.change(document.getElementById('address')!, { target: { value: 'Centro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Usar los datos del paciente' }));
    expect(screen.getByLabelText('Nombre o razón social')).toHaveValue('Ana Vega');
    expect(screen.getByLabelText('Correo del receptor')).toHaveValue('ana@example.com');
    expect(screen.getByLabelText('Dirección', { selector: '#patient-billing-address' })).toHaveValue('Centro');
  });

  it('blocks saving a type without a number', async () => {
    renderPage(<NewPatientPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText('Tipo de identificación'), { target: { value: 'CEDULA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear Paciente' }));
    expect(await screen.findByText('Escribe el número de identificación.')).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('loads stored billing data when editing and can clear it', async () => {
    renderPage(<EditPatientPage />);
    expect(screen.getByLabelText('Nombre o razón social')).toHaveValue('Luis Vega');
    expect(screen.getByLabelText('Número de identificación')).toHaveValue('1712345678');

    fireEvent.change(screen.getByLabelText('Tipo de identificación'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Número de identificación'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      billingName: 'Luis Vega', billingTaxIdType: '', billingTaxId: '',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/(dashboard)/patients/patient-forms.test.tsx"`
Expected: the five new tests FAIL — no "Nombre o razón social" field.

- [ ] **Step 3: Extend the schema**

In `src/lib/validations/schemas.ts`:

```ts
import { normalizeTaxId, patientBillingErrors, type TaxIdType } from '@/features/billing/billing-customer';
```

Replace `patientSchema`'s closing `});` so the object gains the five fields and the cross-field check:

```ts
  notes: z.string().optional(),
  billingName: z.string().optional(),
  billingTaxIdType: z.string().optional(),
  billingTaxId: z.string().optional().transform((value) => (value ? normalizeTaxId(value) : value)),
  billingEmail: z.string().optional(),
  billingAddress: z.string().optional(),
}).superRefine((data, context) => {
  const errors = patientBillingErrors({
    name: data.billingName ?? '',
    taxIdType: (data.billingTaxIdType ?? '') as TaxIdType | '',
    taxId: data.billingTaxId ?? '',
    email: data.billingEmail ?? '',
    address: data.billingAddress ?? '',
  });
  const paths = { name: 'billingName', taxIdType: 'billingTaxIdType', taxId: 'billingTaxId', email: 'billingEmail', address: 'billingAddress' } as const;
  for (const [field, message] of Object.entries(errors)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message, path: [paths[field as keyof typeof paths]] });
  }
});
```

`PatientFormData` is derived with `z.infer`, so it picks the fields up. If `z.infer` of a refined schema with a transform breaks the `& { assignedPsychologistId?: string }` intersection, type it with `z.input<typeof patientSchema>` for the form and keep `z.infer` for the submitted data.

- [ ] **Step 4: Add the section to both forms**

In both `new/page.tsx` and `[id]/edit/page.tsx`:

```tsx
import { BillingCustomerFields } from '@/features/billing/billing-customer-fields';
import type { BillingCustomer, TaxIdType } from '@/features/billing/billing-customer';
```

Take `watch` and `setValue` from `useForm` (alongside `register`, `handleSubmit`, `formState`), and in `new/page.tsx` give the form its billing defaults:

```tsx
  } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: { billingName: '', billingTaxIdType: '', billingTaxId: '', billingEmail: '', billingAddress: '' },
  });
```

In `[id]/edit/page.tsx`, add to the object passed to `reset(...)`:

```tsx
        billingName: patient.billingName || '',
        billingTaxIdType: patient.billingTaxIdType || '',
        billingTaxId: patient.billingTaxId || '',
        billingEmail: patient.billingEmail || '',
        billingAddress: patient.billingAddress || '',
```

Inside the component, before `return`:

```tsx
  const billing: BillingCustomer = {
    name: watch('billingName') ?? '',
    taxIdType: (watch('billingTaxIdType') ?? '') as TaxIdType | '',
    taxId: watch('billingTaxId') ?? '',
    email: watch('billingEmail') ?? '',
    address: watch('billingAddress') ?? '',
  };
  const setBilling = (next: BillingCustomer) => {
    const options = { shouldDirty: true, shouldValidate: false };
    setValue('billingName', next.name, options);
    setValue('billingTaxIdType', next.taxIdType, options);
    setValue('billingTaxId', next.taxId, options);
    setValue('billingEmail', next.email, options);
    setValue('billingAddress', next.address, options);
  };
  const copyPatientToBilling = () =>
    setBilling({
      ...billing,
      name: `${watch('firstName') ?? ''} ${watch('lastName') ?? ''}`.trim(),
      email: watch('email') ?? '',
      address: watch('address') ?? '',
    });
```

In the JSX, immediately before the `<div className="space-y-2">` that holds the "Notas" textarea:

```tsx
            <div className="border-t pt-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Datos de facturación</h3>
                  <p className="text-sm text-muted-foreground">
                    A nombre de quién salen las facturas de este paciente. Puede ser otra persona o empresa.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={copyPatientToBilling}>
                  Usar los datos del paciente
                </Button>
              </div>
              <BillingCustomerFields
                idPrefix="patient-billing"
                value={billing}
                onChange={setBilling}
                errors={{
                  name: errors.billingName?.message,
                  taxIdType: errors.billingTaxIdType?.message,
                  taxId: errors.billingTaxId?.message,
                  email: errors.billingEmail?.message,
                }}
              />
            </div>
```

The form's own "Dirección" input has id `address`; the billing one gets `patient-billing-address`, so both labels read "Dirección" and the test selects the billing one by id.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run "src/app/(dashboard)/patients"`
Expected: PASS — the five new tests and the two pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/schemas.ts "src/app/(dashboard)/patients"
git commit -m "feat(web): capture billing data in the patient forms"
```

---

### Task 10: Invoices in the patient record and web verification

**Files:**
- Create: `src/features/billing/patient-invoices-tab.tsx`
- Test: `src/features/billing/patient-invoices-tab.test.tsx`
- Modify: `src/app/(dashboard)/patients/[id]/page.tsx` (tabs array near line 100 and the tab switch near line 218)

**Interfaces:**
- Consumes: `billingApi.listInvoices({ patientId })` (Task 7), `isAdminRole`, `isProfessionalRole` from `@/types/guards`.
- Produces: `<PatientInvoicesTab patientId={string} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/billing/patient-invoices-tab.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice } from '@/types';
import { PatientInvoicesTab } from './patient-invoices-tab';

const api = vi.hoisted(() => ({ listInvoices: vi.fn() }));
vi.mock('@/lib/api/endpoints', () => ({ billingApi: { listInvoices: api.listInvoices } }));

const invoice = (overrides: Partial<Invoice>): Invoice => ({
  id: 'invoice-1', status: 'ISSUED', issueDate: '2026-10-01T15:00:00.000Z',
  customerName: 'Rosa Mora', customerEmail: 'rosa@payer.test', customerTaxIdType: 'CEDULA',
  customerTaxId: '0912345678', description: 'Consulta', subtotal: 100, tax: 15, total: 115,
  ...overrides,
});

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PatientInvoicesTab patientId="patient-2" /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('PatientInvoicesTab', () => {
  it('requests only this patient invoices and lists them with their payer and documents', async () => {
    api.listInvoices.mockResolvedValue([
      invoice({ pdfUrl: 'https://files.example.com/a.pdf' }),
      invoice({ id: 'b', status: 'FAILED', description: 'Paquete', errorMessage: 'Faktur no disponible' }),
    ]);
    renderTab();

    expect(await screen.findByText('Consulta')).toBeInTheDocument();
    expect(api.listInvoices).toHaveBeenCalledWith({ patientId: 'patient-2' });
    expect(screen.getAllByText('Rosa Mora')).toHaveLength(2);
    expect(screen.getByText('$115.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', 'https://files.example.com/a.pdf');
    expect(screen.getByText('Faktur no disponible')).toBeInTheDocument();
  });

  it('says so when the patient has no invoices and links to billing', async () => {
    api.listInvoices.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Este paciente aún no tiene facturas.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Facturación' })).toHaveAttribute('href', '/admin/billing');
  });

  it('offers a retry when loading fails', async () => {
    api.listInvoices.mockRejectedValueOnce(new Error('sin conexión'));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(api.listInvoices).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/billing/patient-invoices-tab.test.tsx`
Expected: FAIL — cannot resolve `./patient-invoices-tab`.

- [ ] **Step 3: Implement the tab**

```tsx
// src/features/billing/patient-invoices-tab.tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { billingApi } from '@/lib/api/endpoints';
import { QUERY_KEYS } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import type { Invoice } from '@/types';

const STATUS_LABELS: Record<Invoice['status'], string> = {
  PENDING: 'Pendiente', ISSUED: 'Emitida', FAILED: 'Fallida', VOIDED: 'Anulada',
};
const isWebUrl = (value?: string) => !!value && /^https?:\/\//i.test(value);

export function PatientInvoicesTab({ patientId }: { patientId: string }) {
  const invoices = useQuery({
    queryKey: [...QUERY_KEYS.TENANT, 'billing', 'invoices', { patientId }],
    queryFn: () => billingApi.listInvoices({ patientId }),
    enabled: !!patientId,
  });

  if (invoices.isLoading) return <p role="status" className="text-sm text-muted-foreground">Cargando facturas...</p>;
  if (invoices.isError) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>No se pudieron cargar las facturas.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void invoices.refetch()}>Reintentar</Button>
      </div>
    );
  }
  const items = invoices.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link href="/admin/billing" className="text-sm text-primary underline">Ir a Facturación</Link>
      </div>
      {items.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Este paciente aún no tiene facturas.</CardContent></Card>
      ) : items.map((invoice) => (
        <Card key={invoice.id}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-4">
            <div>
              <p className="font-medium">{invoice.description}</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(invoice.issueDate, 'dd/MM/yyyy')} · Facturado a <span>{invoice.customerName}</span>
              </p>
              {invoice.status === 'FAILED' && invoice.errorMessage && (
                <p className="mt-1 text-xs text-destructive">{invoice.errorMessage}</p>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="font-semibold">${Number(invoice.total).toFixed(2)}</span>
              <Badge variant={invoice.status === 'ISSUED' ? 'default' : invoice.status === 'FAILED' ? 'destructive' : 'outline'}>
                {STATUS_LABELS[invoice.status] ?? invoice.status}
              </Badge>
              {isWebUrl(invoice.pdfUrl) && <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">PDF</a>}
              {isWebUrl(invoice.xmlUrl) && <a href={invoice.xmlUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">XML</a>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/features/billing/patient-invoices-tab.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the tab to the patient record, test first**

In `src/app/(dashboard)/patients/patient-detail-team.test.tsx`, add a test using that file's existing render helper and role setup (read its harness first): for an ADMIN and a PROFESIONAL the patient page shows a tab button named "Facturas"; for an ASISTENTE it does not. Mock `@/features/billing/patient-invoices-tab` to render `<div data-testid="patient-invoices" />` and assert that clicking "Facturas" shows it.

```tsx
  it.each([
    [UserRole.ADMIN, true],
    [UserRole.PROFESIONAL, true],
    [UserRole.ASISTENTE, false],
  ])('shows the invoices tab to %s: %s', async (role, visible) => {
    renderPatientDetail(role);
    await screen.findByRole('button', { name: 'General' });
    expect(!!screen.queryByRole('button', { name: 'Facturas' })).toBe(visible);
    if (visible) {
      fireEvent.click(screen.getByRole('button', { name: 'Facturas' }));
      expect(screen.getByTestId('patient-invoices')).toBeInTheDocument();
    }
  });
```

Use the file's own name for its render helper in place of `renderPatientDetail`.

Run: `npx vitest run "src/app/(dashboard)/patients/patient-detail-team.test.tsx"`
Expected: the new cases FAIL — no "Facturas" tab.

In `src/app/(dashboard)/patients/[id]/page.tsx`:

```tsx
import { Receipt } from 'lucide-react';
import { PatientInvoicesTab } from '@/features/billing/patient-invoices-tab';
import { isProfessionalRole } from '@/types/guards'; // add to the existing guards import
```

Add to the tabs array, after the `tasks` entry:

```tsx
  { id: 'billing', label: 'Facturas', icon: Receipt },
```

Where the page maps the tabs into buttons, filter out the billing tab for roles that cannot invoice:

```tsx
  const canSeeInvoices = !!user && (isAdminRole(user.role) || isProfessionalRole(user.role));
  const visibleTabs = tabs.filter((tab) => tab.id !== 'billing' || canSeeInvoices);
```

and render `visibleTabs.map(...)` instead of `tabs.map(...)`. If the tab id type is a union, add `'billing'` to it. With the other tab switches:

```tsx
        {activeTab === 'billing' && canSeeInvoices && <PatientInvoicesTab patientId={patientId} />}
```

Use the user object the page already reads from the auth store; if it does not read one at that level, add `const user = useAuthStore((state) => state.user);`.

Run: `npx vitest run "src/app/(dashboard)/patients"`
Expected: PASS.

- [ ] **Step 6: Run the full web matrix**

Run each on its own:

```bash
npm run lint
npm run type-check
npx vitest run
npm run build
```

Expected: zero lint warnings, zero type errors, every test passes, build succeeds.

- [ ] **Step 7: Check it in the browser**

With the API branch running locally (or the mock API extended with `patientId`, `patient` and the billing fields), sign in as an administrator and verify at desktop width and 375px:

- Billing: choosing a patient with stored billing data fills "Facturar a"; choosing one without leaves the identification empty, shows the two messages and keeps "Emitir factura" disabled; changing patient reloads the block.
- Issuing shows "Factura emitida", the row appears in the history with Paciente and Facturado a.
- New patient: "Usar los datos del paciente" copies name, e-mail and address; a type without a number blocks saving.
- Patient record: the "Facturas" tab lists that patient's invoices; an assistant does not see the tab.

Record anything that fails as a defect, fix it with a regression test first, and rerun Step 6. If no real API is available, say so in the hand-off rather than reporting the browser check as done.

- [ ] **Step 8: Commit**

```bash
git add src/features/billing "src/app/(dashboard)/patients"
git commit -m "feat(web): show a patient's invoices in their record"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Patient billing columns, invoice patient link, customer address, index, additive migration | 1 |
| Tax ID formats, customer resolution order, no default identification | 2 |
| Patient create/update accept billing fields; pairing and format rules; clearing | 3 |
| Issue requires an in-clinic, non-archived patient; 404 | 4, 6 |
| 422 `INVOICE_CUSTOMER_INCOMPLETE` before creating or reserving | 4, 6 |
| `saveCustomerToPatient`, kept when Faktur fails | 4, 6 |
| Snapshot immutability | 4 (snapshot written), 6 (edit after issue) |
| Idempotency without revalidating or re-saving | 4 |
| No `subscriptionId` on new invoices; payer address sent to Faktur | 4 |
| List and get include patient; `patientId` filter; legacy invoices with null patient | 5, 6 |
| Billing page: patient selector, payer block, save checkbox default, validation, API error, history columns, note removed, reload on patient change | 8 |
| Patient forms: billing section and "Usar los datos del paciente" | 9 |
| Patient record: invoices list for admin and professional | 10 |
| Verification per repository | 6, 10 |

## Deferred, not in this plan

- Linking an invoice to an appointment.
- "Consumidor final" invoices.
- Several line items per invoice.
- Credit notes and voiding.
- Sharing one payer across patients.
- Check-digit validation of cédula and RUC.
- Restricting a professional to invoicing only the patients they treat.

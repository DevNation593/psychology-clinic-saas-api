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

import { FormField, FormSchema } from '../clinical-forms/form-schema';

/** One line of a document: a value, a table or the image of a signature. */
export type DocumentRow =
  | { label: string; text: string }
  | { label: string; table: { columns: string[]; rows: string[][] } }
  | { label: string; image: Buffer };

export interface DocumentSection {
  title: string;
  rows: DocumentRow[];
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const formatDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const formatNumber = (value: number) => String(value).replace('.', ',');

/** The text a reader sees for a value: the label of an option, a date as it is written, a unit. */
export function formatFieldValue(field: FormField, value: unknown): string {
  const labelOf = (option: unknown) =>
    field.options?.find((candidate) => candidate.value === option)?.label ?? String(option);
  const withUnit = (text: string) => (field.unit ? `${text} ${field.unit}` : text);

  switch (field.type) {
    case 'checkbox':
      return value === true ? 'Sí' : 'No';
    case 'date':
      return formatDate(String(value));
    case 'radio':
    case 'select':
      return labelOf(value);
    case 'multiselect':
      return (Array.isArray(value) ? value : [value]).map(labelOf).join(', ');
    case 'scale': {
      const label = field.options?.find((option) => option.value === String(value))?.label;
      return label ? `${value} · ${label}` : String(value);
    }
    case 'integer':
    case 'decimal':
    case 'calculated':
      return withUnit(typeof value === 'number' ? formatNumber(value) : String(value));
    default:
      return String(value);
  }
}

function rowOf(field: FormField, value: unknown): DocumentRow | null {
  if (isEmpty(value)) return null;
  // A box left unchecked says nothing in a document.
  if (field.type === 'checkbox' && value !== true) return null;

  if (field.type === 'signature') {
    const encoded = String(value).split(',')[1];
    return encoded ? { label: field.label, image: Buffer.from(encoded, 'base64') } : null;
  }
  if (field.type === 'table') {
    const columns = field.columns ?? [];
    const rows = (value as Record<string, unknown>[]).map((row) =>
      columns.map((column) =>
        isEmpty(row?.[column.key]) ? '' : formatFieldValue(column, row[column.key]),
      ),
    );
    return { label: field.label, table: { columns: columns.map((column) => column.label), rows } };
  }
  return { label: field.label, text: formatFieldValue(field, value) };
}

/**
 * The record as a document reads it: its sections in the order of the definition, with only
 * what was filled in. A section left empty is not printed.
 */
export function documentSections(
  schema: FormSchema,
  data: Record<string, unknown>,
): DocumentSection[] {
  return schema.sections
    .map((section) => ({
      title: section.title,
      rows: section.fields
        .map((field) => rowOf(field, data[field.key]))
        .filter((row): row is DocumentRow => row !== null),
    }))
    .filter((section) => section.rows.length > 0);
}

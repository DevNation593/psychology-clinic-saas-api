/** The modules whose records are a document with a body of text a clinic writes once and reuses. */
export const TEMPLATE_MODULE_KEYS = ['general.certificates', 'general.consents'] as const;
export type TemplateModuleKey = (typeof TEMPLATE_MODULE_KEYS)[number];

/** What a template may ask the client to fill in when it is applied to a patient. */
export const TEMPLATE_VARIABLES = [
  'paciente',
  'identificacion',
  'edad',
  'fecha',
  'profesional',
  'consultorio',
] as const;

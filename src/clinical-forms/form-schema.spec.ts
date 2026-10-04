import {
  evaluateFormAlerts,
  FormIssue,
  FormSchema,
  MAX_SIGNATURE_CHARS,
  validateFormData,
  validateFormSchema,
} from './form-schema';

const schema: FormSchema = {
  sections: [
    {
      key: 'main',
      title: 'Principal',
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', required: true, maxLength: 20 },
        { key: 'weightKg', label: 'Peso', type: 'decimal', min: 1, max: 500 },
        { key: 'heightCm', label: 'Altura', type: 'decimal', min: 30, max: 250 },
        {
          key: 'bmi',
          label: 'IMC',
          type: 'calculated',
          formula: 'round(weightKg / ((heightCm / 100) ^ 2), 1)',
        },
        { key: 'visits', label: 'Visitas', type: 'integer', min: 0 },
        { key: 'pain', label: 'Dolor', type: 'scale', min: 0, max: 10 },
        { key: 'birth', label: 'Nacimiento', type: 'date' },
        { key: 'hour', label: 'Hora', type: 'time' },
        { key: 'smoker', label: 'Fuma', type: 'checkbox' },
        {
          key: 'severity',
          label: 'Severidad',
          type: 'select',
          options: [
            { value: 'LEVE', label: 'Leve' },
            { value: 'GRAVE', label: 'Grave' },
          ],
        },
        {
          key: 'areas',
          label: 'Áreas',
          type: 'multiselect',
          options: [
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
          ],
        },
        {
          key: 'items',
          label: 'Ítems',
          type: 'table',
          maxRows: 3,
          columns: [
            { key: 'drug', label: 'Medicamento', type: 'text', required: true },
            { key: 'dose', label: 'Dosis', type: 'decimal', min: 0 },
          ],
        },
      ],
    },
  ],
  alerts: [
    { when: "severity == 'GRAVE'", level: 'critical', message: 'Caso grave' },
    { when: 'bmi >= 30', level: 'warning', message: 'IMC alto' },
  ],
};

const issuesOf = (data: unknown, target: FormSchema = schema) => {
  try {
    validateFormData(target, data);
  } catch (error) {
    return (error as { response: { code: string; details: unknown[] } }).response;
  }
  throw new Error('validateFormData did not throw');
};

describe('validateFormData', () => {
  it('coerces values to their declared types and drops empty optional fields', () => {
    expect(
      validateFormData(schema, {
        name: '  Ana  ',
        weightKg: '70,5',
        heightCm: 170,
        visits: '3',
        pain: 7,
        birth: '2020-02-29',
        hour: '08:30',
        smoker: 'true',
        severity: 'LEVE',
        areas: ['A', 'A', 'B'],
        items: [
          { drug: ' Ibuprofeno ', dose: '400' },
          { drug: '', dose: '' },
        ],
      }),
    ).toEqual({
      name: 'Ana',
      weightKg: 70.5,
      heightCm: 170,
      bmi: 24.4,
      visits: 3,
      pain: 7,
      birth: '2020-02-29',
      hour: '08:30',
      smoker: true,
      severity: 'LEVE',
      areas: ['A', 'B'],
      items: [{ drug: 'Ibuprofeno', dose: 400 }],
    });
  });

  it('keeps only what was filled in and computes nothing from missing operands', () => {
    expect(
      validateFormData(schema, { name: 'Ana', weightKg: 70, severity: '', areas: [] }),
    ).toEqual({
      name: 'Ana',
      weightKg: 70,
    });
  });

  it('ignores a calculated value sent by the client', () => {
    const data = validateFormData(schema, { name: 'Ana', weightKg: 70, heightCm: 170, bmi: 99 });

    expect(data.bmi).toBe(24.2);
  });

  it('reports every problem at once with CLINICAL_RECORD_INVALID', () => {
    const response = issuesOf({
      weightKg: 900,
      visits: 1.5,
      pain: 11,
      birth: '2023-02-30',
      hour: '25:00',
      smoker: 'yes',
      severity: 'OTRA',
      areas: ['Z'],
      items: [{ dose: -1 }, 'row'],
      extra: 1,
    });

    expect(response.code).toBe('CLINICAL_RECORD_INVALID');
    expect(response.details).toEqual(
      expect.arrayContaining([
        { field: 'extra', message: 'Campo desconocido' },
        { field: 'name', message: 'Este campo es obligatorio' },
        { field: 'weightKg', message: 'Debe ser menor o igual a 500' },
        { field: 'visits', message: 'Debe ser un número entero' },
        { field: 'pain', message: 'Debe ser menor o igual a 10' },
        { field: 'birth', message: 'Debe ser una fecha con formato AAAA-MM-DD' },
        { field: 'hour', message: 'Debe ser una hora con formato HH:mm' },
        { field: 'smoker', message: 'Debe ser verdadero o falso' },
        { field: 'severity', message: 'Selecciona una opción válida' },
        { field: 'areas', message: 'Contiene una opción no válida' },
        { field: 'items[0].drug', message: 'Este campo es obligatorio' },
        { field: 'items[0].dose', message: 'Debe ser mayor o igual a 0' },
        { field: 'items[1]', message: 'Cada fila debe ser un objeto' },
      ]),
    );
  });

  it('enforces text length, table size and required tables', () => {
    expect(issuesOf({ name: 'x'.repeat(21) }).details).toEqual([
      { field: 'name', message: 'Máximo 20 caracteres' },
    ]);
    expect(
      issuesOf({ name: 'Ana', items: Array.from({ length: 4 }, () => ({ drug: 'a' })) }).details,
    ).toEqual([{ field: 'items', message: 'Máximo 3 filas' }]);

    const required: FormSchema = {
      sections: [
        {
          key: 's',
          title: 'S',
          fields: [
            {
              key: 'rows',
              label: 'Filas',
              type: 'table',
              minRows: 1,
              columns: [{ key: 'a', label: 'A', type: 'text' }],
            },
          ],
        },
      ],
    };
    expect(issuesOf({ rows: [{ a: ' ' }] }, required).details).toEqual([
      { field: 'rows', message: 'Agrega al menos una fila' },
    ]);
  });

  describe('signature', () => {
    const schema: FormSchema = {
      sections: [
        {
          key: 'consent',
          title: 'Consentimiento',
          fields: [{ key: 'signature', label: 'Firma', type: 'signature' }],
        },
      ],
    };
    const png = (bytes: number[]) =>
      `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...bytes]).toString('base64')}`;
    const issueOf = (signature: unknown) => {
      try {
        validateFormData(schema, { signature });
        return null;
      } catch (error) {
        return (error as { response: { details: FormIssue[] } }).response.details[0].message;
      }
    };

    it('keeps a PNG drawn on screen and leaves an empty one out', () => {
      const image = png([1, 2, 3, 4]);

      expect(validateFormData(schema, { signature: image })).toEqual({ signature: image });
      expect(validateFormData(schema, { signature: '' })).toEqual({});
    });

    it('refuses what is not a PNG by its bytes, whatever it claims to be', () => {
      const notPng = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`;

      expect(issueOf(notPng)).toBe('La firma debe ser una imagen PNG');
      expect(issueOf('data:image/svg+xml;base64,AAAA')).toBe('La firma debe ser una imagen PNG');
      expect(issueOf('data:image/png;base64,no es base64')).toBe(
        'La firma debe ser una imagen PNG',
      );
      expect(issueOf(42)).toBe('La firma debe ser una imagen PNG');
    });

    it('refuses an image larger than a signature needs', () => {
      expect(issueOf(png(Array.from({ length: MAX_SIGNATURE_CHARS }, () => 7)))).toBe(
        'La firma es demasiado grande',
      );
    });

    it('is not accepted as the column of a table', () => {
      expect(() =>
        validateFormSchema({
          sections: [
            {
              key: 'main',
              title: 'Datos',
              fields: [
                {
                  key: 'rows',
                  label: 'Filas',
                  type: 'table',
                  columns: [{ key: 'signature', label: 'Firma', type: 'signature' }],
                },
              ],
            },
          ],
        }),
      ).toThrow();
    });
  });

  it('rejects data that is not an object', () => {
    expect(issuesOf([]).details).toEqual([{ field: 'data', message: 'Debe ser un objeto' }]);
    expect(issuesOf(null).code).toBe('CLINICAL_RECORD_INVALID');
  });
});

describe('evaluateFormAlerts', () => {
  it('returns the rules the data triggers', () => {
    expect(evaluateFormAlerts(schema, { severity: 'GRAVE', bmi: 31 })).toEqual([
      { level: 'critical', message: 'Caso grave' },
      { level: 'warning', message: 'IMC alto' },
    ]);
    expect(evaluateFormAlerts(schema, { severity: 'LEVE' })).toEqual([]);
    expect(evaluateFormAlerts(schema, 'not an object')).toEqual([]);
  });
});

describe('validateFormSchema', () => {
  const issuesOfSchema = (raw: unknown) => {
    try {
      validateFormSchema(raw);
    } catch (error) {
      return (error as { response: { code: string; details: { field: string }[] } }).response;
    }
    throw new Error('validateFormSchema did not throw');
  };

  it('accepts a valid schema and strips unknown properties', () => {
    const raw = {
      sections: [
        {
          key: 'injury',
          title: ' Lesión ',
          unknown: true,
          fields: [
            {
              key: 'injuryType',
              label: 'Tipo de lesión',
              type: 'select',
              required: true,
              hacked: '<script>',
              options: [
                { value: 'TRAUMATICA', label: 'Traumática', extra: 1 },
                { value: 'DEPORTIVA', label: 'Deportiva' },
              ],
            },
            { key: 'a', label: 'A', type: 'integer', min: 0, max: 3 },
            { key: 'b', label: 'B', type: 'scale', min: 0, max: 3 },
            { key: 'total', label: 'Total', type: 'calculated', formula: 'sum(a, b)' },
          ],
        },
      ],
      alerts: [
        { when: "total >= 5 or injuryType == 'DEPORTIVA'", level: 'warning', message: 'Revisar' },
      ],
    };

    expect(validateFormSchema(raw)).toEqual({
      sections: [
        {
          key: 'injury',
          title: 'Lesión',
          fields: [
            {
              key: 'injuryType',
              label: 'Tipo de lesión',
              type: 'select',
              required: true,
              options: [
                { value: 'TRAUMATICA', label: 'Traumática' },
                { value: 'DEPORTIVA', label: 'Deportiva' },
              ],
            },
            { key: 'a', label: 'A', type: 'integer', min: 0, max: 3 },
            { key: 'b', label: 'B', type: 'scale', min: 0, max: 3 },
            { key: 'total', label: 'Total', type: 'calculated', formula: 'sum(a, b)' },
          ],
        },
      ],
      alerts: [
        { when: "total >= 5 or injuryType == 'DEPORTIVA'", level: 'warning', message: 'Revisar' },
      ],
    });
  });

  it('accepts the schema validateFormData was tested with', () => {
    expect(validateFormSchema(schema)).toEqual(schema);
  });

  it.each([
    ['no sections', { sections: [] }, 'sections'],
    [
      'a section without fields',
      { sections: [{ key: 's', title: 'S', fields: [] }] },
      'sections[0].fields',
    ],
    [
      'an invalid key',
      { sections: [{ key: 's', title: 'S', fields: [{ key: '1a', label: 'A', type: 'text' }] }] },
      'sections[0].fields[0].key',
    ],
    [
      'a repeated key',
      {
        sections: [
          {
            key: 's',
            title: 'S',
            fields: [
              { key: 'a', label: 'A', type: 'text' },
              { key: 'a', label: 'B', type: 'text' },
            ],
          },
        ],
      },
      'sections[0].fields[1].key',
    ],
    [
      'an unknown type',
      { sections: [{ key: 's', title: 'S', fields: [{ key: 'a', label: 'A', type: 'file' }] }] },
      'sections[0].fields[0].type',
    ],
    [
      'a select without options',
      { sections: [{ key: 's', title: 'S', fields: [{ key: 'a', label: 'A', type: 'select' }] }] },
      'sections[0].fields[0].options',
    ],
    [
      'a scale without bounds',
      { sections: [{ key: 's', title: 'S', fields: [{ key: 'a', label: 'A', type: 'scale' }] }] },
      'sections[0].fields[0]',
    ],
    [
      'a table inside a table',
      {
        sections: [
          {
            key: 's',
            title: 'S',
            fields: [
              {
                key: 't',
                label: 'T',
                type: 'table',
                columns: [{ key: 'n', label: 'N', type: 'table', columns: [] }],
              },
            ],
          },
        ],
      },
      'sections[0].fields[0].columns[0].type',
    ],
    [
      'a formula over an unknown field',
      {
        sections: [
          {
            key: 's',
            title: 'S',
            fields: [{ key: 'c', label: 'C', type: 'calculated', formula: 'missing + 1' }],
          },
        ],
      },
      'c.formula',
    ],
    [
      'a formula over a field declared after it',
      {
        sections: [
          {
            key: 's',
            title: 'S',
            fields: [
              { key: 'c', label: 'C', type: 'calculated', formula: 'a + 1' },
              { key: 'a', label: 'A', type: 'integer' },
            ],
          },
        ],
      },
      'c.formula',
    ],
    [
      'a formula over a text field',
      {
        sections: [
          {
            key: 's',
            title: 'S',
            fields: [
              { key: 'a', label: 'A', type: 'text' },
              { key: 'c', label: 'C', type: 'calculated', formula: 'a + 1' },
            ],
          },
        ],
      },
      'c.formula',
    ],
    [
      'a formula that does not parse',
      {
        sections: [
          {
            key: 's',
            title: 'S',
            fields: [
              { key: 'a', label: 'A', type: 'integer' },
              { key: 'c', label: 'C', type: 'calculated', formula: 'a +' },
            ],
          },
        ],
      },
      'c.formula',
    ],
    [
      'an alert with an unknown level',
      {
        sections: [{ key: 's', title: 'S', fields: [{ key: 'a', label: 'A', type: 'integer' }] }],
        alerts: [{ when: 'a > 1', level: 'fatal', message: 'x' }],
      },
      'alerts[0]',
    ],
    [
      'an alert over an unknown field',
      {
        sections: [{ key: 's', title: 'S', fields: [{ key: 'a', label: 'A', type: 'integer' }] }],
        alerts: [{ when: 'zzz > 1', level: 'info', message: 'x' }],
      },
      'alerts[0].when',
    ],
  ])('rejects %s', (_, raw, field) => {
    const response = issuesOfSchema(raw);

    expect(response.code).toBe('FORM_DEFINITION_INVALID');
    expect(response.details.map((issue) => issue.field)).toContain(field);
  });

  it('rejects anything that is not a schema object', () => {
    expect(issuesOfSchema(null).code).toBe('FORM_DEFINITION_INVALID');
    expect(issuesOfSchema('text').code).toBe('FORM_DEFINITION_INVALID');
  });
});

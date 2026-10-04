import {
  ClinicalModuleDefinition,
  decimal,
  integer,
  legacySchema,
  longText,
  scale,
  section,
  table,
  text,
} from '../module-builders';

const physiotherapy = (
  definition: Omit<ClinicalModuleDefinition, 'scope' | 'specialtyCode' | 'renderer'>,
): ClinicalModuleDefinition => ({
  ...definition,
  scope: 'SPECIALTY',
  specialtyCode: 'PHYSIOTHERAPY',
  renderer: 'FORM',
});

export const PHYSIOTHERAPY_MODULES: ClinicalModuleDefinition[] = [
  physiotherapy({
    moduleKey: 'physiotherapy.assessment',
    name: 'Valoración funcional',
    description: 'Diagnóstico funcional, dolor, movilidad, rangos articulares y fuerza.',
    schemaVersion: 1,
    schema: {
      sections: [
        section('assessment', 'Valoración', [
          longText('reason', 'Motivo de consulta'),
          longText('functionalDiagnosis', 'Diagnóstico funcional', { required: true }),
          scale('painLevel', 'Dolor (0 a 10)', 0, 10, { required: true }),
          text('painLocation', 'Localización del dolor', { maxLength: 200 }),
          longText('mobility', 'Movilidad'),
        ]),
        section('measurements', 'Mediciones', [
          table(
            'jointRanges',
            'Rangos articulares',
            [
              text('joint', 'Articulación', { required: true, maxLength: 100 }),
              text('movement', 'Movimiento', { required: true, maxLength: 100 }),
              decimal('degrees', 'Grados', { required: true, min: 0, max: 360 }),
            ],
            { maxRows: 40 },
          ),
          table(
            'muscleStrength',
            'Fuerza muscular (0 a 5)',
            [
              text('muscleGroup', 'Grupo muscular', { required: true, maxLength: 100 }),
              integer('grade', 'Grado', { required: true, min: 0, max: 5 }),
            ],
            { maxRows: 40 },
          ),
          longText('functionalTests', 'Pruebas funcionales'),
        ]),
      ],
    },
  }),

  physiotherapy({
    moduleKey: 'physiotherapy.evolution',
    name: 'Evolución de sesión',
    description: 'Registro anterior a las definiciones de módulo.',
    schemaVersion: 1,
    legacy: true,
    schema: legacySchema({
      painLevel: 'Nivel de dolor (0-10)',
      mobility: 'Movilidad',
      progress: 'Evolución',
    }),
  }),
  physiotherapy({
    moduleKey: 'physiotherapy.evolution',
    name: 'Evolución de sesión',
    description: 'Estado subjetivo, hallazgos, intervención, respuesta y dolor antes y después.',
    schemaVersion: 2,
    schema: {
      sections: [
        section('session', 'Sesión', [
          longText('subjective', 'Estado subjetivo'),
          longText('objective', 'Hallazgos objetivos'),
          longText('intervention', 'Intervención', { required: true }),
          longText('response', 'Respuesta del paciente'),
          scale('painBefore', 'Dolor antes (0 a 10)', 0, 10),
          scale('painAfter', 'Dolor después (0 a 10)', 0, 10),
        ]),
      ],
    },
  }),

  physiotherapy({
    moduleKey: 'physiotherapy.exercise-plans',
    name: 'Plan de ejercicios',
    description: 'Registro anterior a las definiciones de módulo.',
    schemaVersion: 1,
    legacy: true,
    schema: legacySchema({
      exercises: 'Ejercicios',
      frequency: 'Frecuencia',
      repetitions: 'Repeticiones',
    }),
  }),
  physiotherapy({
    moduleKey: 'physiotherapy.exercise-plans',
    name: 'Plan de ejercicios',
    description: 'Ejercicios con instrucciones, series, repeticiones o duración y frecuencia.',
    schemaVersion: 2,
    schema: {
      sections: [
        section('plan', 'Plan de ejercicios', [
          table(
            'exercises',
            'Ejercicios',
            [
              text('name', 'Ejercicio', { required: true, maxLength: 200 }),
              text('instructions', 'Instrucciones', { maxLength: 500 }),
              integer('sets', 'Series', { min: 1, max: 50 }),
              integer('repetitions', 'Repeticiones', { min: 1, max: 1000 }),
              decimal('durationMinutes', 'Duración (min)', { min: 0, max: 600 }),
              text('frequency', 'Frecuencia', { required: true, maxLength: 100 }),
            ],
            { minRows: 1, maxRows: 40 },
          ),
          longText('indications', 'Indicaciones generales'),
        ]),
      ],
    },
  }),
];

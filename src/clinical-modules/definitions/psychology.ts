import { FormField } from '../../clinical-forms/form-schema';
import {
  calculated,
  ClinicalModuleDefinition,
  date,
  decimal,
  legacySchema,
  longText,
  multiselect,
  scale,
  section,
  select,
  table,
  text,
} from '../module-builders';

const psychology = (
  definition: Omit<ClinicalModuleDefinition, 'scope' | 'specialtyCode' | 'renderer'>,
): ClinicalModuleDefinition => ({
  ...definition,
  scope: 'SPECIALTY',
  specialtyCode: 'PSYCHOLOGY',
  renderer: 'FORM',
});

// PHQ-9 and GAD-7 share the same answer scale over the last two weeks.
const FREQUENCY_OPTIONS = [
  { value: '0', label: 'Nunca' },
  { value: '1', label: 'Varios días' },
  { value: '2', label: 'Más de la mitad de los días' },
  { value: '3', label: 'Casi todos los días' },
];

const questionnaire = (labels: string[]): FormField[] =>
  labels.map((label, index) =>
    scale(`q${index + 1}`, `${index + 1}. ${label}`, 0, 3, {
      required: true,
      options: FREQUENCY_OPTIONS,
    }),
  );

const sumOf = (count: number) =>
  `sum(${Array.from({ length: count }, (_, index) => `q${index + 1}`).join(', ')})`;

export const PSYCHOLOGY_MODULES: ClinicalModuleDefinition[] = [
  psychology({
    moduleKey: 'psychology.session-notes',
    name: 'Nota de sesión',
    description: 'Motivo, observaciones, intervención, evolución y recomendaciones de la sesión.',
    schemaVersion: 1,
    schema: {
      sections: [
        section('session', 'Sesión', [
          longText('reason', 'Motivo de la sesión', { required: true }),
          longText('observations', 'Observaciones'),
          longText('intervention', 'Intervención', { required: true }),
          longText('evolution', 'Evolución'),
          longText('recommendations', 'Recomendaciones'),
        ]),
      ],
    },
  }),

  psychology({
    moduleKey: 'psychology.assessments',
    name: 'Evaluación psicológica',
    description: 'Registro anterior a las definiciones de módulo.',
    schemaVersion: 1,
    legacy: true,
    schema: legacySchema({
      testName: 'Nombre de prueba',
      score: 'Puntaje',
      interpretation: 'Interpretación',
    }),
  }),
  psychology({
    moduleKey: 'psychology.assessments',
    name: 'Evaluación psicológica',
    description: 'Instrumento aplicado, fecha, puntaje, escala e interpretación.',
    schemaVersion: 2,
    schema: {
      sections: [
        section('assessment', 'Evaluación', [
          select(
            'instrument',
            'Instrumento',
            {
              BDI_II: 'BDI-II',
              BAI: 'BAI',
              PHQ_9: 'PHQ-9',
              GAD_7: 'GAD-7',
              COLUMBIA: 'Columbia (C-SSRS)',
              MCMI: 'MCMI',
              GHQ: 'GHQ',
              SACS: 'SACS',
              OTRO: 'Otro',
            },
            { required: true },
          ),
          text('instrumentName', 'Nombre del instrumento', {
            help: 'Complétalo cuando el instrumento sea «Otro».',
            maxLength: 200,
          }),
          date('applicationDate', 'Fecha de aplicación', { required: true }),
          decimal('score', 'Puntaje', { required: true }),
          text('scaleRange', 'Escala', { help: 'Por ejemplo: 0 a 63.', maxLength: 100 }),
          longText('interpretation', 'Interpretación', { required: true }),
        ]),
      ],
    },
  }),

  psychology({
    moduleKey: 'psychology.mental-exam',
    name: 'Examen mental',
    description: 'Exploración del estado mental del paciente.',
    schemaVersion: 1,
    schema: {
      sections: [
        section('exam', 'Examen mental', [
          longText('appearance', 'Apariencia y conducta'),
          select('consciousness', 'Conciencia', {
            ALERTA: 'Alerta',
            SOMNOLIENTO: 'Somnoliento',
            OBNUBILADO: 'Obnubilado',
            ESTUPOROSO: 'Estuporoso',
          }),
          multiselect('orientation', 'Orientación conservada', {
            TIEMPO: 'Tiempo',
            ESPACIO: 'Espacio',
            PERSONA: 'Persona',
          }),
          longText('attention', 'Atención y concentración'),
          longText('memory', 'Memoria'),
          longText('language', 'Lenguaje'),
          longText('thought', 'Pensamiento'),
          longText('perception', 'Sensopercepción'),
          longText('mood', 'Estado de ánimo y afecto'),
          select('insight', 'Conciencia de enfermedad', {
            COMPLETA: 'Completa',
            PARCIAL: 'Parcial',
            AUSENTE: 'Ausente',
          }),
          longText('judgment', 'Juicio'),
        ]),
        section('risk', 'Riesgo', [
          select(
            'risk',
            'Riesgo para sí o para terceros',
            { NINGUNO: 'Ninguno', BAJO: 'Bajo', MODERADO: 'Moderado', ALTO: 'Alto' },
            { required: true },
          ),
          longText('riskDetail', 'Detalle del riesgo'),
        ]),
      ],
      alerts: [
        {
          when: "risk == 'ALTO'",
          level: 'critical',
          message: 'Riesgo alto registrado en el examen mental.',
        },
        {
          when: "risk == 'MODERADO'",
          level: 'warning',
          message: 'Riesgo moderado registrado en el examen mental.',
        },
      ],
    },
  }),

  psychology({
    moduleKey: 'psychology.treatment-plan',
    name: 'Plan terapéutico',
    description: 'Hipótesis diagnóstica, objetivos, intervenciones, progreso y próximos pasos.',
    schemaVersion: 1,
    schema: {
      sections: [
        section('plan', 'Plan terapéutico', [
          longText('hypothesis', 'Hipótesis diagnóstica'),
          table(
            'objectives',
            'Objetivos',
            [
              text('objective', 'Objetivo', { required: true, maxLength: 300 }),
              text('intervention', 'Intervención', { maxLength: 300 }),
              select(
                'progress',
                'Progreso',
                { NO_INICIADO: 'No iniciado', EN_PROGRESO: 'En progreso', LOGRADO: 'Logrado' },
                { required: true },
              ),
            ],
            { minRows: 1, maxRows: 30 },
          ),
          longText('nextSteps', 'Próximos pasos'),
        ]),
      ],
    },
  }),

  psychology({
    moduleKey: 'psychology.phq9',
    name: 'PHQ-9',
    description: 'Cuestionario de salud del paciente para síntomas depresivos (últimas 2 semanas).',
    schemaVersion: 1,
    schema: {
      sections: [
        section(
          'items',
          'Durante las últimas 2 semanas, ¿con qué frecuencia le han molestado estos problemas?',
          questionnaire([
            'Poco interés o placer en hacer las cosas',
            'Sentirse desanimado/a, deprimido/a o sin esperanza',
            'Problemas para dormir, mantenerse dormido/a o dormir demasiado',
            'Sentirse cansado/a o con poca energía',
            'Poco apetito o comer en exceso',
            'Sentirse mal consigo mismo/a, o sentir que es un fracaso',
            'Dificultad para concentrarse',
            'Moverse o hablar muy despacio, o estar muy inquieto/a',
            'Pensamientos de que estaría mejor muerto/a o de hacerse daño',
          ]),
        ),
        section('result', 'Resultado', [
          calculated('total', 'Puntaje total', sumOf(9)),
          longText('interpretation', 'Interpretación clínica'),
        ]),
      ],
      alerts: [
        {
          when: 'q9 >= 1',
          level: 'critical',
          message: 'El ítem 9 reporta ideas de muerte o autolesión: evaluar el riesgo.',
        },
        {
          when: 'total >= 20',
          level: 'critical',
          message: 'PHQ-9 ≥ 20: síntomas depresivos graves.',
        },
        {
          when: 'total >= 15 and total < 20',
          level: 'warning',
          message: 'PHQ-9 entre 15 y 19: síntomas depresivos moderadamente graves.',
        },
        {
          when: 'total >= 10 and total < 15',
          level: 'info',
          message: 'PHQ-9 entre 10 y 14: síntomas depresivos moderados.',
        },
      ],
    },
  }),

  psychology({
    moduleKey: 'psychology.gad7',
    name: 'GAD-7',
    description: 'Escala del trastorno de ansiedad generalizada (últimas 2 semanas).',
    schemaVersion: 1,
    schema: {
      sections: [
        section(
          'items',
          'Durante las últimas 2 semanas, ¿con qué frecuencia le han molestado estos problemas?',
          questionnaire([
            'Sentirse nervioso/a, ansioso/a o con los nervios de punta',
            'No poder dejar de preocuparse o controlar la preocupación',
            'Preocuparse demasiado por diferentes cosas',
            'Dificultad para relajarse',
            'Estar tan inquieto/a que es difícil permanecer sentado/a',
            'Molestarse o irritarse fácilmente',
            'Sentir miedo, como si algo terrible fuera a pasar',
          ]),
        ),
        section('result', 'Resultado', [
          calculated('total', 'Puntaje total', sumOf(7)),
          longText('interpretation', 'Interpretación clínica'),
        ]),
      ],
      alerts: [
        { when: 'total >= 15', level: 'critical', message: 'GAD-7 ≥ 15: ansiedad grave.' },
        {
          when: 'total >= 10 and total < 15',
          level: 'warning',
          message: 'GAD-7 entre 10 y 14: ansiedad moderada.',
        },
      ],
    },
  }),
];

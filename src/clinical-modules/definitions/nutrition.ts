import {
  calculated,
  ClinicalModuleDefinition,
  decimal,
  integer,
  legacySchema,
  longText,
  section,
  table,
  text,
} from '../module-builders';

const nutrition = (
  definition: Omit<ClinicalModuleDefinition, 'scope' | 'specialtyCode' | 'renderer'>,
): ClinicalModuleDefinition => ({
  ...definition,
  scope: 'SPECIALTY',
  specialtyCode: 'NUTRITION',
  renderer: 'FORM',
});

export const NUTRITION_MODULES: ClinicalModuleDefinition[] = [
  nutrition({
    moduleKey: 'nutrition.assessments',
    name: 'Evaluación antropométrica',
    description: 'Registro anterior a las definiciones de módulo.',
    schemaVersion: 1,
    legacy: true,
    schema: legacySchema({ weightKg: 'Peso (kg)', heightCm: 'Altura (cm)', bmi: 'IMC' }),
  }),
  nutrition({
    moduleKey: 'nutrition.assessments',
    name: 'Evaluación antropométrica',
    description: 'Peso, altura, IMC calculado, circunferencias, pliegues y composición corporal.',
    schemaVersion: 2,
    schema: {
      sections: [
        section('measures', 'Medidas', [
          decimal('weightKg', 'Peso', { unit: 'kg', min: 1, max: 500, required: true }),
          decimal('heightCm', 'Altura', { unit: 'cm', min: 30, max: 250, required: true }),
          calculated('bmi', 'IMC', 'round(weightKg / ((heightCm / 100) ^ 2), 2)', {
            unit: 'kg/m²',
          }),
          decimal('waistCm', 'Perímetro de cintura', { unit: 'cm', min: 1, max: 300 }),
          decimal('hipCm', 'Perímetro de cadera', { unit: 'cm', min: 1, max: 300 }),
        ]),
        section('composition', 'Composición corporal', [
          decimal('bodyFatPct', 'Grasa corporal', { unit: '%', min: 0, max: 100 }),
          decimal('muscleMassPct', 'Masa muscular', { unit: '%', min: 0, max: 100 }),
          table(
            'skinfolds',
            'Pliegues cutáneos',
            [
              text('site', 'Sitio', { required: true, maxLength: 100 }),
              decimal('millimeters', 'Medida (mm)', { required: true, min: 0, max: 200 }),
            ],
            { maxRows: 20 },
          ),
          longText('observations', 'Observaciones'),
        ]),
      ],
    },
  }),

  nutrition({
    moduleKey: 'nutrition.food-history',
    name: 'Historia alimentaria',
    description: 'Alergias, intolerancias, restricciones, hábitos y objetivos del paciente.',
    schemaVersion: 1,
    schema: {
      sections: [
        section('history', 'Historia alimentaria', [
          longText('allergies', 'Alergias alimentarias'),
          longText('intolerances', 'Intolerancias'),
          longText('restrictions', 'Restricciones'),
          longText('habits', 'Hábitos alimentarios', { required: true }),
          integer('mealsPerDay', 'Comidas al día', { min: 1, max: 12 }),
          decimal('waterLitersPerDay', 'Agua al día', { unit: 'L', min: 0, max: 15 }),
          longText('physicalActivity', 'Actividad física'),
          longText('goals', 'Objetivos', { required: true }),
        ]),
      ],
    },
  }),

  nutrition({
    moduleKey: 'nutrition.diet-plans',
    name: 'Plan nutricional',
    description: 'Registro anterior a las definiciones de módulo.',
    schemaVersion: 1,
    legacy: true,
    schema: legacySchema({
      dailyCalories: 'Calorías diarias',
      meals: 'Comidas sugeridas',
      dietaryGoals: 'Objetivos alimenticios',
    }),
  }),
  nutrition({
    moduleKey: 'nutrition.diet-plans',
    name: 'Plan nutricional',
    description: 'Calorías diarias y comidas con horario, alimentos e indicaciones.',
    schemaVersion: 2,
    schema: {
      sections: [
        section('plan', 'Plan nutricional', [
          integer('dailyCalories', 'Calorías diarias', {
            unit: 'kcal',
            min: 300,
            max: 10000,
            required: true,
          }),
          longText('dietaryGoals', 'Objetivo nutricional', { required: true }),
          table(
            'meals',
            'Comidas',
            [
              text('name', 'Comida', { required: true, maxLength: 100 }),
              { key: 'time', label: 'Horario', type: 'time' },
              {
                key: 'foods',
                label: 'Alimentos',
                type: 'textarea',
                required: true,
                maxLength: 1000,
              },
              text('instructions', 'Indicaciones', { maxLength: 500 }),
            ],
            { minRows: 1, maxRows: 15 },
          ),
          longText('indications', 'Indicaciones generales'),
        ]),
      ],
    },
  }),
];

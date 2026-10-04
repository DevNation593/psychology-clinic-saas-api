import { buildDemoSpecialtyScenarios } from '../prisma/demo-specialty-scenarios';

describe('demo specialty seed scenarios', () => {
  it('provides a professional login and a patient case for every catalog specialty', () => {
    const scenarios = buildDemoSpecialtyScenarios();

    expect(
      scenarios.map(({ key, code, professional, patient, appointment }) => ({
        key,
        code,
        role: professional.role,
        email: professional.email,
        patientName: `${patient.firstName} ${patient.lastName}`,
        appointmentTitle: appointment.title,
      })),
    ).toEqual([
      {
        key: 'psychology',
        code: 'PSYCHOLOGY',
        role: 'PROFESIONAL',
        email: 'psic.ana@psic.com',
        patientName: 'Valeria Ortega',
        appointmentTitle: 'Sesión de seguimiento de ansiedad',
      },
      {
        key: 'nutrition',
        code: 'NUTRITION',
        role: 'PROFESIONAL',
        email: 'nutri.luis@psic.com',
        patientName: 'Camila Naranjo',
        appointmentTitle: 'Evaluación nutricional inicial',
      },
      {
        key: 'physiotherapy',
        code: 'PHYSIOTHERAPY',
        role: 'PROFESIONAL',
        email: 'fisio.sofia@psic.com',
        patientName: 'Andrés Mora',
        appointmentTitle: 'Rehabilitación de rodilla',
      },
      {
        key: 'dentistry',
        code: 'DENTISTRY',
        role: 'PROFESIONAL',
        email: 'odonto.carlos@psic.com',
        patientName: 'Lucía Torres',
        appointmentTitle: 'Evaluación odontológica',
      },
    ]);

    expect(new Set(scenarios.map(({ professional }) => professional.email)).size).toBe(4);
    expect(scenarios.every(({ appointment }) => appointment.title.trim().length > 0)).toBe(true);
  });

  it('includes displayable examples for every enabled specialty module', () => {
    const scenarios = buildDemoSpecialtyScenarios();
    const records = Object.fromEntries(
      scenarios.flatMap(({ records }) =>
        records.map(({ moduleKey, data }) => [moduleKey, Object.keys(data).sort()]),
      ),
    );

    expect(records).toEqual({
      'psychology.assessments': ['interpretation', 'score', 'testName'],
      'nutrition.assessments': ['bmi', 'heightCm', 'weightKg'],
      'nutrition.diet-plans': ['dailyCalories', 'dietaryGoals', 'meals'],
      'physiotherapy.evolution': ['mobility', 'painLevel', 'progress'],
      'physiotherapy.exercise-plans': ['exercises', 'frequency', 'repetitions'],
      'dentistry.treatments': ['procedure', 'tooth', 'treatmentStatus'],
      'dentistry.odontogram': ['findings', 'surfaces'],
    });
  });
});

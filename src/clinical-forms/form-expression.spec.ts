import {
  evaluateExpression,
  ExpressionError,
  parseExpression,
  referencedFields,
} from './form-expression';

const evaluate = (source: string, scope: Record<string, unknown> = {}) =>
  evaluateExpression(parseExpression(source), scope);

describe('form expressions', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['2 ^ 3 ^ 2', 512],
    ['-2 ^ 2', -4],
    ['10 / 4', 2.5],
    ['round(10 / 3, 2)', 3.33],
    ['round(2.5)', 3],
    ['sum(1, 2, 3)', 6],
    ['avg(2, 4)', 3],
    ['min(4, 2, 9)', 2],
    ['max(4, 2, 9)', 9],
    ['abs(0 - 5)', 5],
  ])('computes %s', (source, expected) => {
    expect(evaluate(source)).toBe(expected);
  });

  it('reads fields from the data', () => {
    expect(
      evaluate('round(weightKg / ((heightCm / 100) ^ 2), 1)', { weightKg: 70, heightCm: 170 }),
    ).toBe(24.2);
  });

  it('yields null instead of failing when an operand is missing or the divisor is zero', () => {
    expect(evaluate('weightKg / heightCm', { weightKg: 70 })).toBeNull();
    expect(evaluate('sum(a, b)', { a: 1 })).toBeNull();
    expect(evaluate('a / b', { a: 1, b: 0 })).toBeNull();
  });

  it.each([
    ['total >= 20', { total: 20 }, true],
    ['total >= 20', { total: 19 }, false],
    ['total >= 20', {}, false],
    ['total >= 10 and total < 15', { total: 12 }, true],
    ['total >= 10 and total < 15', { total: 15 }, false],
    ['systolic >= 180 or diastolic >= 120', { systolic: 120, diastolic: 125 }, true],
    ["severity == 'GRAVE'", { severity: 'GRAVE' }, true],
    ["severity == 'GRAVE'", { severity: 'LEVE' }, false],
    ["severity != 'GRAVE'", {}, false],
    ['not (total > 5)', { total: 3 }, true],
    ['active == active', { active: true }, true],
  ])('decides %s with %j', (source, scope, expected) => {
    expect(evaluate(source, scope)).toBe(expected);
  });

  it('ignores values that are not scalars', () => {
    expect(evaluate('rows + 1', { rows: [1, 2] })).toBeNull();
    expect(evaluate('name + 1', { name: 'text' })).toBeNull();
  });

  it('lists the fields an expression reads', () => {
    expect(referencedFields(parseExpression('sum(q1, q2) >= limit and not flag'))).toEqual([
      'q1',
      'q2',
      'limit',
      'flag',
    ]);
  });

  it.each([
    '',
    '1 +',
    '(1 + 2',
    '1 2',
    'unknown(1)',
    'sum()',
    'abs(1, 2)',
    'a; b',
    'process.exit(1)',
    "constructor['x']",
    'and + 1',
    `${'('.repeat(60)}1${')'.repeat(60)}`,
    '1 + '.repeat(200) + '1',
  ])('rejects %p', (source) => {
    expect(() => parseExpression(source)).toThrow(ExpressionError);
  });

  it('never resolves inherited object properties as fields', () => {
    expect(evaluate('constructor', {})).toBeNull();
    expect(evaluate('toString == toString', {})).toBe(false);
  });
});

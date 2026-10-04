import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { DIAGNOSIS_SYSTEMS } from '../src/catalogs/catalogs.service';

export interface DiagnosisCodeRow {
  system: string;
  code: string;
  description: string;
}

/** A small set of frequent CIE-10 codes. The official classification is imported with this script. */
export const STARTER_DIAGNOSIS_CODES = path.join(__dirname, 'data', 'diagnosis-codes.starter.csv');

/** Splits one CSV line; a field in double quotes may contain commas and doubled quotes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  return [...fields, field];
}

/**
 * Reads `system,code,description` rows. The header line is optional. Throws on the first
 * row that is incomplete or names an unknown classification, quoting its line number.
 */
export function parseDiagnosisCsv(text: string): DiagnosisCodeRow[] {
  const rows: DiagnosisCodeRow[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      const [system, code, description] = splitCsvLine(line).map((field) => field.trim());
      if (index === 0 && system.toLowerCase() === 'system') return;
      if (!(DIAGNOSIS_SYSTEMS as readonly string[]).includes(system) || !code || !description) {
        throw new Error(`Línea ${index + 1}: se esperaba «sistema,código,descripción» (${line})`);
      }
      rows.push({ system, code: code.toUpperCase(), description });
    });
  return rows;
}

type CodeDb = Pick<PrismaClient, 'diagnosisCode'>;

/** Adds the codes and refreshes the description of the ones already stored. */
export async function importDiagnosisCodes(db: CodeDb, rows: DiagnosisCodeRow[]): Promise<number> {
  for (const row of rows) {
    await db.diagnosisCode.upsert({
      where: { system_code: { system: row.system, code: row.code } },
      update: { description: row.description, isActive: true },
      create: row,
    });
  }
  return rows.length;
}

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : STARTER_DIAGNOSIS_CODES;
  const rows = parseDiagnosisCsv(fs.readFileSync(file, 'utf8'));
  const db = new PrismaClient();
  try {
    const count = await importDiagnosisCodes(db, rows);
    console.log(`${count} códigos de diagnóstico importados desde ${file}`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

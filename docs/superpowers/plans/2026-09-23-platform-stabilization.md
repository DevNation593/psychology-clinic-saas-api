# Platform Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Dejar API y web con controles de calidad reproducibles, aislamiento multi-tenant verificable, rate limiting realmente activo, pruebas base y CI antes de introducir el nuevo modelo multiespecialidad.

**Architecture:** Esta etapa no cambia aún el modelo clínico. Fortalece la plataforma existente con pruebas de contrato y seguridad, separa la base E2E de cualquier base de desarrollo, corrige violaciones de Hooks en la web y convierte lint, tipos, pruebas y build en puertas automáticas. El diseño funcional rector está en **docs/superpowers/specs/2026-09-23-multispecialty-consulting-design.md**.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest/Supertest, Next.js 14, React 18, ESLint, Vitest, Testing Library y GitHub Actions.

## Alcance y restricciones globales

- Trabajar en los repositorios **api** y **web** sin modificar cambios ajenos.
- Seguir TDD para cada corrección o capacidad nueva: prueba roja, cambio mínimo, prueba verde.
- Usar una base PostgreSQL cuyo nombre contenga un segmento separado test para cualquier limpieza E2E.
- No abrir nuevamente la creación pública de tenants. Los tenants de prueba se crean mediante TenantsService.
- No mezclar todavía cambios de esquema multiespecialidad en esta etapa.
- Mantener commits pequeños por tarea y ejecutar verificación completa al final.
- Una prueba que depende de infraestructura puede saltarse únicamente si documenta el requisito; en CI debe ejecutarse, no saltarse.

---

## Task 1: Restaurar un lint reproducible en la API

**Files:**
- Modify: **api/package.json**
- Modify: **api/package-lock.json**
- Modify if formatter changes them: **api/src/**/*.ts**
- Modify if formatter changes them: **api/test/**/*.ts**
- Test: lint, typecheck, Jest y build existentes

- [ ] **Step 1: Capturar el fallo actual**

Run:

~~~powershell
npm --prefix api run lint
~~~

Expected: ESLint falla antes de analizar código por la resolución incompatible de Ajv 8 dentro de @eslint/eslintrc, o deja evidencia equivalente del árbol roto.

- [ ] **Step 2: Separar comprobación y autocorrección**

En **api/package.json**, reemplazar el script mutante actual por:

~~~json
"lint": "eslint \"{src,apps,libs,test,prisma}/**/*.ts\"",
"lint:fix": "eslint \"{src,apps,libs,test,prisma}/**/*.ts\" --fix"
~~~

- [ ] **Step 3: Eliminar solamente el override global conflictivo**

En **api/package.json**, conservar los overrides de tar y http-proxy-agent, y eliminar:

~~~json
"ajv": "^8.18.0"
~~~

No agregar un override alternativo. Cada consumidor debe resolver la versión declarada por su propio árbol.

- [ ] **Step 4: Regenerar el lockfile e inspeccionar la resolución**

Run:

~~~powershell
npm --prefix api install
npm --prefix api ls ajv @eslint/eslintrc --depth=2
~~~

Expected: @eslint/eslintrc resuelve una rama compatible con Ajv 6; Prisma u otros consumidores pueden conservar Ajv 8 en ramas independientes.

- [ ] **Step 5: Aplicar el formatter una sola vez y comprobar sin mutar**

Run:

~~~powershell
npm --prefix api run lint:fix
npm --prefix api run lint
npx --prefix api tsc --noEmit -p api/tsconfig.json
npm --prefix api test -- --runInBand
npm --prefix api run build
~~~

Expected: todos los comandos terminan con código 0. Revisar cualquier cambio mecánico antes de incluirlo.

- [ ] **Step 6: Commit**

~~~powershell
git -C api add package.json package-lock.json src test prisma
git -C api commit -m "chore(api): restore deterministic linting"
~~~

---

## Task 2: Activar el rate limiting global de NestJS

**Files:**
- Create: **api/src/app.module.spec.ts**
- Modify: **api/src/app.module.ts**
- Test: **api/src/app.module.spec.ts**

- [ ] **Step 1: Escribir la prueba roja de metadatos**

Crear **api/src/app.module.spec.ts**:

~~~typescript
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('registers ThrottlerGuard as a global guard', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) ?? [];

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        }),
      ]),
    );
  });
});
~~~

- [ ] **Step 2: Confirmar que falla**

Run:

~~~powershell
npm --prefix api test -- src/app.module.spec.ts --runInBand
~~~

Expected: FAIL porque AppModule aún no tiene provider APP_GUARD con ThrottlerGuard.

- [ ] **Step 3: Registrar el guard global**

En **api/src/app.module.ts**:

~~~typescript
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
~~~

Agregar al decorador Module, al mismo nivel de controllers e imports:

~~~typescript
providers: [
  {
    provide: APP_GUARD,
    useClass: ThrottlerGuard,
  },
],
~~~

Los guards de autenticación existentes en AuthModule permanecen intactos.

- [ ] **Step 4: Verificar prueba específica y suite**

Run:

~~~powershell
npm --prefix api test -- src/app.module.spec.ts --runInBand
npm --prefix api test -- --runInBand
npm --prefix api run lint
npm --prefix api run build
~~~

Expected: PASS y build exitoso.

- [ ] **Step 5: Commit**

~~~powershell
git -C api add src/app.module.ts src/app.module.spec.ts
git -C api commit -m "fix(api): activate global rate limiting"
~~~

---

## Task 3: Impedir que las pruebas limpien una base no destinada a test

**Files:**
- Create: **api/src/prisma/test-database-safety.ts**
- Create: **api/src/prisma/test-database-safety.spec.ts**
- Modify: **api/src/prisma/prisma.service.ts**
- Create: **api/test/setup-e2e.ts**
- Modify: **api/test/jest-e2e.json**
- Modify: **api/.env.example**

- [ ] **Step 1: Escribir las pruebas rojas del guard de seguridad**

Crear **api/src/prisma/test-database-safety.spec.ts** con estos casos:

~~~typescript
import { assertTestDatabaseSafety } from './test-database-safety';

describe('assertTestDatabaseSafety', () => {
  it('accepts an explicit test database while NODE_ENV is test', () => {
    expect(() =>
      assertTestDatabaseSafety(
        'test',
        'postgresql://postgres:postgres@localhost:5432/psic_clinic_test',
      ),
    ).not.toThrow();
  });

  it.each([
    ['development', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'],
    ['production', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'],
    ['test', 'postgresql://postgres:postgres@localhost:5432/psic_clinic_dev'],
    ['test', undefined],
    ['test', 'not-a-url'],
  ])('rejects unsafe configuration: %s %s', (nodeEnv, databaseUrl) => {
    expect(() => assertTestDatabaseSafety(nodeEnv, databaseUrl)).toThrow(
      'Refusing to clean a non-test database',
    );
  });
});
~~~

- [ ] **Step 2: Confirmar que falla porque aún no existe el módulo**

Run:

~~~powershell
npm --prefix api test -- src/prisma/test-database-safety.spec.ts --runInBand
~~~

Expected: FAIL por módulo no encontrado.

- [ ] **Step 3: Implementar la validación fail-closed**

Crear **api/src/prisma/test-database-safety.ts**:

~~~typescript
const TEST_DATABASE_SEGMENT = /(^|[-_])test($|[-_])/i;

export function assertTestDatabaseSafety(
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = process.env.DATABASE_URL,
): void {
  let databaseName = '';

  if (databaseUrl) {
    try {
      databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    } catch {
      databaseName = '';
    }
  }

  if (nodeEnv !== 'test' || !TEST_DATABASE_SEGMENT.test(databaseName)) {
    throw new Error('Refusing to clean a non-test database');
  }
}
~~~

- [ ] **Step 4: Proteger cleanDatabase**

Importar assertTestDatabaseSafety en **api/src/prisma/prisma.service.ts** y reemplazar el control que solo bloquea production por:

~~~typescript
async cleanDatabase() {
  assertTestDatabaseSafety();
  // conservar la lista ordenada y los deleteMany existentes
}
~~~

Eliminar el comentario que sugiera que cualquier entorno no productivo es seguro.

- [ ] **Step 5: Configurar el entorno E2E antes de cargar AppModule**

Crear **api/test/setup-e2e.ts**:

~~~typescript
import { assertTestDatabaseSafety } from '../src/prisma/test-database-safety';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;

assertTestDatabaseSafety(process.env.NODE_ENV, process.env.DATABASE_URL);
~~~

En **api/test/jest-e2e.json**, agregar:

~~~json
"setupFiles": ["<rootDir>/setup-e2e.ts"]
~~~

En **api/.env.example**, documentar:

~~~dotenv
DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5432/psic_clinic_test"
~~~

- [ ] **Step 6: Verificar aceptación y rechazo**

Run:

~~~powershell
npm --prefix api test -- src/prisma/test-database-safety.spec.ts --runInBand
Remove-Item Env:DATABASE_URL_TEST -ErrorAction SilentlyContinue
npm --prefix api run test:e2e -- --runInBand
~~~

Expected: la prueba unitaria pasa; E2E termina antes de inicializar Nest con Refusing to clean a non-test database.

- [ ] **Step 7: Verificación estática y commit**

Run:

~~~powershell
npm --prefix api run lint
npm --prefix api run build
~~~

~~~powershell
git -C api add src/prisma test .env.example
git -C api commit -m "test(api): protect e2e database cleanup"
~~~

---

## Task 4: Restaurar la prueba E2E de aislamiento multi-tenant

**Files:**
- Create: **api/test/helpers/create-test-tenant.ts**
- Modify: **api/test/tenant-isolation.e2e-spec.ts**
- Modify: **api/README.md**
- Test: **api/test/tenant-isolation.e2e-spec.ts**

- [ ] **Step 1: Crear un helper que use el flujo interno autorizado**

Crear **api/test/helpers/create-test-tenant.ts**. Debe exportar TEST_PASSWORD y una función createTestTenant con esta firma:

~~~typescript
import { TenantType } from '@prisma/client';
import { TenantsService } from '../../src/tenants/tenants.service';

export const TEST_PASSWORD = 'Password123!';

export async function createTestTenant(
  tenantsService: TenantsService,
  sequence: number,
) {
  return tenantsService.create({
    name: 'Tenant ' + sequence + ' Clinic',
    tenantType: TenantType.CLINIC,
    email: 'contact+' + sequence + '@tenant.test',
    adminFirstName: 'Admin',
    adminLastName: String(sequence),
    adminEmail: 'admin+' + sequence + '@tenant.test',
    adminPassword: TEST_PASSWORD,
  });
}
~~~

Si CreateTenantDto usa un enum importado desde otro módulo, ajustar solo el import y mantener el valor CLINIC tipado.

- [ ] **Step 2: Reescribir la preparación del E2E**

En **api/test/tenant-isolation.e2e-spec.ts**:

- Obtener TenantsService desde app después de init.
- Ejecutar prisma.cleanDatabase una sola vez en beforeAll.
- Crear dos tenants con createTestTenant.
- Iniciar sesión solo con email y password; tenantSlug ya no pertenece al contrato.
- Guardar tenant IDs y access tokens.
- No hacer POST público a /api/v1/tenants.

El helper local de login debe ser:

~~~typescript
async function login(email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);

  return response.body.accessToken;
}
~~~

- [ ] **Step 3: Hacer deterministas las tres aserciones**

Mantener tres pruebas:

1. Token del tenant 1 contra una URL del tenant 2 devuelve 403.
2. Token del tenant 1 puede crear y leer su propio paciente.
3. La lista del tenant 1 incluye el ID de su paciente y excluye explícitamente el ID creado en tenant 2.

No inferir aislamiento buscando fragmentos en correos. Comparar IDs exactos.

- [ ] **Step 4: Actualizar el contrato de login documentado**

En **api/README.md**, retirar tenantSlug del ejemplo de login y documentar email + password. La resolución del tenant se hace por la identidad única del usuario.

- [ ] **Step 5: Preparar una base local inequívocamente de pruebas**

Run:

~~~powershell
docker compose -f api/docker-compose.yml up -d postgres
docker compose -f api/docker-compose.yml exec -T postgres createdb -U postgres psic_clinic_test
$env:DATABASE_URL_TEST = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'
$env:DATABASE_URL = $env:DATABASE_URL_TEST
npx --prefix api prisma migrate deploy --schema api/prisma/schema.prisma
~~~

Si createdb informa que ya existe, comprobar que el nombre exacto es psic_clinic_test y continuar. No reutilizar psic_clinic_dev.

- [ ] **Step 6: Ejecutar E2E y verificación completa de API**

Run:

~~~powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL_TEST = 'postgresql://postgres:postgres@localhost:5432/psic_clinic_test'
npm --prefix api run test:e2e -- --runInBand
npm --prefix api test -- --runInBand
npm --prefix api run lint
npm --prefix api run build
~~~

Expected: aislamiento E2E 3/3 PASS y todas las demás puertas PASS.

- [ ] **Step 7: Commit**

~~~powershell
git -C api add test README.md
git -C api commit -m "test(api): restore tenant isolation coverage"
~~~

---

## Task 5: Activar ESLint y corregir las violaciones de Hooks en la web

**Files:**
- Create: **web/.eslintrc.json**
- Modify: **web/package.json**
- Modify: **web/package-lock.json**
- Modify: **web/src/app/(dashboard)/settings/page.tsx**
- Modify: **web/src/app/(dashboard)/admin/team/page.tsx**
- Modify: **web/src/app/(dashboard)/admin/storage/page.tsx**
- Modify: **web/src/components/ui/avatar.tsx**

- [ ] **Step 1: Crear la configuración y scripts no mutantes**

Crear **web/.eslintrc.json**:

~~~json
{
  "extends": ["next/core-web-vitals"]
}
~~~

En **web/package.json**:

~~~json
"lint": "eslint . --ext .js,.jsx,.ts,.tsx --max-warnings=0",
"lint:fix": "eslint . --ext .js,.jsx,.ts,.tsx --fix"
~~~

Ejecutar npm --prefix web install únicamente para actualizar el lockfile si npm lo requiere.

- [ ] **Step 2: Capturar los errores actuales**

Run:

~~~powershell
npm --prefix web run lint
~~~

Expected: FAIL por Hooks condicionales en settings y admin/team, más warnings en storage y avatar.

- [ ] **Step 3: Corregir settings sin actualizaciones durante render**

En **settings/page.tsx**:

- Importar useEffect además de useState.
- Declarar initialized junto con el resto de Hooks y antes de cualquier retorno.
- Mover la sincronización desde settings a este efecto:

~~~typescript
useEffect(() => {
  if (!settings || initialized) {
    return;
  }

  setName(settings.name ?? '');
  setEmail(settings.email ?? '');
  setPhone(settings.phone ?? '');
  setAddress(settings.address ?? '');
  setTimezone(settings.timezone ?? 'America/Guayaquil');
  setInitialized(true);
}, [initialized, settings]);
~~~

Usar los setters y campos reales ya presentes en el archivo; conservar el mismo valor inicial para cada formulario. Eliminar el bloque de setState ejecutado durante render. Todos los Hooks deben ejecutarse antes de retornos por autorización o carga.

- [ ] **Step 4: Corregir admin/team manteniendo los Hooks incondicionales**

En **admin/team/page.tsx**, definir antes de los Hooks:

~~~typescript
const hasTeamModule = isClinicPlan(tenant);
~~~

Invocar useQuery y useMutation siempre. Agregar al query:

~~~typescript
enabled: hasTeamModule,
~~~

Mover el retorno para planes personales después de todos los Hooks. Las mutaciones no se disparan porque la interfaz de equipo no se renderiza cuando hasTeamModule es false.

- [ ] **Step 5: Resolver warnings semánticos**

En **admin/storage/page.tsx**, cambiar el import de Lucide:

~~~typescript
Image as ImageIcon,
~~~

y usar ImageIcon en sus dos ubicaciones.

En **components/ui/avatar.tsx**, mantener img porque acepta URLs remotas configurables por tenant y colocar inmediatamente antes del elemento:

~~~tsx
{/* eslint-disable-next-line @next/next/no-img-element */}
~~~

El alt existente debe permanecer.

- [ ] **Step 6: Verificar web**

Run:

~~~powershell
npm --prefix web run lint
npm --prefix web run type-check
npm --prefix web run build
~~~

Expected: cero errores, cero warnings y build exitoso.

- [ ] **Step 7: Commit**

~~~powershell
git -C web add .eslintrc.json package.json package-lock.json src
git -C web commit -m "chore(web): enforce lint and hook correctness"
~~~

---

## Task 6: Añadir una base de pruebas unitarias para la web

**Files:**
- Modify: **web/package.json**
- Modify: **web/package-lock.json**
- Create: **web/vitest.config.ts**
- Create: **web/src/test/setup.ts**
- Create: **web/src/components/ui/button.test.tsx**
- Create: **web/src/lib/utils.test.ts**
- Modify: **web/README.md**

- [ ] **Step 1: Añadir scripts y dependencias**

Agregar scripts:

~~~json
"test": "vitest run",
"test:watch": "vitest"
~~~

Instalar como devDependencies:

~~~powershell
npm --prefix web install --save-dev vitest@^2.1.9 jsdom@^25.0.1 @vitejs/plugin-react@^4.3.4 @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.3
~~~

- [ ] **Step 2: Configurar Vitest con el alias existente**

Crear **web/vitest.config.ts**:

~~~typescript
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
~~~

Crear **web/src/test/setup.ts**:

~~~typescript
import '@testing-library/jest-dom/vitest';
~~~

- [ ] **Step 3: Escribir primero pruebas rojas del Button**

Crear **web/src/components/ui/button.test.tsx** con dos casos:

- Renderiza children y expone role button.
- disabled impide el click y conserva el atributo disabled.

Usar render, screen y fireEvent de @testing-library/react, una función vi.fn y el Button público actual.

Run:

~~~powershell
npm --prefix web test -- src/components/ui/button.test.tsx
~~~

Si ya pasan sin cambios de producción, eso es correcto: establecen la red base sobre comportamiento existente.

- [ ] **Step 4: Cubrir utilidades puras**

Crear **web/src/lib/utils.test.ts** con cinco aserciones distribuidas en tres casos:

- formatFileSize(0) produce 0 Bytes.
- formatFileSize(1024) produce 1 KB.
- safeJsonParse devuelve el objeto para JSON válido.
- safeJsonParse devuelve el fallback para JSON inválido.
- truncate conserva textos cortos y agrega puntos suspensivos en textos largos según el contrato actual.

Ajustar únicamente los valores esperados al comportamiento público ya implementado; no cambiar la utilidad salvo que una prueba revele una contradicción real.

- [ ] **Step 5: Documentar comandos y puerto real**

En **web/README.md**, documentar:

~~~text
npm run lint
npm run type-check
npm test
npm run build
~~~

Corregir cualquier referencia a puerto 3000: los scripts actuales levantan la aplicación en 4200.

- [ ] **Step 6: Ejecutar todas las puertas de web**

Run:

~~~powershell
npm --prefix web run lint
npm --prefix web run type-check
npm --prefix web test
npm --prefix web run build
~~~

Expected: lint y tipos limpios; 2 archivos de prueba y todas sus pruebas PASS; build exitoso.

- [ ] **Step 7: Commit**

~~~powershell
git -C web add package.json package-lock.json vitest.config.ts src/test src/components/ui/button.test.tsx src/lib/utils.test.ts README.md
git -C web commit -m "test(web): add vitest component baseline"
~~~

---

## Task 7: Automatizar puertas de calidad en CI

**Files:**
- Create: **api/.github/workflows/ci.yml**
- Create: **web/.github/workflows/ci.yml**

- [ ] **Step 1: Crear CI de API con PostgreSQL de pruebas**

Crear **api/.github/workflows/ci.yml** con:

- Eventos push y pull_request.
- Ubuntu latest y Node 20.
- Servicio postgres:15 con usuario postgres, contraseña postgres, base psic_clinic_test, puerto 5432 y health check.
- Variables DATABASE_URL y DATABASE_URL_TEST apuntando exclusivamente a psic_clinic_test.
- Variables JWT_SECRET y JWT_REFRESH_SECRET con valores de prueba no reutilizados en producción.
- Pasos: checkout, setup-node con cache npm, npm ci, prisma generate, prisma migrate deploy, lint, test --runInBand, test:e2e --runInBand y build.

No usar la base psic_clinic_dev en ningún paso.

- [ ] **Step 2: Crear CI de web**

Crear **web/.github/workflows/ci.yml** con:

- Eventos push y pull_request.
- Ubuntu latest y Node 20.
- Variables NEXT_PUBLIC_API_URL y NEXT_PUBLIC_APP_URL locales y no secretas.
- Pasos: checkout, setup-node con cache npm, npm ci, lint, type-check, test y build.

- [ ] **Step 3: Reproducir localmente los comandos de CI**

Run:

~~~powershell
npm --prefix api ci
npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run build
npm --prefix web ci
npm --prefix web run lint
npm --prefix web run type-check
npm --prefix web test
npm --prefix web run build
~~~

Ejecutar además E2E con DATABASE_URL_TEST segura como en Task 4.

- [ ] **Step 4: Commit por repositorio**

~~~powershell
git -C api add .github/workflows/ci.yml
git -C api commit -m "ci(api): enforce quality and tenant isolation gates"
~~~

~~~powershell
git -C web add .github/workflows/ci.yml
git -C web commit -m "ci(web): enforce lint test and build gates"
~~~

---

## Verificación final de la etapa

- [ ] Confirmar que git status está limpio en api y web.
- [ ] Confirmar que API lint, unit tests, E2E y build pasan desde una instalación limpia.
- [ ] Confirmar que web lint, type-check, tests y build pasan desde una instalación limpia.
- [ ] Confirmar manualmente que E2E se niega a iniciar sin DATABASE_URL_TEST o con psic_clinic_dev.
- [ ] Confirmar que POST público a /api/v1/tenants continúa rechazado sin rol SOPORTE.
- [ ] Registrar resultados exactos de comandos y número de pruebas.
- [ ] Crear el siguiente plan: modelo canónico de roles, ProfessionalProfile, catálogo de especialidades, equipo clínico del paciente y migración de psychologistId a professionalId.



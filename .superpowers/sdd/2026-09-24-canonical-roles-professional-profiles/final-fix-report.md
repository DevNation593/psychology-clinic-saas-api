# Informe final: ola de fixes de ProfessionalProfile

Fecha: 2026-09-25

## Cambios realizados

- API: se agregó PATCH /tenants/:tenantId/users/me antes de PATCH :userId. El endpoint usa @CurrentUser() y un DTO dedicado que acepta solo firstName, lastName, phone y, si ya existe el perfil, professionalTitle, licenseNumber y bio. La actualización se limita al usuario autenticado y al tenant de la ruta; no crea perfiles, ni cambia especialidad o actividad, y refleja título/licencia en los campos heredados de User.
- API: facturación acepta CLIENTE, PSICOLOGO, ADMIN y PROFESIONAL, y mantiene las restricciones por tenant y actividad. Citas acepta PSICOLOGO y PROFESIONAL, conservando las comprobaciones actuales de tenant y actividad.
- Web: usersApi.updateSelf y useUpdateProfile usan el endpoint /users/me con un tipo de entrada limitado. La página envía exactamente datos personales y, para un perfil existente, título/licencia/biografía anidados. Se retiró specializations de tipo, schema, formulario y payload, además de no enviar specialtyId ni isActive.
- Web: se fijó root: true en el .eslintrc.json del worktree para que ESLint no cargue también la configuración ancestro de web/.
- Los minors diferidos no se incluyeron.

## RED / GREEN

API RED — comando:

~~~text
npm test -- --runInBand src/users/users.controller.spec.ts src/users/users.service.spec.ts src/billing/billing.service.spec.ts src/appointments/appointments.service.spec.ts
~~~

Resultado observado antes del cambio: 4 suites fallidas, 17 pruebas fallidas y 7 pasadas. /users/me devolvió 403 para un profesional; UsersService.updateSelf no existía; ADMIN canónico fue rechazado por facturación; PROFESIONAL canónico fue rechazado por citas.

API GREEN — mismo comando después del cambio: 4 suites pasaron, 24 pruebas pasaron. Después se ampliaron los casos de whitelist para cubrir propiedades heredadas y cupos; la suite API completa final pasó 122 pruebas.

Web RED — comando:

~~~text
npm test -- 'src/app/(dashboard)/profile/page.test.tsx' src/hooks/useProfile.test.tsx
~~~

Resultado observado antes del cambio: 2 archivos fallidos, 3 pruebas fallidas. La página enviaba specializations, specialtyId, isActive y campos de perfil duplicados; el hook enviaba el PATCH a /tenants/tenant-1/users/professional-1.

Web GREEN — mismo comando después del cambio: 2 archivos pasaron, 3 pruebas pasaron. El test de página compara el payload completo; el test del hook verifica el path real usado por apiClient.patch.

## Gates finales

API, en api/.worktrees/professional-profiles:

~~~text
npm test -- --runInBand
Test Suites: 13 passed, 13 total
Tests:       1 skipped, 122 passed, 123 total
~~~

~~~text
npm run lint
exit 0; 0 errores y 20 warnings preexistentes de ESLint.
~~~

~~~text
npm run build
exit 0; Prisma Client generado y Nest compilado.
~~~

~~~text
npm run test:e2e -- --runInBand
DATABASE_URL_TEST apuntó a psic_clinic_test; 2 suites y 11 pruebas pasaron.
~~~

npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma respondió No difference detected para psic_clinic_test. El diff de trabajo (git diff --check) pasó.

Web, en web/.worktrees/professional-profiles:

~~~text
npm test
Test Files: 6 passed, 6 total
Tests:      18 passed, 18 total
npm run lint
exit 0
npm run type-check
exit 0
npm run build
exit 0; build de Next completado y 21 rutas generadas.
git diff --check
exit 0
~~~

El primer npm run lint web terminó antes de analizar archivos porque encontró dos copias de @next/next: la del worktree y la heredada desde web/.eslintrc.json. Tras añadir root: true local, el comando contractual npm run lint pasó sin workaround.

## Commits

- API: 17d1c667d308f792bf271c22a310c837dbf8959a — fix(api): allow scoped self profile updates.
- Web: 168bdc384a29e72a81364cf60454bcefdae7244b — fix(web): use self profile update contract.
- Web: 33824f74720b34b5b0ec6a8db0810f42a82c9198 — chore(web): isolate worktree eslint config.

## Concerns

- PostgreSQL respondió en localhost:5432, por lo que se ejecutaron los E2E; no hizo falta Docker. La base psic_clinic_test ya coincidía con el schema, pero conserva una fila fallida de la migración inicial 20260307231530_v2: PostgreSQL reportó 42710, type "UserRole" already exists. prisma migrate status/deploy devuelven P3009 por ese historial previo; el diff de schema no encontró diferencias y los E2E pasaron. No se usó ni limpió psic_clinic_dev.
- Ambos worktrees quedaron limpios después de los commits de código; este informe es el commit documental solicitado.

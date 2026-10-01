import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppointmentsController } from '../../appointments/appointments.controller';
import { AuditLogController } from '../../audit-log/audit-log.controller';
import { BillingController } from '../../billing/billing.controller';
import { ClinicalNotesController } from '../../clinical-notes/clinical-notes.controller';
import { NextSessionPlansController } from '../../next-session-plans/next-session-plans.controller';
import { PatientTeamController } from '../../patient-team/patient-team.controller';
import { PatientsController } from '../../patients/patients.controller';
import { SpecialtiesController } from '../../specialties/specialties.controller';
import { SpecialtyRecordsController } from '../../specialty-records/specialty-records.controller';
import { SubscriptionController } from '../../subscription/subscription.controller';
import { TasksController } from '../../tasks/tasks.controller';
import { TenantSettingsController } from '../../tenant-settings/tenant-settings.controller';
import { TenantsController } from '../../tenants/tenants.controller';
import { UsersController } from '../../users/users.controller';

type Controller = { name: string; prototype: object };

const MASTER = ['MASTER'];
const CLINICAL = ['MASTER', 'PROFESIONAL'];
const TEAM = ['MASTER', 'ASISTENTE', 'PROFESIONAL'];

function handlerRoles(controller: Controller, handler: string): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, (controller.prototype as Record<string, object>)[handler]);
}

function classRoles(controller: Controller): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, controller);
}

describe('role matrix', () => {
  it.each([
    [UsersController, 'create', MASTER],
    [UsersController, 'update', MASTER],
    [UsersController, 'deactivate', MASTER],
    [UsersController, 'activate', MASTER],
    [SubscriptionController, 'upgradePlan', MASTER],
    [SubscriptionController, 'downgradePlan', MASTER],
    [SubscriptionController, 'customizeFeatures', MASTER],
    [TenantsController, 'update', MASTER],
    [TenantsController, 'completeOnboarding', MASTER],
    [TenantSettingsController, 'update', MASTER],
    [SpecialtiesController, 'setSpecialties', MASTER],
    [SpecialtiesController, 'setSpecialtiesLegacy', MASTER],
    [SpecialtiesController, 'updateModule', MASTER],
    [PatientsController, 'remove', MASTER],
    [TasksController, 'remove', MASTER],
    [BillingController, 'createInvoice', CLINICAL],
    [BillingController, 'listInvoices', CLINICAL],
    [BillingController, 'getInvoice', CLINICAL],
    [TasksController, 'create', CLINICAL],
    [TasksController, 'update', CLINICAL],
    [SpecialtyRecordsController, 'create', CLINICAL],
    [ClinicalNotesController, 'findAll', CLINICAL],
    [ClinicalNotesController, 'findOne', CLINICAL],
    [ClinicalNotesController, 'remove', CLINICAL],
    [NextSessionPlansController, 'findAll', CLINICAL],
    [NextSessionPlansController, 'findByPatient', CLINICAL],
    [NextSessionPlansController, 'remove', CLINICAL],
    [ClinicalNotesController, 'create', ['PROFESIONAL']],
    [ClinicalNotesController, 'update', ['PROFESIONAL']],
    [NextSessionPlansController, 'create', ['PROFESIONAL']],
    [NextSessionPlansController, 'update', ['PROFESIONAL']],
    [PatientsController, 'create', TEAM],
    [PatientsController, 'update', TEAM],
  ] as [Controller, string, string[]][])('%p.%s requires %j', (controller, handler, expected) => {
    expect(handlerRoles(controller, handler)).toEqual(expected);
  });

  it.each([
    [AuditLogController, MASTER],
    [AppointmentsController, TEAM],
    [PatientTeamController, TEAM],
  ] as [Controller, string[]][])('%p requires %j on every handler', (controller, expected) => {
    expect(classRoles(controller)).toEqual(expected);
  });

  const controllers: Controller[] = [
    AppointmentsController,
    AuditLogController,
    BillingController,
    ClinicalNotesController,
    NextSessionPlansController,
    PatientTeamController,
    PatientsController,
    SpecialtiesController,
    SpecialtyRecordsController,
    SubscriptionController,
    TasksController,
    TenantSettingsController,
    TenantsController,
    UsersController,
  ];

  // ADMIN is reserved for future use and the legacy names no longer resolve.
  it.each(controllers)('%p grants nothing to ADMIN, CLIENTE or PSICOLOGO', (controller) => {
    const declared = [
      ...(classRoles(controller) ?? []),
      ...Object.getOwnPropertyNames(controller.prototype).flatMap(
        (handler) => handlerRoles(controller, handler) ?? [],
      ),
    ];
    expect(declared).not.toEqual(expect.arrayContaining(['ADMIN']));
    expect(declared).not.toEqual(expect.arrayContaining(['CLIENTE']));
    expect(declared).not.toEqual(expect.arrayContaining(['PSICOLOGO']));
  });
});

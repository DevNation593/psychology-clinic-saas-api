import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConflictException } from '@nestjs/common';

describe('Appointments - Conflict Detection', () => {
  let service: AppointmentsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    patient: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    tenantSettings: {
      findUnique: jest.fn(),
    },
    appointment: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppointmentsService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const futureIso = (minutesFromNow: number) =>
    new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();

  describe('create appointment with conflict detection', () => {
    it('should create appointment when no conflicts', async () => {
      const tenantId = 'tenant-1';
      const createDto = {
        patientId: 'patient-1',
        psychologistId: 'psych-1',
        startTime: futureIso(24 * 60),
        duration: 60,
      };

      mockPrismaService.patient.findFirst.mockResolvedValue({ id: 'patient-1', tenantId });
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'psych-1',
        tenantId,
        role: 'PSYCHOLOGIST',
        isActive: true,
      });
      mockPrismaService.tenantSettings.findUnique.mockResolvedValue({
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
        workingHoursStart: '00:00',
        workingHoursEnd: '23:59',
      });
      mockPrismaService.appointment.findMany.mockResolvedValue([]); // No conflicts
      mockPrismaService.appointment.create.mockResolvedValue({
        id: 'appointment-1',
        ...createDto,
        startTime: new Date(createDto.startTime),
        endTime: new Date(new Date(createDto.startTime).getTime() + 60 * 60000),
      });

      const result = await service.create(tenantId, createDto);

      expect(result).toBeDefined();
      expect(result.id).toBe('appointment-1');
    });

    it('should throw ConflictException when appointment overlaps', async () => {
      const tenantId = 'tenant-1';
      const createDto = {
        patientId: 'patient-1',
        psychologistId: 'psych-1',
        startTime: futureIso(24 * 60),
        duration: 60,
      };

      mockPrismaService.patient.findFirst.mockResolvedValue({ id: 'patient-1', tenantId });
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'psych-1',
        tenantId,
        role: 'PSYCHOLOGIST',
        isActive: true,
      });
      mockPrismaService.tenantSettings.findUnique.mockResolvedValue({
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
        workingHoursStart: '00:00',
        workingHoursEnd: '23:59',
      });

      // Mock existing appointment that conflicts
      const conflictStart = new Date(createDto.startTime);
      conflictStart.setMinutes(conflictStart.getMinutes() - 30);
      const conflictEnd = new Date(createDto.startTime);
      conflictEnd.setMinutes(conflictEnd.getMinutes() + 30);
      mockPrismaService.appointment.findMany.mockResolvedValue([
        {
          id: 'existing-1',
          tenantId,
          psychologistId: 'psych-1',
          startTime: conflictStart,
          endTime: conflictEnd,
          patient: { firstName: 'John', lastName: 'Doe' },
        },
      ]);

      await expect(service.create(tenantId, createDto)).rejects.toThrow(ConflictException);
      expect(mockPrismaService.appointment.create).not.toHaveBeenCalled();
    });

    it('should allow back-to-back appointments (no overlap)', async () => {
      const tenantId = 'tenant-1';
      const createDto = {
        patientId: 'patient-1',
        psychologistId: 'psych-1',
        startTime: futureIso(26 * 60), // Starts in the future
        duration: 60,
      };

      mockPrismaService.patient.findFirst.mockResolvedValue({ id: 'patient-1', tenantId });
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'psych-1',
        tenantId,
        role: 'PSYCHOLOGIST',
        isActive: true,
      });
      mockPrismaService.tenantSettings.findUnique.mockResolvedValue({
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
        workingHoursStart: '00:00',
        workingHoursEnd: '23:59',
      });

      // Mock existing appointment that ends exactly when new one starts
      mockPrismaService.appointment.findMany.mockResolvedValue([]);

      mockPrismaService.appointment.create.mockResolvedValue({
        id: 'appointment-2',
        ...createDto,
        startTime: new Date(createDto.startTime),
        endTime: new Date(new Date(createDto.startTime).getTime() + 60 * 60000),
      });

      const result = await service.create(tenantId, createDto);

      expect(result).toBeDefined();
    });
  });
});

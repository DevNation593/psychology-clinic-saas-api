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
      providers: [
        AppointmentsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create appointment with conflict detection', () => {
    it('should create appointment when no conflicts', async () => {
      const tenantId = 'tenant-1';
      const createDto = {
        patientId: 'patient-1',
        psychologistId: 'psych-1',
        startTime: '2024-12-15T10:00:00Z',
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
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        workingHoursStart: '09:00',
        workingHoursEnd: '18:00',
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
        startTime: '2024-12-15T10:00:00Z',
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
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        workingHoursStart: '09:00',
        workingHoursEnd: '18:00',
      });

      // Mock existing appointment that conflicts
      mockPrismaService.appointment.findMany.mockResolvedValue([
        {
          id: 'existing-1',
          tenantId,
          psychologistId: 'psych-1',
          startTime: new Date('2024-12-15T09:30:00Z'),
          endTime: new Date('2024-12-15T10:30:00Z'),
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
        startTime: '2024-12-15T11:00:00Z', // Starts exactly when previous ends
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
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        workingHoursStart: '09:00',
        workingHoursEnd: '18:00',
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

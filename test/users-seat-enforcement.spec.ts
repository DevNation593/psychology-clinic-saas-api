import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { ForbiddenException } from '@nestjs/common';

describe('Users - Seat Enforcement', () => {
  let service: UsersService;
  let prisma: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    tenantSubscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockAuthService = {
    hashPassword: jest.fn().mockResolvedValue('hashed-password'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create user with PSYCHOLOGIST role', () => {
    it('should allow creating PSYCHOLOGIST when seats are available', async () => {
      const tenantId = 'tenant-1';
      const createUserDto = {
        tenantId,
        email: 'psychologist@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        role: 'PSYCHOLOGIST' as const,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.tenantSubscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tenantId,
        seatsPsychologistsMax: 3,
        seatsPsychologistsUsed: 1,
      });
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-1',
        ...createUserDto,
        password: 'hashed-password',
      });

      const result = await service.create(createUserDto, 'admin-user-id');

      expect(result).toBeDefined();
      expect(result.email).toBe('psychologist@test.com');
      expect(mockPrismaService.tenantSubscription.update).toHaveBeenCalledWith({
        where: { tenantId },
        data: { seatsPsychologistsUsed: { increment: 1 } },
      });
    });

    it('should throw ForbiddenException when seat limit is reached', async () => {
      const tenantId = 'tenant-1';
      const createUserDto = {
        tenantId,
        email: 'psychologist@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        role: 'PSYCHOLOGIST' as const,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.tenantSubscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        tenantId,
        seatsPsychologistsMax: 1,
        seatsPsychologistsUsed: 1, // Already at limit
        planType: 'BASIC',
      });

      await expect(service.create(createUserDto, 'admin-user-id')).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
    });

    it('should allow creating ASSISTANT without checking seats', async () => {
      const tenantId = 'tenant-1';
      const createUserDto = {
        tenantId,
        email: 'assistant@test.com',
        password: 'password123',
        firstName: 'Jane',
        lastName: 'Smith',
        role: 'ASSISTANT' as const,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-2',
        ...createUserDto,
        password: 'hashed-password',
      });

      const result = await service.create(createUserDto, 'admin-user-id');

      expect(result).toBeDefined();
      expect(result.email).toBe('assistant@test.com');
      // Should NOT increment seat count for ASSISTANT
      expect(mockPrismaService.tenantSubscription.update).not.toHaveBeenCalled();
    });
  });
});

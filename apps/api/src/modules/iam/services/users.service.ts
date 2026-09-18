import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CreateUserDto } from '../dto/create-user.dto';
import type { JwtPayload } from '../types/jwt-payload.type';

const userWithRolesInclude = {
  roles: {
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmailWithRoles(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: userWithRolesInclude,
    });
  }

  async findByIdWithRoles(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });
  }

  /** Flattens a user's role→permission graph into a stateless JWT payload. */
  toJwtPayload(
    user: NonNullable<Awaited<ReturnType<UsersService['findByIdWithRoles']>>>,
  ): JwtPayload {
    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      for (const rp of userRole.role.permissions) {
        permissions.add(`${rp.permission.resource}:${rp.permission.action}`);
      }
    }
    return {
      sub: user.id,
      email: user.email,
      roles,
      permissions: Array.from(permissions),
      organizationId: user.organizationId,
      departmentId: user.departmentId,
    };
  }

  async list(params: { skip?: number; take?: number }) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip: params.skip ?? 0,
        take: params.take ?? 25,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          organizationId: true,
          departmentId: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count(),
    ]);
    return { items, total };
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.temporaryPassword, {
      type: argon2.argon2id,
    });

    return this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
        status: 'ACTIVE',
        organizationId: dto.organizationId,
        departmentId: dto.departmentId,
        roles: {
          create: dto.roleIds.map((roleId) => ({ roleId })),
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async recordFailedLogin(
    userId: string,
    lockoutThreshold: number,
    lockoutMinutes: number,
  ) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (user.failedLoginAttempts >= lockoutThreshold) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'LOCKED',
          lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000),
        },
      });
      return true; // locked out on this attempt
    }
    return false;
  }

  async recordSuccessfulLogin(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lastLoginAt: new Date(),
        ...(await this.clearLockIfExpired(userId)),
      },
    });
  }

  private async clearLockIfExpired(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (
      user.status === 'LOCKED' &&
      user.lockedUntil &&
      user.lockedUntil <= new Date()
    ) {
      return { status: 'ACTIVE' as const, lockedUntil: null };
    }
    return {};
  }

  async findByIdOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}

import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UsersService } from '../services/users.service';
import { MfaService } from '../services/mfa.service';
import { SecurityEventsService } from '../services/security-events.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { EnableTotpDto } from '../dto/enable-totp.dto';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload.type';
import { AuditService } from '../../audit/audit.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly mfaService: MfaService,
    private readonly securityEvents: SecurityEventsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Get()
  @RequirePermissions('users:read')
  async list(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.usersService.list({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Post()
  @RequirePermissions('users:create')
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const created = await this.usersService.create(dto);

    await this.securityEvents.record({
      type: 'USER_CREATED',
      userId: actor.sub,
      metadata: { createdUserId: created.id, createdUserEmail: created.email },
    });

    await this.auditService.append({
      eventType: 'USER_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'User',
      resourceId: created.id,
      action: 'create',
      payload: {
        createdUserId: created.id,
        createdUserEmail: created.email,
        roleIds: dto.roleIds,
        organizationId: dto.organizationId ?? null,
        departmentId: dto.departmentId ?? null,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return created;
  }

  @Post('me/mfa/totp/setup')
  async setupTotp(@CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.beginTotpSetup(user.sub, user.email);
  }

  @Post('me/mfa/totp/enable')
  async enableTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnableTotpDto,
  ) {
    const result = await this.mfaService.enableTotp(user.sub, dto.code);
    await this.securityEvents.record({ type: 'MFA_ENABLED', userId: user.sub });
    return result;
  }
}

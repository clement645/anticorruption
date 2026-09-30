import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UsersService } from '../services/users.service';
import { MfaService } from '../services/mfa.service';
import { SecurityEventsService } from '../services/security-events.service';
import { IdentityService } from '../services/identity.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { EnableTotpDto } from '../dto/enable-totp.dto';
import { UploadSigningKeyDto } from '../dto/upload-signing-key.dto';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireStepUp } from '../decorators/require-step-up.decorator';
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
    private readonly identityService: IdentityService,
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

  @Patch(':id')
  @RequirePermissions('users:update')
  @RequireStepUp()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const updated = await this.usersService.update(id, dto, actor.sub);

    await this.securityEvents.record({
      type: 'USER_UPDATED',
      userId: actor.sub,
      metadata: { updatedUserId: id, status: dto.status ?? null },
    });

    await this.auditService.append({
      eventType: 'USER_UPDATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'User',
      resourceId: id,
      action: 'update',
      payload: {
        updatedUserId: id,
        roleIds: dto.roleIds ?? null,
        status: dto.status ?? null,
        organizationId: dto.organizationId ?? null,
        departmentId: dto.departmentId ?? null,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return updated;
  }

  @Get('me/signing-key')
  async getSigningKeyStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.identityService.getStatus(user.sub);
  }

  @Post('me/signing-key')
  async uploadSigningKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadSigningKeyDto,
    @Req() req: Request,
  ) {
    const result = await this.identityService.uploadPublicKey(
      user.sub,
      dto.publicKeyPem,
    );

    await this.securityEvents.record({
      type: 'SIGNING_KEY_ENROLLED',
      userId: user.sub,
      metadata: { keyId: result.keyId },
    });

    await this.auditService.append({
      eventType: 'SIGNING_KEY_ENROLLED',
      actorId: user.sub,
      actorEmail: user.email,
      organizationId: user.organizationId ?? undefined,
      resourceType: 'User',
      resourceId: user.sub,
      action: 'enroll_signing_key',
      payload: { keyId: result.keyId, algorithm: result.algorithm },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
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

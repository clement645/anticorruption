import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RolesService } from '../services/roles.service';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireStepUp } from '../decorators/require-step-up.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload.type';
import { CreateRoleDto, UpdateRoleDto } from '../dto/role.dto';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('roles:read')
  async list() {
    return this.rolesService.list();
  }

  @Post()
  @RequirePermissions('roles:manage')
  @RequireStepUp()
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.rolesService.create(dto, actor, meta(req));
  }

  @Patch(':id')
  @RequirePermissions('roles:manage')
  @RequireStepUp()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.rolesService.update(id, dto, actor, meta(req));
  }

  @Delete(':id')
  @RequirePermissions('roles:manage')
  @RequireStepUp()
  async remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.rolesService.remove(id, actor, meta(req));
  }
}

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

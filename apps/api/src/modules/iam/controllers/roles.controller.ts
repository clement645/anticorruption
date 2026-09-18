import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesService } from '../services/roles.service';
import { RequirePermissions } from '../decorators/permissions.decorator';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('roles:read')
  async list() {
    return this.rolesService.list();
  }
}

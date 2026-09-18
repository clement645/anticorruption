import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SupplierOwnersService } from '../services/supplier-owners.service';
import { AddOwnerDto } from '../dto/add-owner.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('supplier')
@Controller('suppliers')
export class SupplierOwnersController {
  constructor(private readonly ownersService: SupplierOwnersService) {}

  @Get(':id/owners')
  @RequirePermissions('supplier:read_sensitive')
  list(@Param('id') id: string) {
    return this.ownersService.list(id);
  }

  @Post(':id/owners')
  @RequirePermissions('supplier:manage')
  add(
    @Param('id') id: string,
    @Body() dto: AddOwnerDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.ownersService.add(id, dto, actor, meta(req));
  }

  @Post(':id/owners/:ownerId/remove')
  @RequirePermissions('supplier:manage')
  async remove(
    @Param('id') id: string,
    @Param('ownerId') ownerId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.ownersService.remove(id, ownerId, actor, meta(req));
    return { removed: true };
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SupplierProfileService } from '../services/supplier-profile.service';
import { UpdateSupplierProfileDto } from '../dto/update-supplier-profile.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

/**
 * `/suppliers/:id` (GET/POST) is already owned by ProcurementModule's
 * SuppliersController (the minimal create+list+lookup path Phase 6 needs
 * for bidding). This controller deliberately uses only routes that don't
 * collide with it — `/:id/profile` for the extended view, and PATCH/POST
 * sub-paths for mutations — rather than risk two controllers registering
 * the same GET /suppliers/:id.
 */
@ApiTags('supplier')
@Controller('suppliers')
export class SupplierProfileController {
  constructor(private readonly profileService: SupplierProfileService) {}

  @Get(':id/profile')
  @RequirePermissions('supplier:read')
  getProfile(@Param('id') id: string) {
    return this.profileService.getView(id);
  }

  @Patch(':id')
  @RequirePermissions('supplier:manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierProfileDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.profileService.update(id, dto, actor, meta(req));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('supplier:manage')
  suspend(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.profileService.suspend(id, actor, meta(req));
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('supplier:manage')
  reactivate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.profileService.reactivate(id, actor, meta(req));
  }

  @Post(':id/blacklist')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('supplier:manage')
  blacklist(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.profileService.blacklist(id, actor, meta(req));
  }
}

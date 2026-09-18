import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ContractsService } from '../services/contracts.service';
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { CreateContractDto } from '../dto/create-contract.dto';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('contracts')
@Controller('contracts')
@RequirePermissions('contract:read')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
  ) {}

  @Get()
  list() {
    return this.contractsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.contractsService.getView(id);
  }

  @Post()
  @RequirePermissions('contract:manage')
  create(
    @Body() dto: CreateContractDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.contractsService.create(dto, actor, meta(req));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contract:manage')
  activate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.contractsService.activate(id, actor, meta(req));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contract:manage')
  complete(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.contractsService.complete(id, actor, meta(req));
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contract:manage')
  terminate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.contractsService.terminate(id, actor, meta(req));
  }

  @Post(':id/purchase-orders')
  @RequirePermissions('contract:manage')
  createPurchaseOrder(
    @Param('id') contractId: string,
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.purchaseOrdersService.create(contractId, dto, actor, meta(req));
  }
}

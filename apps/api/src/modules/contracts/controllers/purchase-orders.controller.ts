import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { InvoicesService } from '../services/invoices.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('contracts')
@Controller('purchase-orders')
@RequirePermissions('contract:read')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get()
  list(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.purchaseOrdersService.list({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.purchaseOrdersService.getView(id);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contract:manage')
  issue(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.purchaseOrdersService.issue(id, actor, meta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contract:manage')
  cancel(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.purchaseOrdersService.cancel(id, actor, meta(req));
  }

  @Post(':id/invoices')
  @RequirePermissions('invoice:submit')
  createInvoice(
    @Param('id') purchaseOrderId: string,
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.invoicesService.create(purchaseOrderId, dto, actor, meta(req));
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from '../services/payments.service';
import { PaymentApprovalDto } from '../dto/payment-approval.dto';
import { RecordReconciliationDto } from '../dto/record-reconciliation.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('contracts')
@Controller('payment-requests')
@RequirePermissions('payment:read')
export class PaymentRequestsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  list() {
    return this.paymentsService.listRequests();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.paymentsService.getRequestView(id);
  }

  @Post(':id/approvals')
  @RequirePermissions('payment:approve')
  approve(
    @Param('id') id: string,
    @Body() dto: PaymentApprovalDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.paymentsService.castApproval(id, dto, actor, meta(req));
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payment:execute')
  execute(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException(
        'An Idempotency-Key header is required to execute a payment',
      );
    }
    return this.paymentsService.execute(id, idempotencyKey, actor, meta(req));
  }
}

@ApiTags('contracts')
@Controller('payments')
@RequirePermissions('payment:read')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  list() {
    return this.paymentsService.listPayments();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.paymentsService.getPaymentView(id);
  }

  @Post(':id/reconciliations')
  @RequirePermissions('payment:reconcile')
  recordReconciliation(
    @Param('id') id: string,
    @Body() dto: RecordReconciliationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.paymentsService.recordReconciliation(id, dto, actor, meta(req));
  }
}

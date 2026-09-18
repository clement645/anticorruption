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
import { BidsService } from '../services/bids.service';
import { SubmitBidDto } from '../dto/submit-bid.dto';
import { EvaluateBidDto } from '../dto/evaluate-bid.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('procurement')
@Controller('tender-lots')
export class TenderLotBidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Get(':id/bids')
  @RequirePermissions('procurement:read')
  list(@Param('id') id: string) {
    return this.bidsService.listForLot(id);
  }

  @Post(':id/bids')
  @RequirePermissions('procurement:bid')
  submit(
    @Param('id') id: string,
    @Body() dto: SubmitBidDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.bidsService.submit(id, dto, actor, meta(req));
  }
}

@ApiTags('procurement')
@Controller('bids')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Post(':id/evaluate')
  @RequirePermissions('procurement:evaluate')
  evaluate(
    @Param('id') id: string,
    @Body() dto: EvaluateBidDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.bidsService.evaluate(id, dto, actor, meta(req));
  }

  @Post(':id/award')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:award')
  award(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.bidsService.award(id, actor, meta(req));
  }
}

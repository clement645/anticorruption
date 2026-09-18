import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RiskScansService } from '../services/risk-scans.service';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';

@ApiTags('risk')
@Controller('risk-scans')
@RequirePermissions('risk:manage')
export class RiskScansController {
  constructor(private readonly riskScansService: RiskScansService) {}

  @Post('tenders/:id')
  @HttpCode(HttpStatus.OK)
  scanTender(@Param('id') id: string) {
    return this.riskScansService.scanTender(id);
  }

  @Post('organizations/:id')
  @HttpCode(HttpStatus.OK)
  scanOrganization(@Param('id') id: string) {
    return this.riskScansService.scanOrganization(id);
  }

  @Post('suppliers/:id')
  @HttpCode(HttpStatus.OK)
  scanSupplier(@Param('id') id: string) {
    return this.riskScansService.scanSupplier(id);
  }
}

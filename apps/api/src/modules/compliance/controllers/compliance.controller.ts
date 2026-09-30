import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../iam/decorators/public.decorator';
import { COMPLIANCE_RULES } from '../compliance-rules';

/**
 * Public, unauthenticated read access — the entire point of this registry is
 * that a citizen, journalist, or oversight body can see exactly which legal
 * provisions this system's controls implement, without needing an account.
 * Mirrors the @Public() pattern already used by the Phase 12 transparency
 * endpoints.
 */
@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  @Get('rules')
  @Public()
  list() {
    return COMPLIANCE_RULES;
  }
}

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WhistleblowerService } from '../services/whistleblower.service';
import { SubmitReportDto } from '../dto/submit-report.dto';
import { AddEvidenceDto } from '../dto/add-evidence.dto';
import { PostReporterUpdateDto } from '../dto/post-reporter-update.dto';
import { Public } from '../../iam/decorators/public.decorator';

/**
 * Anonymous by design — see schema.prisma comment on `Report` and
 * SECURITY.md § Whistleblower Portal for the full account of what this
 * controller deliberately never collects or logs. `@Public()` at the class
 * level, same as TransparencyController (Phase 12), so a route added here
 * later can never accidentally end up requiring auth by omission. The
 * source IP for every route under this prefix is additionally stripped from
 * the ops-level request log itself — see app.module.ts's pino `serializers`.
 */
@ApiTags('whistleblower-public')
@Controller('public/whistleblower')
@Public()
export class WhistleblowerPublicController {
  constructor(private readonly whistleblower: WhistleblowerService) {}

  @Post('reports')
  submit(@Body() dto: SubmitReportDto) {
    return this.whistleblower.submitReport(dto);
  }

  @Get('reports/:trackingCode')
  getStatus(@Param('trackingCode') trackingCode: string) {
    return this.whistleblower.getStatusByTrackingCode(trackingCode);
  }

  @Post('reports/:trackingCode/evidence')
  addEvidence(
    @Param('trackingCode') trackingCode: string,
    @Body() dto: AddEvidenceDto,
  ) {
    return this.whistleblower.addEvidenceByTrackingCode(trackingCode, dto);
  }

  @Post('reports/:trackingCode/updates')
  addReply(
    @Param('trackingCode') trackingCode: string,
    @Body() dto: PostReporterUpdateDto,
  ) {
    return this.whistleblower.addReporterUpdateByTrackingCode(
      trackingCode,
      dto.message,
    );
  }
}

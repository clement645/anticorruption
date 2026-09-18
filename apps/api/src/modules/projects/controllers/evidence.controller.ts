import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EvidenceService } from '../services/evidence.service';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';

@ApiTags('projects')
@Controller('evidence')
@RequirePermissions('project:read')
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.evidenceService.getView(id);
  }

  /**
   * Returns decrypted content as base64 (matches the same base64-transport
   * convention already used for upload, and for Phase 7's supplier
   * documents) rather than streaming raw bytes — no binary-response
   * precedent exists elsewhere in this JSON API, and introducing one just
   * for this endpoint isn't worth the inconsistency.
   */
  @Get(':id/download')
  download(@Param('id') id: string) {
    return this.evidenceService.download(id);
  }
}

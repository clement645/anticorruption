import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { BlockchainAdapter } from '@bpfmps/blockchain';
import { AuditService } from './audit.service';
import type { EventVerificationResult } from './audit.types';
import { RequirePermissions } from '../iam/decorators/permissions.decorator';
import { BLOCKCHAIN_ADAPTER } from '../blockchain/blockchain.constants';

@ApiTags('audit')
@Controller('audit')
@RequirePermissions('audit:read')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    @Inject(BLOCKCHAIN_ADAPTER) private readonly blockchain: BlockchainAdapter,
  ) {}

  @Get('events')
  list(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('eventType') eventType?: string,
    @Query('actorId') actorId?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    return this.auditService.list({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      eventType,
      actorId,
      resourceType,
      resourceId,
    });
  }

  /**
   * "Transaction reconstruction" (section 55): the full, independently
   * re-verified history of one resource, each event's blockchain anchor
   * status composed in at this layer — same reason as verifyEvent() below
   * (keeps AuditService decoupled from BlockchainAdapter).
   */
  @Get('reconstruct')
  async reconstructResource(
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    if (!resourceType || !resourceId) {
      throw new BadRequestException(
        'resourceType and resourceId are both required',
      );
    }
    const result = await this.auditService.reconstructResource(
      resourceType,
      resourceId,
    );
    const events = await Promise.all(
      result.events.map((v) => this.withBlockchainAnchor(v)),
    );
    return { ...result, events };
  }

  @Get('verify')
  verifyChain() {
    return this.auditService.verifyChain();
  }

  @Get('events/:id')
  getById(@Param('id') id: string) {
    return this.auditService.getById(id);
  }

  /**
   * Composes the audit chain's own verification with the blockchain anchor's
   * verification (section 55's full "transaction reconstruction" checklist)
   * — deliberately at this composition layer rather than inside
   * AuditService, keeping the audit and blockchain services independent of
   * each other (see BlockchainModule's module-doc comment on why, and
   * ARCHITECTURE.md § Blockchain vs. Database on why independence matters).
   */
  @Get('events/:id/verify')
  async verifyEvent(@Param('id') id: string) {
    const auditResult = await this.auditService.verifyEvent(id);
    return this.withBlockchainAnchor(auditResult);
  }

  private async withBlockchainAnchor(auditResult: EventVerificationResult) {
    const blockchainTxRef = auditResult.event.blockchainTxRef;
    if (!blockchainTxRef) {
      return { ...auditResult, blockchainAnchor: { anchored: false } };
    }

    const blockchainResult =
      await this.blockchain.verifyTransaction(blockchainTxRef);
    return {
      ...auditResult,
      blockchainAnchor: {
        anchored: true,
        found: blockchainResult.found,
        chainLinkValid: blockchainResult.chainLinkValid ?? false,
        transaction: blockchainResult.transaction,
        block: blockchainResult.block,
      },
    };
  }
}

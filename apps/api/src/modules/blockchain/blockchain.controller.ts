import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { BlockchainAdapter } from '@bpfmps/blockchain';
import { RequirePermissions } from '../iam/decorators/permissions.decorator';
import { BLOCKCHAIN_ADAPTER } from './blockchain.constants';
import { AnchoringService } from './anchoring.service';

@ApiTags('blockchain')
@Controller('blockchain')
@RequirePermissions('blockchain:read')
export class BlockchainController {
  constructor(
    @Inject(BLOCKCHAIN_ADAPTER) private readonly blockchain: BlockchainAdapter,
    private readonly anchoringService: AnchoringService,
  ) {}

  @Get('health')
  health() {
    return this.blockchain.healthCheck();
  }

  @Get('transactions/:id')
  async getTransaction(@Param('id') id: string) {
    const transaction = await this.blockchain.getTransaction(id);
    if (!transaction) {
      throw new NotFoundException('Blockchain transaction not found');
    }
    return transaction;
  }

  @Get('transactions/:id/verify')
  verifyTransaction(@Param('id') id: string) {
    return this.blockchain.verifyTransaction(id);
  }

  @Get('blocks/:id')
  async getBlock(@Param('id') id: string) {
    const block = await this.blockchain.getBlock(id);
    if (!block) {
      throw new NotFoundException('Block not found');
    }
    return block;
  }

  /**
   * Manually triggers an anchoring run now, instead of waiting for the
   * periodic interval — useful for demos and tests. Requires a stronger
   * permission than read access since it writes to both the ledger and (via
   * AuditService.recordAnchor) audit_events.
   */
  @Post('anchor')
  @RequirePermissions('blockchain:anchor')
  @HttpCode(HttpStatus.OK)
  triggerAnchor() {
    return this.anchoringService.runOnce();
  }
}

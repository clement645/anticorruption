import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccountabilityService } from './accountability.service';
import { Public } from '../iam/decorators/public.decorator';

/**
 * Public, named per-official accountability scorecards. See
 * accountability.types.ts for the deliberate, user-confirmed exception this
 * makes to the Transparency Portal's "no individual identity, anywhere" rule.
 * Same @Public()-at-class-level / no-@RequirePermissions pattern as
 * TransparencyController — protected by the same global ThrottlerGuard, no
 * separate rate-limiting infrastructure needed.
 */
@ApiTags('accountability')
@Controller('public/accountability')
@Public()
export class AccountabilityController {
  constructor(private readonly accountability: AccountabilityService) {}

  @Get('officials')
  list(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.accountability.listScorecards({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('officials/:id')
  async get(@Param('id') id: string) {
    const scorecard = await this.accountability.getScorecard(id);
    if (!scorecard) {
      throw new NotFoundException('No such official');
    }
    return scorecard;
  }
}

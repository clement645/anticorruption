import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TransparencyService } from './transparency.service';
import { Public } from '../iam/decorators/public.decorator';

const SHA256_HEX = /^[0-9a-f]{64}$/i;

function toSkipTake(skip?: string, take?: string) {
  return {
    skip: skip ? Number(skip) : undefined,
    take: take ? Number(take) : undefined,
  };
}

/**
 * The Citizen Transparency Portal (section 12/40): public, unauthenticated,
 * read-only. Every route is @Public() — deliberately at the class level so
 * a route added later here can never accidentally end up requiring auth by
 * omission — and none carries @RequirePermissions, so PermissionsGuard's
 * "no requirement declared, allow through" default applies with no user on
 * the request at all (see PermissionsGuard). Protected by the same global
 * ThrottlerGuard rate limit as every other route (see app.module.ts) — no
 * separate rate-limiting infrastructure was built for this surface, since
 * the existing one already applies regardless of authentication status.
 */
@ApiTags('transparency')
@Controller('public')
@Public()
export class TransparencyController {
  constructor(private readonly transparency: TransparencyService) {}

  @Get('projects')
  listProjects(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.transparency.listProjects({
      search,
      status,
      ...toSkipTake(skip, take),
    });
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string) {
    return this.transparency.getProject(id);
  }

  @Get('tenders')
  listTenders(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.transparency.listTenders({
      search,
      status,
      ...toSkipTake(skip, take),
    });
  }

  @Get('tenders/:id')
  getTender(@Param('id') id: string) {
    return this.transparency.getTender(id);
  }

  @Get('suppliers')
  listSuppliers(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.transparency.listSuppliers({
      search,
      status,
      ...toSkipTake(skip, take),
    });
  }

  @Get('suppliers/:id')
  getSupplier(@Param('id') id: string) {
    return this.transparency.getSupplier(id);
  }

  @Get('budgets')
  listBudgets(
    @Query('organizationId') organizationId?: string,
    @Query('fiscalYearId') fiscalYearId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.transparency.listBudgetLines({
      organizationId,
      fiscalYearId,
      ...toSkipTake(skip, take),
    });
  }

  @Get('verify')
  verifyHash(@Query('hash') hash?: string) {
    if (!hash || !SHA256_HEX.test(hash)) {
      throw new BadRequestException(
        'hash must be a 64-character hexadecimal SHA-256 digest',
      );
    }
    return this.transparency.verifyHash(hash.toLowerCase());
  }
}

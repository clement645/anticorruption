import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../iam/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness probe. Never touches the database — must stay fast and always
   * answer while the process itself is alive. Public: load balancer/orchestrator
   * probes cannot authenticate. See API.md § Phase 1.
   */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  liveness() {
    return this.healthService.getLiveness();
  }

  /**
   * Readiness probe. Verifies the database dependency is actually usable and
   * returns 503 (not a 200 with a misleading body, and not a stack trace) when
   * it is not — see section 30 / SECURITY.md.
   */
  @Public()
  @Get('ready')
  async readiness() {
    const result = await this.healthService.getReadiness();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}

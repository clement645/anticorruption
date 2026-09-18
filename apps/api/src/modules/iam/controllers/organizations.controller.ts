import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrganizationsService } from '../services/organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * Authenticated read access, no dedicated permission required — every
   * authenticated actor needs to browse the org chart to do basic things
   * (pick their department, understand jurisdiction). Creating/editing
   * organizations will require an explicit permission once that mutation
   * endpoint is built.
   */
  @Get()
  async list() {
    return this.organizationsService.list();
  }
}

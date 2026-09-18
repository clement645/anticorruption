import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InspectionsService } from '../services/inspections.service';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';

@ApiTags('projects')
@Controller('inspections')
@RequirePermissions('project:read')
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.inspectionsService.getView(id);
  }
}

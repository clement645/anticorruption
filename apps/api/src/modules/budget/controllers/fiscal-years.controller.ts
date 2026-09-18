import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FiscalYearsService } from '../services/fiscal-years.service';
import { CreateFiscalYearDto } from '../dto/create-fiscal-year.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';

@ApiTags('budget')
@Controller('fiscal-years')
export class FiscalYearsController {
  constructor(private readonly fiscalYearsService: FiscalYearsService) {}

  @Get()
  @RequirePermissions('budget:read')
  list() {
    return this.fiscalYearsService.list();
  }

  @Post()
  @RequirePermissions('budget:manage')
  create(@Body() dto: CreateFiscalYearDto) {
    return this.fiscalYearsService.create(dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:manage')
  activate(@Param('id') id: string) {
    return this.fiscalYearsService.activate(id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:manage')
  close(@Param('id') id: string) {
    return this.fiscalYearsService.close(id);
  }
}

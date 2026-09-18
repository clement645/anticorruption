import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SuppliersService } from '../services/suppliers.service';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';

@ApiTags('procurement')
@Controller('suppliers')
@RequirePermissions('procurement:read')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  list() {
    return this.suppliersService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.suppliersService.getView(id);
  }

  @Post()
  @RequirePermissions('procurement:manage')
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }
}

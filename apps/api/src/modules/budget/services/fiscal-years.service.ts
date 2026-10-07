import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { FiscalYear } from '@bpfmps/database';
import type { CreateFiscalYearDto } from '../dto/create-fiscal-year.dto';
import type { FiscalYearView } from '../budget.types';

function toView(fy: FiscalYear): FiscalYearView {
  return {
    id: fy.id,
    name: fy.name,
    startDate: fy.startDate.toISOString(),
    endDate: fy.endDate.toISOString(),
    status: fy.status,
    createdAt: fy.createdAt.toISOString(),
  };
}

@Injectable()
export class FiscalYearsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateFiscalYearDto): Promise<FiscalYearView> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }
    const fy = await this.prisma.fiscalYear.create({
      data: { name: dto.name, startDate, endDate },
    });
    return toView(fy);
  }

  async list(params: {
    skip?: number;
    take?: number;
  }): Promise<{ items: FiscalYearView[]; total: number }> {
    const [fys, total] = await this.prisma.$transaction([
      this.prisma.fiscalYear.findMany({
        orderBy: { startDate: 'desc' },
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 25, 100),
      }),
      this.prisma.fiscalYear.count(),
    ]);
    return { items: fys.map(toView), total };
  }

  async getByIdOrThrow(id: string): Promise<FiscalYear> {
    const fy = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!fy) {
      throw new NotFoundException('Fiscal year not found');
    }
    return fy;
  }

  async activate(id: string): Promise<FiscalYearView> {
    await this.getByIdOrThrow(id);
    const fy = await this.prisma.fiscalYear.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    return toView(fy);
  }

  async close(id: string): Promise<FiscalYearView> {
    await this.getByIdOrThrow(id);
    const fy = await this.prisma.fiscalYear.update({
      where: { id },
      data: { status: 'CLOSED' },
    });
    return toView(fy);
  }
}

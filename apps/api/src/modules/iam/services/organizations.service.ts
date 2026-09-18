import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.organization.findMany({
      include: { departments: true },
      orderBy: { name: 'asc' },
    });
  }
}

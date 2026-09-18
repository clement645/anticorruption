import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { Supplier } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CreateSupplierDto } from '../dto/create-supplier.dto';
import type { SupplierView } from '../procurement.types';

function toView(supplier: Supplier): SupplierView {
  return {
    id: supplier.id,
    name: supplier.name,
    registrationNumber: supplier.registrationNumber,
    email: supplier.email,
    phone: supplier.phone,
    status: supplier.status,
    createdAt: supplier.createdAt.toISOString(),
  };
}

/**
 * Minimal supplier identity for Phase 6 (just enough for a Bid to reference
 * who submitted it) — Phase 7 (Supplier Management) extends this same table
 * with ownership, documents, compliance, and risk-profile data rather than
 * introducing a second supplier concept. See schema.prisma comment.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSupplierDto): Promise<SupplierView> {
    try {
      const supplier = await this.prisma.supplier.create({ data: dto });
      return toView(supplier);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A supplier with this registration number already exists',
        );
      }
      throw error;
    }
  }

  async list(): Promise<SupplierView[]> {
    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
    return suppliers.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  async getView(id: string): Promise<SupplierView> {
    return toView(await this.getByIdOrThrow(id));
  }
}

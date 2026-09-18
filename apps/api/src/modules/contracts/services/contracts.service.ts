import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { Contract } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateContractDto } from '../dto/create-contract.dto';
import type { ContractView } from '../contracts.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(contract: Contract): ContractView {
  return {
    id: contract.id,
    awardId: contract.awardId,
    supplierId: contract.supplierId,
    organizationId: contract.organizationId,
    allocationId: contract.allocationId,
    commitmentId: contract.commitmentId,
    contractNumber: contract.contractNumber,
    title: contract.title,
    value: contract.value.toString(),
    startDate: contract.startDate.toISOString(),
    endDate: contract.endDate.toISOString(),
    status: contract.status,
    signedById: contract.signedById,
    signedAt: contract.signedAt ? contract.signedAt.toISOString() : null,
    createdAt: contract.createdAt.toISOString(),
  };
}

/**
 * Every field that ties a Contract back to a budget line
 * (organizationId/allocationId/commitmentId) and a winner (supplierId) is
 * derived server-side from the Award's own chain
 * (Award -> TenderLot -> Tender -> ProcurementRequest), never accepted as
 * client input — see schema.prisma comment on Contract for why that matters.
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateContractDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ContractView> {
    const award = await this.prisma.award.findUnique({
      where: { id: dto.awardId },
      include: {
        bid: true,
        tenderLot: {
          include: { tender: { include: { procurementRequest: true } } },
        },
      },
    });
    if (!award) {
      throw new NotFoundException('Award not found');
    }
    const procurementRequest = award.tenderLot.tender.procurementRequest;
    if (!procurementRequest.commitmentId) {
      throw new BadRequestException(
        'The awarded procurement request has no budget commitment — cannot derive a contract budget line',
      );
    }

    let contract: Contract;
    try {
      contract = await this.prisma.contract.create({
        data: {
          awardId: dto.awardId,
          supplierId: award.bid.supplierId,
          organizationId: procurementRequest.organizationId,
          allocationId: procurementRequest.allocationId,
          commitmentId: procurementRequest.commitmentId,
          contractNumber: dto.contractNumber,
          title: dto.title,
          value: new Prisma.Decimal(dto.value),
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          createdById: actor.sub,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This award already has a contract, or the contract number is already in use',
        );
      }
      throw error;
    }

    await this.auditService.append({
      eventType: 'CONTRACT_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Contract',
      resourceId: contract.id,
      action: 'create',
      payload: {
        contractId: contract.id,
        awardId: dto.awardId,
        contractNumber: dto.contractNumber,
        value: dto.value.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(contract);
  }

  async list(): Promise<ContractView[]> {
    const contracts = await this.prisma.contract.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return contracts.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<Contract> {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) {
      throw new NotFoundException('Contract not found');
    }
    return contract;
  }

  async getView(id: string): Promise<ContractView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async activate(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ContractView> {
    const contract = await this.getByIdOrThrow(id);
    if (contract.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot activate a contract in status ${contract.status}`,
      );
    }

    const updated = await this.prisma.contract.update({
      where: { id },
      data: { status: 'ACTIVE', signedById: actor.sub, signedAt: new Date() },
    });

    await this.auditService.append({
      eventType: 'CONTRACT_ACTIVATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Contract',
      resourceId: id,
      action: 'activate',
      payload: { contractId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async complete(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ContractView> {
    const contract = await this.getByIdOrThrow(id);
    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot complete a contract in status ${contract.status}`,
      );
    }

    const updated = await this.prisma.contract.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });

    await this.auditService.append({
      eventType: 'CONTRACT_COMPLETED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Contract',
      resourceId: id,
      action: 'complete',
      payload: { contractId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async terminate(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ContractView> {
    const contract = await this.getByIdOrThrow(id);
    if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot terminate a contract in status ${contract.status}`,
      );
    }

    const updated = await this.prisma.contract.update({
      where: { id },
      data: { status: 'TERMINATED' },
    });

    await this.auditService.append({
      eventType: 'CONTRACT_TERMINATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Contract',
      resourceId: id,
      action: 'terminate',
      payload: { contractId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }
}

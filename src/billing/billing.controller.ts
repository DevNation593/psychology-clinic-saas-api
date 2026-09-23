import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@ApiTags('billing')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/billing')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('invoices')
  @Roles('CLIENTE', 'PSICOLOGO')
  @ApiOperation({ summary: 'Emitir factura electrónica mediante Faktur' })
  createInvoice(@Param('tenantId') tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateInvoiceDto) {
    return this.billingService.createInvoice(tenantId, user.userId, dto);
  }

  @Get('invoices')
  @Roles('CLIENTE', 'PSICOLOGO')
  @ApiOperation({ summary: 'Listar facturas del tenant' })
  listInvoices(@Param('tenantId') tenantId: string) {
    return this.billingService.listInvoices(tenantId);
  }

  @Get('invoices/:invoiceId')
  @Roles('CLIENTE', 'PSICOLOGO')
  @ApiOperation({ summary: 'Consultar una factura' })
  getInvoice(@Param('tenantId') tenantId: string, @Param('invoiceId') invoiceId: string) {
    return this.billingService.getInvoice(tenantId, invoiceId);
  }
}

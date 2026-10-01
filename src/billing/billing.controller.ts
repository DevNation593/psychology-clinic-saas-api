import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
  @Roles('MASTER', 'PROFESIONAL')
  @ApiOperation({ summary: 'Emitir factura electrónica mediante Faktur' })
  createInvoice(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.billingService.createInvoice(tenantId, user.userId, dto);
  }

  @Get('invoices')
  @Roles('MASTER', 'PROFESIONAL')
  @ApiOperation({ summary: 'Listar facturas del tenant' })
  @ApiQuery({ name: 'patientId', required: false })
  listInvoices(@Param('tenantId') tenantId: string, @Query('patientId') patientId?: string) {
    return this.billingService.listInvoices(tenantId, { patientId });
  }

  @Get('invoices/:invoiceId')
  @Roles('MASTER', 'PROFESIONAL')
  @ApiOperation({ summary: 'Consultar una factura' })
  getInvoice(@Param('tenantId') tenantId: string, @Param('invoiceId') invoiceId: string) {
    return this.billingService.getInvoice(tenantId, invoiceId);
  }
}

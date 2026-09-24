import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface FakturInvoiceRequest {
  idempotencyKey: string;
  customer: {
    legalName: string;
    email: string;
    identificationType: string;
    identificationNumber: string;
    address?: string;
  };
  description: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
}

export interface FakturInvoiceResponse {
  externalId?: string;
  accessKey?: string;
  authorizationNumber?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  [key: string]: unknown;
}

export interface FakturConfiguration {
  apiKey: string;
  apiUrl?: string;
  invoicePath?: string;
  environment: string;
  establishment?: string;
  emissionPoint?: string;
  nextSequential?: number;
}

@Injectable()
export class FakturClient {
  private readonly baseUrl = process.env.FAKTUR_API_URL?.replace(/\/$/, '');
  private readonly apiKey = process.env.FAKTUR_API_KEY;
  private readonly invoicePath = process.env.FAKTUR_INVOICE_PATH || '/invoices';
  private readonly timeoutMs = Number(process.env.FAKTUR_TIMEOUT_MS || 15000);

  async issueInvoice(
    payload: FakturInvoiceRequest,
    configuration?: FakturConfiguration,
  ): Promise<FakturInvoiceResponse> {
    const apiKey = configuration?.apiKey || this.apiKey;
    const baseUrl = (configuration?.apiUrl || this.baseUrl)?.replace(/\/$/, '');
    const invoicePath = configuration?.invoicePath || this.invoicePath;
    if (!baseUrl || !apiKey) {
      throw new ServiceUnavailableException(
        'La integración con Faktur no está configurada. Define FAKTUR_API_URL y FAKTUR_API_KEY.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${invoicePath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Idempotency-Key': payload.idempotencyKey,
        },
        body: JSON.stringify({
          ...payload,
          environment: configuration?.environment,
          establishment: configuration?.establishment,
          emissionPoint: configuration?.emissionPoint,
          sequential: configuration?.nextSequential,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new BadGatewayException({
          message: 'Faktur rechazó la emisión del comprobante',
          providerStatus: response.status,
          providerResponse: body,
        });
      }

      return body as FakturInvoiceResponse;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new BadGatewayException(
        'No fue posible conectar con Faktur para emitir el comprobante.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

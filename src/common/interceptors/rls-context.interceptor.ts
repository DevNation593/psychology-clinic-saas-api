import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RlsContextService } from '../../prisma/rls-context.service';

@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  constructor(private readonly rlsContext: RlsContextService) {}

  private getHeaderValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const contextTenantId = user?.tenantId || request.params?.tenantId;
    const contextUserId = user?.userId || this.getHeaderValue(request.headers?.['x-user-id']);
    const contextRole = user?.role || this.getHeaderValue(request.headers?.['x-user-role']);

    return this.rlsContext.run(
      {
        tenantId: contextTenantId,
        userId: contextUserId,
        role: contextRole,
      },
      () => next.handle(),
    );
  }
}

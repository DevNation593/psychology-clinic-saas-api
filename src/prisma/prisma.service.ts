import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RlsContext, RlsContextService } from './rls-context.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private rlsClient: PrismaClient | null = null;

  constructor(private readonly rlsContext: RlsContextService) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.rlsClient = this.$extends({
      query: {
        $allModels: {
          $allOperations: async ({ model, operation, args, query }) => {
            const context = this.rlsContext.get();
            if (!context?.tenantId || context.skipRlsWrap || !model) {
              return query(args);
            }

            return this.rlsContext.withSkipRlsWrap(async () => {
              return this.$transaction(async (tx) => {
                await this.applyRlsContext(tx, context);

                const modelName = `${model.charAt(0).toLowerCase()}${model.slice(1)}`;
                const modelDelegate = (tx as any)[modelName];
                const action = modelDelegate?.[operation];

                if (typeof action !== 'function') {
                  return query(args);
                }

                return action.call(modelDelegate, args);
              });
            });
          },
        },
      },
    }) as unknown as PrismaClient;

    this.bindRlsDelegates();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private bindRlsDelegates() {
    if (!this.rlsClient) {
      return;
    }

    const delegateNames = [
      'tenant',
      'tenantSubscription',
      'tenantSettings',
      'subscriptionEvent',
      'usageMetrics',
      'user',
      'refreshToken',
      'patient',
      'appointment',
      'clinicalNote',
      'task',
      'nextSessionPlan',
      'notificationLog',
      'auditLog',
    ];

    for (const delegateName of delegateNames) {
      (this as any)[delegateName] = (this.rlsClient as any)[delegateName];
    }
  }

  withRlsContext<T>(context: RlsContext, callback: () => Promise<T>): Promise<T> {
    const current = this.rlsContext.get();
    if (current) {
      this.rlsContext.set(context);
      return callback();
    }

    return this.rlsContext.run(context, callback);
  }

  async applyRlsContext(tx: any, context?: RlsContext): Promise<void> {
    const effectiveContext = context || this.rlsContext.get();
    if (!effectiveContext) {
      return;
    }

    if (effectiveContext.tenantId) {
      await tx.$executeRaw`
        SELECT set_config('app.current_tenant_id', ${effectiveContext.tenantId}, true)
      `;
    }

    if (effectiveContext.userId) {
      await tx.$executeRaw`
        SELECT set_config('app.current_user_id', ${effectiveContext.userId}, true)
      `;
    }

    if (effectiveContext.role) {
      await tx.$executeRaw`
        SELECT set_config('app.current_user_role', ${effectiveContext.role}, true)
      `;
    }
  }

  // Helper method to clean database (for testing)
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production');
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => typeof key === 'string' && key[0] !== '_' && key[0] !== '$',
    );

    return Promise.all(
      models.map((modelKey) => {
        return this[modelKey]?.deleteMany?.();
      }),
    );
  }
}

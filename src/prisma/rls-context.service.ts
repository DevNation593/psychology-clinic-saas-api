import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RlsContext {
  tenantId?: string;
  userId?: string;
  role?: string;
  skipRlsWrap?: boolean;
}

@Injectable()
export class RlsContextService {
  private readonly storage = new AsyncLocalStorage<RlsContext>();

  run<T>(context: RlsContext, callback: () => T): T {
    return this.storage.run({ ...context }, callback);
  }

  get(): RlsContext | undefined {
    return this.storage.getStore();
  }

  set(context: Partial<RlsContext>): void {
    const store = this.storage.getStore();
    if (!store) {
      return;
    }
    Object.assign(store, context);
  }

  withSkipRlsWrap<T>(callback: () => Promise<T>): Promise<T> {
    const store = this.storage.getStore();
    if (!store) {
      return callback();
    }

    const previous = store.skipRlsWrap;
    store.skipRlsWrap = true;

    return callback().finally(() => {
      store.skipRlsWrap = previous;
    });
  }
}

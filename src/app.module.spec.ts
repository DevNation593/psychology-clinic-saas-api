import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('registers ThrottlerGuard as a global guard', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) ?? [];

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        }),
      ]),
    );
  });
});

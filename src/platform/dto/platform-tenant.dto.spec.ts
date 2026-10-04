import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ListPlatformTenantsQueryDto } from './platform-tenant.dto';

// Same options as the global pipe in src/main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const metadata: ArgumentMetadata = { type: 'query', metatype: ListPlatformTenantsQueryDto };

describe('ListPlatformTenantsQueryDto through the global ValidationPipe', () => {
  it('keeps isActive=false as false', async () => {
    const result = await pipe.transform({ isActive: 'false' }, metadata);
    expect(result.isActive).toBe(false);
  });

  it('keeps isActive=true as true', async () => {
    const result = await pipe.transform({ isActive: 'true' }, metadata);
    expect(result.isActive).toBe(true);
  });

  it('leaves isActive undefined when omitted', async () => {
    const result = await pipe.transform({}, metadata);
    expect(result.isActive).toBeUndefined();
  });

  it('rejects a non boolean isActive', async () => {
    await expect(pipe.transform({ isActive: 'maybe' }, metadata)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('converts page and pageSize to numbers and applies defaults', async () => {
    const result = await pipe.transform({ page: '3', pageSize: '50' }, metadata);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
    const defaults = await pipe.transform({}, metadata);
    expect(defaults.page).toBe(1);
    expect(defaults.pageSize).toBe(20);
  });

  it('rejects a pageSize above 100', async () => {
    await expect(pipe.transform({ pageSize: '101' }, metadata)).rejects.toMatchObject({
      status: 400,
    });
  });
});

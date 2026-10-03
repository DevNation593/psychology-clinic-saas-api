import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicalCipher, parseClinicalKeys } from './clinical-cipher';

/** The cipher configured from `CLINICAL_ENCRYPTION_KEYS`. Production refuses to start without a key. */
@Injectable()
export class ClinicalCryptoService extends ClinicalCipher {
  constructor(config: ConfigService) {
    const keys = parseClinicalKeys(config.get<string>('CLINICAL_ENCRYPTION_KEYS'));

    if (keys.length === 0) {
      if (config.get<string>('NODE_ENV') === 'production') {
        throw new Error('CLINICAL_ENCRYPTION_KEYS is required in production');
      }
      new Logger(ClinicalCryptoService.name).warn(
        'CLINICAL_ENCRYPTION_KEYS is not set: clinical data is stored in plain text',
      );
    }

    super(keys);
  }
}

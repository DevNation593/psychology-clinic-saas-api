import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { DocumentVerificationService } from './document-verification.service';

@ApiTags('document-verification')
@Controller('public/documents')
export class DocumentVerificationController {
  constructor(private readonly verificationService: DocumentVerificationService) {}

  @Public()
  @Get(':code')
  @ApiOperation({
    summary: 'Check a clinical document by the code printed on it',
    description:
      'Open to anyone holding the document. Returns who issued and signed it and whether it is in force; never its content, and of the patient only the initials.',
  })
  verify(@Param('code') code: string) {
    return this.verificationService.verify(code);
  }
}

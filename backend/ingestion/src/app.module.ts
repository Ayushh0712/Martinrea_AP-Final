import { Module } from '@nestjs/common';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({
  imports: [IngestionModule],
})
export class AppModule {}

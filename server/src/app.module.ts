import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { SearchModule } from './search/search.module';
import { HealthController } from './health.controller';

// Built Angular assets are copied here by scripts/copy-client.js at deploy time.
// When present (production single-service deploy), the API also serves the SPA.
const CLIENT_DIR = join(__dirname, '..', 'public');

const staticModules: DynamicModule[] = existsSync(CLIENT_DIR)
  ? [
      ServeStaticModule.forRoot({
        rootPath: CLIENT_DIR,
        // Let API routes fall through to their controllers.
        exclude: ['/api/{*splat}'],
      }),
    ]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...staticModules,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { RankingService } from './ranking/ranking.service';
import { GithubProvider } from './providers/github.provider';
import { WebProvider } from './providers/web.provider';
import { SOURCE_PROVIDERS } from './providers/source-provider.interface';

@Module({
  controllers: [SearchController],
  providers: [
    SearchService,
    RankingService,
    GithubProvider,
    WebProvider,
    {
      // Collect all concrete providers behind the SourceProvider token so the
      // orchestrator depends only on the abstraction.
      provide: SOURCE_PROVIDERS,
      useFactory: (github: GithubProvider, web: WebProvider) => [github, web],
      inject: [GithubProvider, WebProvider],
    },
  ],
})
export class SearchModule {}

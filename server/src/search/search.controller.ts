import { Body, Controller, Post } from '@nestjs/common';
import { SearchRequestDto } from './dto/search-request.dto';
import { SearchResponse, SearchService } from './search.service';

@Controller('api/search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Post()
  search(@Body() body: SearchRequestDto): Promise<SearchResponse> {
    return this.service.search(body);
  }
}

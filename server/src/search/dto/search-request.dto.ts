import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CandidateSource } from '../models/candidate.model';

export class SearchRequestDto {
  /**
   * Free-form description of the ideal candidate. Used both to build source
   * queries and as the rubric the LLM ranks against.
   */
  @IsString()
  @MaxLength(4000)
  requirements: string;

  /** Hard keywords / tech stack to bias the source queries. */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords: string[] = [];

  /** Optional location filter (city, country, "remote", ...). */
  @IsString()
  @IsOptional()
  @MaxLength(120)
  location?: string;

  /** Which providers to query. */
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['github', 'web'], { each: true })
  sources: CandidateSource[] = ['github'];

  /** Max candidates to return after ranking. */
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit = 15;
}

import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class PositionSizeDto {
  @IsPositive() capital: number;
  @IsNumber() @Min(0.01) @Max(5) riskPct: number;
  @IsPositive() entry: number;
  @IsPositive() stop: number;
  @IsOptional() @IsPositive() target?: number;
  /** when given, market cap and traded value are read from the latest analysis */
  @IsOptional() @IsString() @Matches(/^[A-Z0-9&-]{1,20}$/) symbol?: string;
  @IsOptional() @IsPositive() adtvCr?: number;
  @IsOptional() @IsPositive() marketCapCr?: number;
}

export class WatchDto {
  @IsString() @Matches(/^[A-Z0-9&-]{1,20}$/) symbol: string;
  @IsOptional() @IsPositive() alertPrice?: number;
  @IsOptional() @IsString() @MaxLength(200) zone?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class PositionDto {
  @IsString() @Matches(/^[A-Z0-9&-]{1,20}$/) symbol: string;
  @IsInt() @Min(1) qty: number;
  @IsPositive() entry: number;
  @IsPositive() stop: number;
  @IsOptional() @IsPositive() target?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) openedOn?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class PositionUpdateDto {
  @IsOptional() @IsInt() @Min(1) qty?: number;
  @IsOptional() @IsPositive() stop?: number;
  @IsOptional() @IsPositive() target?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class FlagReviewDto {
  @IsIn(['confirmed', 'resolved', 'suggested']) status: 'confirmed' | 'resolved' | 'suggested';
}

export class FlagDto {
  @IsIn(['accounting', 'governance', 'financial', 'market', 'business']) category: string;
  @IsInt() @Min(1) @Max(3) level: number;
  @IsString() @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(400) link?: string;
}

export class RunDto {
  @IsOptional() @IsString({ each: true }) symbols?: string[];
}

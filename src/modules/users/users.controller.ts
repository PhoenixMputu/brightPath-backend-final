import { Controller, Get } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator.js';
import { ACCESS_TOKEN_COOKIE } from '../auth/auth-cookies.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

export const CURRENT_USER_MESSAGE = 'User retrieved successfully.';

@ApiTags('users')
@ApiCookieAuth(ACCESS_TOKEN_COOKIE)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get the signed-in user',
    description: 'Identified by the `access_token` cookie.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({
    description:
      'Not signed in. `code` is UNAUTHENTICATED, or ACCESS_TOKEN_EXPIRED when the access token must be refreshed.',
  })
  @ApiNotFoundResponse({
    description: 'The account no longer exists. `code` is USER_NOT_FOUND.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded. `code` is TOO_MANY_REQUESTS.',
  })
  async me(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    const data = await this.usersService.findById(user.userId);
    return { message: CURRENT_USER_MESSAGE, data };
  }
}

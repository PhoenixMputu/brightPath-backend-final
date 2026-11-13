import { Injectable } from '@nestjs/common';
import { UserDto } from '../users/dto/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  register(dto: RegisterDto): Promise<UserDto> {
    return this.usersService.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
    });
  }
}

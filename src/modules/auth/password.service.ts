import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * argon2id with the library defaults (64 MiB, 3 iterations, 4 lanes), above
 * the OWASP minimum. The parameters are stored in each hash, so they can be
 * raised later without breaking existing passwords.
 */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}

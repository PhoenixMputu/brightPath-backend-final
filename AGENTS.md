# AGENTS.md

Instructions for any AI agent working on this project. These rules are **mandatory**.

---

## 1. Git workflow (mandatory)

### Git identity (local to this project only)
Before the first commit, configure the identity **for this repository only**:

```bash
git config user.name "Victory Deo"
git config user.username "PhoenixMputu"
git config user.email "victory23tshimbadi@gmail.com"
```

- **Never use `--global`** (or `--system`). Never modify the machine's global Git configuration.
- Check before committing: `git config user.name` and `git config user.email` must return the values above.
- All commits are made with this identity. No other author or co-author.

### Before starting
Always create a new branch from `dev`. Never work directly on `dev` or `main`.

```bash
git checkout dev
git pull origin dev
git checkout -b <type>/<short-description>
```

Naming convention: `feat/...`, `fix/...`, `refactor/...`, `chore/...`, `docs/...`, `test/...`
Examples: `feat/otp-verification`, `fix/refresh-token-expiry`

### While working
- Small, clear commits following Conventional Commits, in English: `feat(auth): add OTP verification endpoint`
- **Never add `Co-Authored-By`** (or any other co-author trailer) to commit messages.
- Never sign a commit on behalf of an agent or AI tool.

### When done
1. Make sure everything passes:
   ```bash
   bun run lint
   bun run test
   bun run build
   ```
2. Merge into `dev`, then delete the branch:
   ```bash
   git checkout dev
   git pull origin dev
   git merge --no-ff <my-branch>
   git branch -d <my-branch>
   ```
3. If the branch was pushed to the remote, delete it there too:
   ```bash
   git push origin --delete <my-branch>
   ```
4. If there is a merge conflict: stop and ask. Do not resolve it blindly.

---

## 2. Stack

- **NestJS** + **TypeScript** (strict)
- **Prisma**: ORM and migrations (PostgreSQL)
- **class-validator** + **class-transformer**: DTO validation
- **@nestjs/config** + **Zod**: environment variables, validated at startup
- **@nestjs/swagger**: API documentation
- **Passport** + **@nestjs/jwt**: authentication (tokens in `httpOnly` cookies)
- **@nestjs/throttler**, **helmet**: security
- **nestjs-pino** (pino): structured logging
- **Redis** (`ioredis`): cache, short-lived data (OTPs, sessions), rate limiting storage
- **BullMQ** (`@nestjs/bullmq`): background jobs, on Redis (only when a feature needs async processing)
- **@nestjs/terminus**: health checks
- **Bun**: package manager and script runner. Do not use npm, yarn or pnpm.

---

## 3. Forbidden

- ❌ **Never `axios`.** Not as a direct dependency, not through a wrapper, and **not `@nestjs/axios`** (`HttpModule` is built on axios). Use native `fetch` for outgoing HTTP calls.
- ❌ No `Co-Authored-By` in commits.
- ❌ No packages with known vulnerabilities.
- ❌ No `any` without a justifying comment.
- ❌ No `console.log` / `console.error`: use the logger (see Logging).
- ❌ No Redis key without a TTL, except when explicitly justified in a comment.
- ❌ No secrets, tokens or credentials in the code, in commits or in logs. Only in `.env` (never committed).
- ❌ No raw SQL built by string concatenation. Use Prisma, or `$queryRaw` with tagged templates only.
- ❌ No `prisma db push` on shared databases: always use migrations.

---

## 4. Installing packages

After **every** package installation, immediately run:

```bash
bun audit
```

- If `bun audit` reports a vulnerability (at any severity): uninstall the package (`bun remove <package>`), try a patched version or an alternative, then run `bun audit` again.
- Never commit a `bun.lock` that contains a vulnerable package.
- Before adding a dependency, check that it is truly needed and not already in the project.

---

## 5. Project structure

```
prisma/
├── schema.prisma
└── migrations/
src/
├── main.ts                 # Bootstrap (global pipes, filters, helmet, CORS, Swagger)
├── app.module.ts
├── config/                 # Env schema (Zod) and typed config namespaces
├── common/                 # Cross-cutting code, shared by all modules
│   ├── decorators/
│   ├── filters/            # Global exception filter
│   ├── guards/
│   ├── interceptors/
│   ├── pipes/
│   └── utils/
├── logger/                 # nestjs-pino config (levels, redaction, request id)
├── prisma/                 # PrismaModule + PrismaService
├── redis/                  # RedisModule + RedisService (ioredis client, key helpers)
├── integrations/           # Clients for external APIs (fetch-based)
└── modules/
    └── <feature>/
        ├── <feature>.module.ts
        ├── <feature>.controller.ts
        ├── <feature>.service.ts
        ├── <feature>.repository.ts   # Prisma queries for this feature (optional)
        ├── dto/                      # Request / response DTOs
        └── <feature>.service.spec.ts
test/                       # e2e tests
```

### Where things go

| Need | Location |
|---|---|
| New business domain | `modules/<feature>/` |
| HTTP route | `<feature>.controller.ts` |
| Business logic | `<feature>.service.ts` |
| Database queries | `<feature>.repository.ts` or the service via `PrismaService` |
| Request / response validation | `dto/` |
| Call to an external API | `integrations/<provider>/` |
| Cache, OTP, short-lived data | `RedisService` from `redis/` |
| Background job | `<feature>.processor.ts` (BullMQ) in the feature module |
| Guard, decorator, filter, pipe used by several modules | `common/` |
| New environment variable | `config/` (schema) + `.env.example` |

### Request flow

```
Controller → Service → Repository / PrismaService → Database
                 ↘ Integration client (fetch) → External API
```

- Controllers are thin: validation via DTOs, then a single service call. No business logic, no Prisma.
- Services hold the business logic and never touch `Request` / `Response` objects.
- Modules talk to each other only through exported services, never by importing another module's internals.

---

## 6. Code conventions

### Language
- **All code is in English**: variable, function, class, file and type names, comments, log messages, error messages, commit messages, branch names.

### Naming
- Files in `kebab-case` with the Nest suffix: `user-profile.service.ts`, `create-user.dto.ts`.
- Classes in `PascalCase`: `UserProfileService`, `CreateUserDto`.
- Routes in `kebab-case` plural nouns: `/users`, `/user-profiles/:id`.

### DTOs and validation
- Every body, query and param has a DTO validated with `class-validator`.
- Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- Never return Prisma models directly: map them to response DTOs (never expose passwords, hashes, internal fields).
- Every DTO is documented with `@ApiProperty` for Swagger.

### Errors
- Throw Nest HTTP exceptions (`NotFoundException`, `ConflictException`, ...) from services.
- A global exception filter returns a consistent shape:
  ```json
  { "statusCode": 404, "code": "USER_NOT_FOUND", "message": "User not found" }
  ```
- `code` is a stable `UPPER_SNAKE_CASE` identifier so the frontend can translate errors. Never change an existing code.
- Never leak stack traces, Prisma errors or internal details in responses.

### Configuration
- All environment variables are validated with Zod at startup: the app must fail fast if one is missing or invalid.
- Access config only through `ConfigService` (typed), never `process.env` directly outside `config/`.
- Every new variable is added to `.env.example` with a placeholder value.

### Database (Prisma)
- Every schema change goes through a migration: `bunx prisma migrate dev --name <description>`.
- Never edit a migration that has already been merged into `dev`.
- Use transactions (`$transaction`) when several writes must succeed or fail together.
- Select only the fields you need; avoid N+1 queries (use `include` / `select` wisely).

### External integrations
- One client per provider in `integrations/<provider>/`, using native `fetch` with a timeout (`AbortSignal.timeout(...)`).
- Check `response.ok`, validate the response body, and map failures to a clear exception.
- Never log full request/response bodies that may contain personal data or secrets.

### Security
- `helmet` enabled, CORS with an explicit origin allowlist and `credentials: true`.
- Auth tokens in `httpOnly`, `secure`, `sameSite` cookies.
- Routes are protected by default (global auth guard); public routes are marked explicitly with a `@Public()` decorator.
- Rate limiting with `@nestjs/throttler`, stricter on sensitive routes (login, OTP, password reset).
- Hash passwords and OTPs (argon2 or bcrypt); never store them in plain text.

### Logging
- **nestjs-pino** is the only logger. It is set with `app.useLogger(app.get(Logger))` in `main.ts`, so Nest's own logs also go through pino.
- In classes, inject `PinoLogger` (with `@InjectPinoLogger(ClassName.name)`) or use Nest's `Logger` with the class name as context. Both end up in pino.
- **Format**: JSON in every environment except local development, where `pino-pretty` may be used (dev dependency only, never in production).
- **Log level** comes from the `LOG_LEVEL` env variable (validated by Zod). Default: `info` in production, `debug` in development.
- **Levels**:
    - `fatal`: the app cannot continue.
    - `error`: unexpected failure, needs attention (include the error object: `logger.error({ err }, "...")`).
    - `warn`: abnormal but handled (retries, external API slow, validation rejected repeatedly).
    - `info`: important business events (user created, payment confirmed, job completed).
    - `debug`: details useful while developing. Never rely on them in production.
- **Structured logs**: put data in the object, not in the message string.
    - ✅ `logger.info({ userId, orderId }, "Order created")`
    - ❌ `logger.info(\`Order ${orderId} created by ${userId}\`)`
- Messages are short, in English, in the past tense for events (`"Payment confirmed"`).
- **Request ID**: every request gets a correlation ID (read from the `x-request-id` header or generated with `crypto.randomUUID()`), attached to every log line of that request and returned in the response header. Pass it to external API calls and BullMQ jobs.
- **Redaction** is configured in pino (`redact`) for at least: `password`, `token`, `accessToken`, `refreshToken`, `otp`, `authorization`, `cookie`, `set-cookie`, `pin`. Add any new sensitive field to that list.
- Never log full request/response bodies, full phone numbers, or other personal data. Mask them when they are needed (`+243*****1234`).
- Automatic HTTP logs (method, URL, status, duration) come from pino-http. Do not add manual logs that duplicate them. Exclude `/health` from automatic HTTP logs.
- Errors are logged once, in the global exception filter (`error` for 5xx, `warn` for unexpected 4xx). Do not log and rethrow the same error at every layer.

### Redis
- One shared connection, provided by `RedisModule` (global) through `RedisService`. Never create `new Redis()` elsewhere.
- Connection from `REDIS_URL` (validated by Zod). Use TLS (`rediss://`) outside local development.
- **Key naming**: `<app>:<domain>:<purpose>:<id>`, in lowercase, separated by `:`. Example: `onboarding:auth:otp:<userId>`. Build keys only with the helpers in `redis/`, never with inline strings.
- **Every key has a TTL** (`SET key value EX <seconds>`). TTL values are named constants, not magic numbers.
- **Cache**: cache-aside pattern (read Redis → on miss, read the database and write to Redis). Invalidate or update the cache whenever the underlying data changes. The app must keep working if Redis is down (fall back to the database, log a `warn`).
- **OTPs and sensitive short-lived data**: store hashed values, never plain text. Delete them after successful use. Track attempts with `INCR` + TTL to limit retries.
- **Rate limiting**: `@nestjs/throttler` uses Redis as its storage, so limits are shared across instances.
- **BullMQ**: queues and workers use their own Redis connection (with `maxRetriesPerRequest: null`, as required by BullMQ). Jobs must be idempotent, have a retry policy with backoff, and remove completed jobs (`removeOnComplete`).
- Never use `KEYS *` in application code: use `SCAN` if iteration is needed.
- Never store whole Prisma models in Redis: store only the fields needed, serialized as JSON.
- The Redis connection is included in the health check (`@nestjs/terminus`).
- Close the Redis connection on app shutdown (`enableShutdownHooks` + `onModuleDestroy`).

### API documentation
- Swagger available at `/docs` (disabled in production unless explicitly enabled).
- Every endpoint has `@ApiTags`, `@ApiOperation` and documented responses, including errors.

### Tests
- Every service has unit tests (`*.service.spec.ts`), with dependencies mocked.
- Critical flows (auth, payments, anything with side effects) have e2e tests in `test/`.
- A bug fix comes with a test that reproduces the bug.

### TypeScript
- Strict mode. No `any`; prefer `unknown` and narrow it.
- Explicit return types on public service and controller methods.

---

## 7. Checklist before merging into `dev`

- [ ] Git identity is configured locally (without `--global`) with the project values
- [ ] I am on a dedicated branch created from `dev`
- [ ] No `axios` or `@nestjs/axios` import
- [ ] Code, comments, logs and commits are in English
- [ ] All inputs validated by DTOs; no Prisma model returned directly
- [ ] Schema changes have a migration; new env variables are in the Zod schema and `.env.example`
- [ ] No secrets or personal data in code, commits or logs; new sensitive fields added to the pino `redact` list
- [ ] Logs are structured (data in the object, not in the message) and use the right level
- [ ] Every Redis key is built with the helpers and has a TTL; cache is invalidated when data changes
- [ ] Swagger docs updated for new or changed endpoints
- [ ] `bun audit` passes with no vulnerabilities
- [ ] `bun run lint`, `bun run test` and `bun run build` pass
- [ ] No `Co-Authored-By` in commits
- [ ] Merged into `dev`, branch deleted (local and remote)
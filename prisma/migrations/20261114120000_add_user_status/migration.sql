-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('INACTIVE', 'ACTIVE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status" "user_status" NOT NULL DEFAULT 'INACTIVE';


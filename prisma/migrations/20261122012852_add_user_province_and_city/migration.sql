/*
  Warnings:

  - Added the required column `city` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `province_id` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "province_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "users_province_id_idx" ON "users"("province_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

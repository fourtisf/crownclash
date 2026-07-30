-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryAt" TIMESTAMP(3),
ADD COLUMN     "recoveryHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_recoveryHash_key" ON "User"("recoveryHash");


-- AlterEnum
ALTER TYPE "OfferApplyTo" ADD VALUE 'ALL_CART';

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Banner_shopId_active_createdAt_idx" ON "Banner"("shopId", "active", "createdAt");

-- CreateIndex
CREATE INDEX "Banner_createdById_idx" ON "Banner"("createdById");

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

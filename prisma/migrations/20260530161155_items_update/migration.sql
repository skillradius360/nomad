/*
  Warnings:

  - You are about to drop the column `availableQuantity` on the `Items` table. All the data in the column will be lost.
  - You are about to drop the column `discount` on the `Items` table. All the data in the column will be lost.
  - You are about to drop the column `discountPercentage` on the `Items` table. All the data in the column will be lost.
  - You are about to drop the column `pricing` on the `Items` table. All the data in the column will be lost.
  - You are about to drop the column `shopId` on the `Items` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "ComboItem" DROP CONSTRAINT "ComboItem_itemId_fkey";

-- DropForeignKey
ALTER TABLE "Items" DROP CONSTRAINT "Items_shopId_fkey";

-- DropForeignKey
ALTER TABLE "MenuItem" DROP CONSTRAINT "MenuItem_itemId_fkey";

-- AlterTable
ALTER TABLE "Items" DROP COLUMN "availableQuantity",
DROP COLUMN "discount",
DROP COLUMN "discountPercentage",
DROP COLUMN "pricing",
DROP COLUMN "shopId",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ShopItem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "pricing" TEXT NOT NULL,
    "discount" INTEGER DEFAULT 0,
    "discountPercentage" DOUBLE PRECISION DEFAULT 0.0,
    "availableQuantity" INTEGER DEFAULT 0,
    "imageUrl" TEXT,
    "description" TEXT,
    "sortOrderId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopItem_shopId_itemId_key" ON "ShopItem"("shopId", "itemId");

-- AddForeignKey
ALTER TABLE "ShopItem" ADD CONSTRAINT "ShopItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopItem" ADD CONSTRAINT "ShopItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ShopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ShopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

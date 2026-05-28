/*
  Warnings:

  - The primary key for the `Order` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PREPARING', 'READY', 'PAYMENT_DONE', 'DONE', 'ORDER_READY');

-- AlterTable
ALTER TABLE "Items" ADD COLUMN     "availableQuantity" INTEGER DEFAULT 0,
ADD COLUMN     "discount" INTEGER DEFAULT 0,
ADD COLUMN     "discountPercentage" DOUBLE PRECISION DEFAULT 0.0;

-- AlterTable
ALTER TABLE "Order" DROP CONSTRAINT "Order_pkey",
ADD COLUMN     "currentOrderStatus" "OrderStatus",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Order_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Order_id_seq";

-- CreateTable
CREATE TABLE "Combo" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "totalPrice" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "finalPrice" INTEGER,
    "percentageDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "cuisineId" TEXT,
    "categoryId" TEXT,
    "comboTypeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "availableQuantity" INTEGER DEFAULT 0,
    "sortOrderId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Combo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboItem" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cuisineId" TEXT,
    "categoryId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComboItem_comboId_itemId_key" ON "ComboItem"("comboId", "itemId");

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_cuisineId_fkey" FOREIGN KEY ("cuisineId") REFERENCES "Cuisine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_comboTypeId_fkey" FOREIGN KEY ("comboTypeId") REFERENCES "ComboType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboType" ADD CONSTRAINT "ComboType_cuisineId_fkey" FOREIGN KEY ("cuisineId") REFERENCES "Cuisine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboType" ADD CONSTRAINT "ComboType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

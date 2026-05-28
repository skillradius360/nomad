/*
  Warnings:

  - A unique constraint covering the columns `[shopId,comboKey]` on the table `Combo` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Combo" ADD COLUMN     "comboKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Combo_shopId_comboKey_key" ON "Combo"("shopId", "comboKey");

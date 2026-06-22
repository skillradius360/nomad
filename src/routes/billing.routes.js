import { Router } from "express";
import {
    createRechargeAmountOption,
    createRechargeDayOption,
    createRechargeRequest,
    deleteRechargeAmountOption,
    deleteRechargeDayOption,
    getBillingConfig,
    getCompanyRevenue,
    getShopBillingLedger,
    getShopRevenueOverview,
    getShopBillingSummary,
    listMyRechargeRequests,
    listRechargeRequests,
    reviewRechargeRequest,
    runDailyBilling,
    syncShopSlots,
    updateBillingConfig
} from "../controllers/billing/billing.controller.js";
import { isAdmin, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { expensiveReadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const billingRouter = Router();

billingRouter.use(verifyJWT);

billingRouter.route("/config")
    .get(getBillingConfig)
    .patch(isAdmin,writeRateLimit,updateBillingConfig);

billingRouter.route("/day-options").post(isAdmin,writeRateLimit,createRechargeDayOption);
billingRouter.route("/day-options/:optionId").delete(isAdmin,writeRateLimit,deleteRechargeDayOption);
billingRouter.route("/amount-options").post(isAdmin,writeRateLimit,createRechargeAmountOption);
billingRouter.route("/amount-options/:optionId").delete(isAdmin,writeRateLimit,deleteRechargeAmountOption);

billingRouter.route("/recharges").post(isSeller,writeRateLimit,createRechargeRequest).get(isAdmin,expensiveReadRateLimit,listRechargeRequests);
billingRouter.route("/recharges/my").get(isSeller,expensiveReadRateLimit,listMyRechargeRequests);
billingRouter.route("/recharges/:rechargeId/review").patch(isAdmin,writeRateLimit,reviewRechargeRequest);

billingRouter.route("/shops/:shopId/summary").get(expensiveReadRateLimit,getShopBillingSummary);
billingRouter.route("/shops/:shopId/revenue").get(isAdmin,expensiveReadRateLimit,getShopRevenueOverview);
billingRouter.route("/shops/:shopId/ledger").get(expensiveReadRateLimit,getShopBillingLedger);
billingRouter.route("/shops/:shopId/sync-slots").post(isAdmin,writeRateLimit,syncShopSlots);

billingRouter.route("/settlements/run").post(isAdmin,writeRateLimit,runDailyBilling);
billingRouter.route("/company-revenue").get(isAdmin,expensiveReadRateLimit,getCompanyRevenue);

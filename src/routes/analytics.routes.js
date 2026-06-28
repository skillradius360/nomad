import { Router } from "express";
import {
    getAdminAnalyticsSummary,
    getAdminAnalyticsTopBuyers,
    getAdminAnalyticsTopShops,
    getAdminAnalyticsTrends,
    getAdminSellerWalletMonitor
} from "../controllers/analytics/analytics.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { adminHeavyRateLimit, expensiveReadRateLimit } from "../middleware/rateLimit.middleware.js";

export const analyticsRouter = Router();

analyticsRouter.use(verifyJWT);

analyticsRouter.route("/admin/summary").get(isAdmin, expensiveReadRateLimit, getAdminAnalyticsSummary);
analyticsRouter.route("/admin/trends").get(isAdmin, expensiveReadRateLimit, getAdminAnalyticsTrends);
analyticsRouter.route("/admin/top-shops").get(isAdmin, expensiveReadRateLimit, getAdminAnalyticsTopShops);
analyticsRouter.route("/admin/top-buyers").get(isAdmin, expensiveReadRateLimit, getAdminAnalyticsTopBuyers);
analyticsRouter.route("/admin/seller-wallet-monitor").get(isAdmin, adminHeavyRateLimit, getAdminSellerWalletMonitor);

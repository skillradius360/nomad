import { Router } from "express";
import { upload } from "../middleware/multer.middleware.js";
import { isAdmin, isAdminOrSeller, isBuyer, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { buyerReadRateLimit, expensiveReadRateLimit, uploadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";
import {
    createShop,
    deleteSeller,
    makeSellerGoLive,
    findFullShopData,
    fetchShopCustomers,
    fetchAllShops,
    setShopTrialPeriod,
    setShopTimings,
    setShopStatus,
    toggleShopAvailability,
    editShopSettings,
    findNearbyShops,
    findByShopSlug,
    
    
    // approveRecharge,
    // createRecharge,
    // getAllRecharges,
    // getPendingRecharges,
} from "../controllers/shop/shop.controller.js";

export const shopRouter = Router();

shopRouter.use(verifyJWT);

shopRouter.route("/").get(buyerReadRateLimit, fetchAllShops);
shopRouter.route("/admin/all").get(isAdmin, expensiveReadRateLimit, fetchAllShops);
shopRouter.route("/start/:shopId").patch(isAdmin, writeRateLimit, makeSellerGoLive);
shopRouter.route("/nearby").get(isBuyer, buyerReadRateLimit, findNearbyShops);
shopRouter.route("/:shopId/customers").get(isAdminOrSeller, expensiveReadRateLimit, fetchShopCustomers);
shopRouter.route("/:shopId/trial").patch(isAdmin, writeRateLimit, setShopTrialPeriod);
shopRouter.route("/:shopId/timings").patch(isAdminOrSeller, writeRateLimit, setShopTimings);
shopRouter.route("/:shopId/status").patch(isAdminOrSeller, writeRateLimit, setShopStatus);
shopRouter.route("/:shopId/availability").patch(isAdminOrSeller, writeRateLimit, toggleShopAvailability);
shopRouter.route("/:shopId/settings").patch(isAdminOrSeller, uploadRateLimit, upload.fields([{ name: "shopimg", maxCount: 1 }]), editShopSettings);
shopRouter.route("/find/:shopId").get(buyerReadRateLimit, findFullShopData);
shopRouter.route("/findshop/:slug").get(buyerReadRateLimit, findByShopSlug);
shopRouter.route("/revoke/:shopId").delete(isAdmin, writeRateLimit, deleteSeller);
shopRouter.route("/create").post(isAdminOrSeller, uploadRateLimit, upload.fields([{ name: "shopimg", maxCount: 1 }]), createShop);



// shopRouter.route("/recharge").post(isSeller, createRecharge);
// shopRouter.route("/recharge/all").get(isAdmin, getAllRecharges);
// shopRouter.route("/recharge/pending").get(isAdmin, getPendingRecharges);
// shopRouter.route("/recharge/:rechargeId/approve").patch(isAdmin, approveRecharge);

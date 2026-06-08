import { Router } from "express";
import { upload } from "../middleware/multer.middleware.js";
import { isAdmin, isAdminOrSeller, isBuyer, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
    createShop,
    deleteSeller,
    makeSellerGoLive,
    findFullShopData,
    setShopTrialPeriod,
    setShopTimings,
    setShopStatus,
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

shopRouter.route("/start/:shopId").patch(isAdmin, makeSellerGoLive);
shopRouter.route("/nearby").get(isBuyer, findNearbyShops);
shopRouter.route("/:shopId/trial").patch(isAdmin, setShopTrialPeriod);
shopRouter.route("/:shopId/timings").patch(isAdminOrSeller, setShopTimings);
shopRouter.route("/:shopId/status").patch(isAdminOrSeller, setShopStatus);
shopRouter.route("/:shopId/settings").patch(isAdminOrSeller, upload.fields([{ name: "shopimg", maxCount: 1 }]), editShopSettings);
shopRouter.route("/find/:shopId").get( findFullShopData);
shopRouter.route("/findshop/:slug").get( findByShopSlug);
shopRouter.route("/revoke/:shopId").delete(isAdmin, deleteSeller);
shopRouter.route("/create").post(isAdminOrSeller, upload.fields([{ name: "shopimg", maxCount: 1 }]), createShop);



// shopRouter.route("/recharge").post(isSeller, createRecharge);
// shopRouter.route("/recharge/all").get(isAdmin, getAllRecharges);
// shopRouter.route("/recharge/pending").get(isAdmin, getPendingRecharges);
// shopRouter.route("/recharge/:rechargeId/approve").patch(isAdmin, approveRecharge);

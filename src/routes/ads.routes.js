import { Router } from "express";
import { createAd, deleteAd, fetchActiveAds, fetchBuyerAds, fetchSellerAds, updateAdActiveStatus } from "../controllers/ad/ad.controller.js";
import {
    createBuyerAd,
    deleteBuyerAd,
    fetchAllBuyerAdsForAdmin,
    fetchBuyerAdByIdForAdmin,
    fetchBuyerSideAds,
    updateBuyerAd,
    updateBuyerAdActiveStatus,
} from "../controllers/ad/buyerAd.controller.js";
import { isAdmin, isBuyer, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/multer.middleware.js";
import { adminHeavyRateLimit, buyerReadRateLimit, expensiveReadRateLimit, uploadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

const adRouter = Router();

adRouter.use(verifyJWT);

const adImageUpload = upload.fields([
    { name: "sellerDashboardImg", maxCount: 1 },
    { name: "sellerHomeImg", maxCount: 1 },
    { name: "buyerExploreImg", maxCount: 1 },
    { name: "buyerShopPageImg", maxCount: 1 },
]);
const buyerAdImageUpload = upload.fields([{ name: "buyerAdImg", maxCount: 1 }]);

adRouter.route("/create").post(uploadRateLimit, adImageUpload, createAd)
adRouter.route("/seller").get(isSeller, expensiveReadRateLimit, fetchSellerAds);
adRouter.route("/buyer").get(isBuyer, buyerReadRateLimit, fetchBuyerAds);
adRouter.route("/buyer-ads").get(isBuyer, buyerReadRateLimit, fetchBuyerSideAds);
adRouter.route("/buyer-ads/admin").post(isAdmin, uploadRateLimit, buyerAdImageUpload, createBuyerAd).get(isAdmin, adminHeavyRateLimit, fetchAllBuyerAdsForAdmin);
adRouter.route("/buyer-ads/admin/:buyerAdId").get(isAdmin, fetchBuyerAdByIdForAdmin).patch(isAdmin, uploadRateLimit, buyerAdImageUpload, updateBuyerAd).delete(isAdmin, writeRateLimit, deleteBuyerAd);
adRouter.route("/buyer-ads/admin/:buyerAdId/active").patch(isAdmin, writeRateLimit, updateBuyerAdActiveStatus);
adRouter.route("/:adId/active").patch(isAdmin, writeRateLimit, updateAdActiveStatus);
adRouter.route("/:adId").delete(isAdmin, writeRateLimit, deleteAd);
adRouter.route("/fetchAll").get(buyerReadRateLimit, fetchActiveAds);

export {adRouter}

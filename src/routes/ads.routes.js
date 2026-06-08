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

const adRouter = Router();

adRouter.use(verifyJWT);

const adImageUpload = upload.fields([
    { name: "sellerDashboardImg", maxCount: 1 },
    { name: "sellerHomeImg", maxCount: 1 },
    { name: "buyerExploreImg", maxCount: 1 },
    { name: "buyerShopPageImg", maxCount: 1 },
]);
const buyerAdImageUpload = upload.fields([{ name: "buyerAdImg", maxCount: 1 }]);

adRouter.route("/create").post( adImageUpload, createAd)
adRouter.route("/seller").get(isSeller, fetchSellerAds);
adRouter.route("/buyer").get(isBuyer, fetchBuyerAds);
adRouter.route("/buyer-ads").get(isBuyer, fetchBuyerSideAds);
adRouter.route("/buyer-ads/admin").post(isAdmin, buyerAdImageUpload, createBuyerAd).get(isAdmin, fetchAllBuyerAdsForAdmin);
adRouter.route("/buyer-ads/admin/:buyerAdId").get(isAdmin, fetchBuyerAdByIdForAdmin).patch(isAdmin, buyerAdImageUpload, updateBuyerAd).delete(isAdmin, deleteBuyerAd);
adRouter.route("/buyer-ads/admin/:buyerAdId/active").patch(isAdmin, updateBuyerAdActiveStatus);
adRouter.route("/:adId/active").patch(isAdmin, updateAdActiveStatus);
adRouter.route("/:adId").delete(isAdmin, deleteAd);
adRouter.route("/fetchAll").get(fetchActiveAds);

export {adRouter}

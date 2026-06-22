import { Router } from "express";
import {
    createBanner,
    deleteBanner,
    fetchPublishedBannersByShop,
    fetchShopBannersForManage,
    updateBanner,
    updateBannerPublishStatus
} from "../controllers/banners/banner.controller.js";
import { isAdminOrSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/multer.middleware.js";
import { buyerReadRateLimit, expensiveReadRateLimit, uploadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const bannerRouter = Router();

bannerRouter.use(verifyJWT);

const bannerImageUpload = upload.fields([{ name:"bannerImg", maxCount:1 }, { name:"image", maxCount:1 }]);

bannerRouter.route("/create").post(isAdminOrSeller,uploadRateLimit,bannerImageUpload,createBanner);
bannerRouter.route("/shop/:shopId/published").get(buyerReadRateLimit,fetchPublishedBannersByShop);
bannerRouter.route("/shop/:shopId/manage").get(isAdminOrSeller,expensiveReadRateLimit,fetchShopBannersForManage);
bannerRouter.route("/:bannerId/publish").patch(isAdminOrSeller,writeRateLimit,updateBannerPublishStatus);
bannerRouter.route("/:bannerId").patch(isAdminOrSeller,uploadRateLimit,bannerImageUpload,updateBanner).delete(isAdminOrSeller,writeRateLimit,deleteBanner);

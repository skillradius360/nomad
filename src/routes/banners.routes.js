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

export const bannerRouter = Router();

bannerRouter.use(verifyJWT);

const bannerImageUpload = upload.fields([{ name:"bannerImg", maxCount:1 }, { name:"image", maxCount:1 }]);

bannerRouter.route("/create").post(isAdminOrSeller,bannerImageUpload,createBanner);
bannerRouter.route("/shop/:shopId/published").get(fetchPublishedBannersByShop);
bannerRouter.route("/shop/:shopId/manage").get(isAdminOrSeller,fetchShopBannersForManage);
bannerRouter.route("/:bannerId/publish").patch(isAdminOrSeller,updateBannerPublishStatus);
bannerRouter.route("/:bannerId").patch(isAdminOrSeller,bannerImageUpload,updateBanner).delete(isAdminOrSeller,deleteBanner);

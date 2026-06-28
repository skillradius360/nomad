import { Router } from "express";
import {
    createOffer,
    deleteOffer,
    duplicateOffer,
    fetchAvailableOffersByShop,
    fetchOfferAnalytics,
    fetchOfferById,
    fetchOfferUsage,
    fetchOffersByShop,
    searchBuyersForOfferTarget,
    updateOffer,
    updateOfferActiveStatus
} from "../controllers/offers/offers.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/multer.middleware.js";
import { buyerReadRateLimit, expensiveReadRateLimit, uploadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const offerRouter = Router();

offerRouter.use(verifyJWT);

const offerImageUpload = upload.fields([{ name: "offerImg", maxCount: 1 }]);

offerRouter.route("/create").post(uploadRateLimit, offerImageUpload, createOffer);
offerRouter.route("/shop/:shopId/available").get(buyerReadRateLimit, fetchAvailableOffersByShop);
offerRouter.route("/shop/:shopId/buyers/search").get(expensiveReadRateLimit, searchBuyersForOfferTarget);
offerRouter.route("/shop/:shopId").get(buyerReadRateLimit, fetchOffersByShop);
offerRouter.route("/:offerId/duplicate").post(writeRateLimit, duplicateOffer);
offerRouter.route("/:offerId/usage").get(expensiveReadRateLimit, fetchOfferUsage);
offerRouter.route("/:offerId/analytics").get(expensiveReadRateLimit, fetchOfferAnalytics);
offerRouter.route("/:offerId/active").patch(writeRateLimit, updateOfferActiveStatus);
offerRouter.route("/:offerId").get(fetchOfferById).patch(uploadRateLimit, offerImageUpload, updateOffer).delete(writeRateLimit, deleteOffer);

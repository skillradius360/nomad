import { Router } from "express";
import {
    createOffer,
    deleteOffer,
    fetchAvailableOffersByShop,
    fetchOfferById,
    fetchOffersByShop,
    searchBuyersForOfferTarget,
    updateOffer,
    updateOfferActiveStatus
} from "../controllers/offers/offers.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/multer.middleware.js";

export const offerRouter = Router();

offerRouter.use(verifyJWT);

const offerImageUpload = upload.fields([{ name: "offerImg", maxCount: 1 }]);

offerRouter.route("/create").post(offerImageUpload, createOffer);
offerRouter.route("/shop/:shopId/available").get(fetchAvailableOffersByShop);
offerRouter.route("/shop/:shopId/buyers/search").get(searchBuyersForOfferTarget);
offerRouter.route("/shop/:shopId").get(fetchOffersByShop);
offerRouter.route("/:offerId/active").patch(updateOfferActiveStatus);
offerRouter.route("/:offerId").get(fetchOfferById).patch(offerImageUpload, updateOffer).delete(deleteOffer);

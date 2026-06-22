import { Router } from "express";
import {
    createShopType,
    deleteShopType,
    deleteShopFeatureOverrides,
    fetchShopFeatureOverrides,
    fetchShopTypeById,
    fetchShopTypes,
    updateShopFeatureOverrides,
    updateShopType
} from "../controllers/shopTypes/shopTypes.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const shopTypeRouter = Router();

shopTypeRouter.use(verifyJWT);

shopTypeRouter.route("/")
    .get(fetchShopTypes)
    .post(isAdmin,writeRateLimit,createShopType);

shopTypeRouter.route("/shops/:shopId/features")
    .get(isAdmin,fetchShopFeatureOverrides)
    .patch(isAdmin,writeRateLimit,updateShopFeatureOverrides)
    .delete(isAdmin,writeRateLimit,deleteShopFeatureOverrides);

shopTypeRouter.route("/:shopTypeId")
    .get(fetchShopTypeById)
    .patch(isAdmin,writeRateLimit,updateShopType)
    .delete(isAdmin,writeRateLimit,deleteShopType);

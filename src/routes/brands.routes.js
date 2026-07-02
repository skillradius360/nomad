import { Router } from "express";
import {
    createBrand,
    deleteBrand,
    fetchBrandById,
    fetchBrands,
    updateBrand
} from "../controllers/brands/brands.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const brandRouter = Router();

brandRouter.use(verifyJWT);

brandRouter.route("/")
    .get(fetchBrands)
    .post(isAdmin,writeRateLimit,createBrand);

brandRouter.route("/:brandId")
    .get(fetchBrandById)
    .patch(isAdmin,writeRateLimit,updateBrand)
    .delete(isAdmin,writeRateLimit,deleteBrand);

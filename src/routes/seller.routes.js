import { Router } from "express";
import {
    createSeller,
    createSellerByAdmin,
    deleteSeller,
    getSellerProfile,
    updateSellerProfile,
} from "../controllers/sellers/seller.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { isAdmin, isAdminOrSeller, isSeller } from "../middleware/admin.middleware.js";
import { writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const sellerRouter = Router();

sellerRouter.use(verifyJWT);

sellerRouter.route("/create/:userId").post(isAdmin, createSellerByAdmin);

sellerRouter.route("/create").post(createSeller);
sellerRouter.route("/me").get(isSeller, getSellerProfile).delete(isSeller, deleteSeller)
sellerRouter.route("/edit").patch(isSeller, writeRateLimit, updateSellerProfile);
sellerRouter.route("/:userId").patch(isAdminOrSeller, writeRateLimit, updateSellerProfile);

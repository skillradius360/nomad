import { Router } from "express";
import {
    createSeller,
    createSellerByAdmin,
    getSellerProfile,
    updateSellerProfile,
} from "../controllers/sellers/seller.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { isAdmin, isSeller } from "../middleware/admin.middleware.js";

export const sellerRouter = Router();

sellerRouter.use(verifyJWT);

sellerRouter.route("/create/:userId").post(isAdmin, createSellerByAdmin);

sellerRouter.route("/create").post(createSeller);
sellerRouter.route("/me").get(isSeller, getSellerProfile)
sellerRouter.route("/edit").patch(isSeller, updateSellerProfile);

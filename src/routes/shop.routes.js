import { Router } from "express";
import { upload } from "../middleware/multer.middleware.js";
import { isAdmin, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
    approveRecharge,
    createRecharge,
    createShop,
    deleteSeller,
    getAllRecharges,
    getPendingRecharges,
    makeSellerGoLive,
    createShopByAdmin
} from "../controllers/shop/shop.controller.js";

export const shopRouter = Router();

shopRouter.use(verifyJWT);

shopRouter.route("/start/:shopId").patch(isAdmin, makeSellerGoLive);
shopRouter.route("/revoke/:shopId").delete(isAdmin, deleteSeller);
shopRouter.route("/create").post(isSeller, upload.fields([{ name: "shopimg", maxCount: 1 }]), createShop);
shopRouter.route("/createAdmin").post(isAdmin, upload.fields([{ name: "shopimg", maxCount: 1 }]), createShopByAdmin);



shopRouter.route("/recharge").post(isSeller, createRecharge);
shopRouter.route("/recharge/all").get(isAdmin, getAllRecharges);
shopRouter.route("/recharge/pending").get(isAdmin, getPendingRecharges);
shopRouter.route("/recharge/:rechargeId/approve").patch(isAdmin, approveRecharge);

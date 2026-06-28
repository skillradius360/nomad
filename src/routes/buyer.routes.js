import { Router } from "express";
import { createBuyer, createBuyerByAdmin, deleteBuyer, editBuyerProfile, getBuyerProfile } from "../controllers/buyers/buyer.controller.js";
import { isAdmin, isAdminOrBuyer, isBuyer } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const buyerRouter = Router();

buyerRouter.use(verifyJWT);

buyerRouter.route("/create/:userId").post(isAdmin, createBuyerByAdmin);


buyerRouter.route("/create").post(createBuyer);
buyerRouter.route("/me").get(isBuyer, getBuyerProfile).patch(isBuyer, writeRateLimit, editBuyerProfile).delete(isBuyer, deleteBuyer);
buyerRouter.route("/:userId").patch(isAdminOrBuyer, writeRateLimit, editBuyerProfile);

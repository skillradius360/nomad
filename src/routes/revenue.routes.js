import { Router } from "express";
import { fetchRepeatCustomersByShop, fetchShopRevenueStats } from "../controllers/revenue/revenue.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const revenueRouter = Router();

revenueRouter.use(verifyJWT);

revenueRouter.route("/shop/:shopId/repeat-customers").get(fetchRepeatCustomersByShop);
revenueRouter.route("/shop/:shopId").get(fetchShopRevenueStats);

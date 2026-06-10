import { Router } from "express";
import {
    cancelOrder,
    confirmOrder,
    createOrder,
    getAllProcessedOrders,
    getMyOrders,
    getSellerOrders,
    getSellerProcessedOrders,
    markPaymentReceived,
    markOrderComplete,
    markOrderReady,
    refundCompletedOrder
} from "../controllers/orders/orders.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const orderRouter = Router();

orderRouter.use(verifyJWT);

orderRouter.route("/checkout").post(createOrder);
orderRouter.route("/my").get(getMyOrders);

orderRouter.route("/seller").get(getSellerOrders);
orderRouter.route("/seller/processed").get(getSellerProcessedOrders);

orderRouter.route("/processed/all").get(getAllProcessedOrders);

orderRouter.route("/:orderId/payment-received").patch(markPaymentReceived);
orderRouter.route("/:orderId/confirm").patch(confirmOrder);
orderRouter.route("/:orderId/ready").patch(markOrderReady);
orderRouter.route("/:orderId/complete").patch(markOrderComplete);
orderRouter.route("/:orderId/cancel").patch(cancelOrder);
orderRouter.route("/:orderId/refund").patch(refundCompletedOrder);

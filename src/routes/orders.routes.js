import { Router } from "express";
import {
    cancelOrder,
    confirmOrder,
    createOrder,
    getAdminOrderHistory,
    getAllProcessedOrders,
    getMyOrders,
    getOrderCurrentStatus,
    getOrderDetails,
    getOrderInvoice,
    getOrderTimeline,
    getSellerOrders,
    getSellerOrderHistory,
    getSellerProcessedOrders,
    markPaymentReceived,
    markOrderComplete,
    markOrderOutForDelivery,
    markOrderPreparing,
    markOrderReady,
    refundCompletedOrder
} from "../controllers/orders/orders.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { checkoutRateLimit, expensiveReadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const orderRouter = Router();

orderRouter.use(verifyJWT);

orderRouter.route("/checkout").post(checkoutRateLimit, createOrder);
orderRouter.route("/my").get(expensiveReadRateLimit, getMyOrders);
orderRouter.route("/buyer/history").get(expensiveReadRateLimit, getMyOrders);

orderRouter.route("/seller").get(expensiveReadRateLimit, getSellerOrders);
orderRouter.route("/seller/active").get(expensiveReadRateLimit, getSellerOrders);
orderRouter.route("/seller/history").get(expensiveReadRateLimit, getSellerOrderHistory);
orderRouter.route("/seller/processed").get(expensiveReadRateLimit, getSellerProcessedOrders);

orderRouter.route("/admin/history").get(expensiveReadRateLimit, getAdminOrderHistory);
orderRouter.route("/admin/processed").get(expensiveReadRateLimit, getAllProcessedOrders);
orderRouter.route("/processed/all").get(expensiveReadRateLimit, getAllProcessedOrders);

orderRouter.route("/:orderId").get(expensiveReadRateLimit, getOrderDetails);
orderRouter.route("/:orderId/timeline").get(expensiveReadRateLimit, getOrderTimeline);
orderRouter.route("/:orderId/invoice").get(expensiveReadRateLimit, getOrderInvoice);
orderRouter.route("/:orderId/status").get(getOrderCurrentStatus);
orderRouter.route("/:orderId/payment-received").patch(writeRateLimit, markPaymentReceived);
orderRouter.route("/:orderId/confirm").patch(writeRateLimit, confirmOrder);
orderRouter.route("/:orderId/prepare").patch(writeRateLimit, markOrderPreparing);
orderRouter.route("/:orderId/ready").patch(writeRateLimit, markOrderReady);
orderRouter.route("/:orderId/out-for-delivery").patch(writeRateLimit, markOrderOutForDelivery);
orderRouter.route("/:orderId/complete").patch(writeRateLimit, markOrderComplete);
orderRouter.route("/:orderId/cancel").patch(writeRateLimit, cancelOrder);
orderRouter.route("/:orderId/refund").patch(writeRateLimit, refundCompletedOrder);

import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const fetchShopRevenueStats = asyncHandler(async(req,res)=>{
    const { shopId } = req.params;
    const { periodType, startDate, endDate } = req.query;

    if(!shopId) throw new apiError(400,"shop id is required");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role === "SELLER" && shop.ownerId !== currentUser.id) throw new apiError(403,"You can only fetch revenue for your own shop");

    const normalizedPeriodType = periodType ? String(periodType).toUpperCase() : undefined;
    if(normalizedPeriodType && !["DAILY","MONTHLY","YEARLY"].includes(normalizedPeriodType)){
        throw new apiError(400,"periodType must be DAILY, MONTHLY, or YEARLY");
    }

    const whereData = {
        shopId:shop.id,
        ...(normalizedPeriodType ? { periodType:normalizedPeriodType } : {})
    };

    if(startDate || endDate){
        whereData.periodDate = {};
        if(startDate){
            const parsedStartDate = new Date(startDate);
            if(Number.isNaN(parsedStartDate.getTime())) throw new apiError(400,"invalid startDate");
            whereData.periodDate.gte = parsedStartDate;
        }
        if(endDate){
            const parsedEndDate = new Date(endDate);
            if(Number.isNaN(parsedEndDate.getTime())) throw new apiError(400,"invalid endDate");
            whereData.periodDate.lte = parsedEndDate;
        }
    }

    const summaries = await prisma.shopRevenueSummary.findMany({
        where:whereData,
        orderBy:[
            {
                periodType:"asc"
            },
            {
                periodDate:"desc"
            }
        ]
    });

    const lifetimeOrders = await prisma.order.aggregate({
        where:{
            shopId:shop.id,
            currentOrderStatus:"COMPLETED"
        },
        _count:{
            id:true
        },
        _sum:{
            totalAmount:true,
            discountAmount:true,
            deliveryAmount:true,
            deliveryDiscountAmount:true,
            paidAmount:true,
            refundAmount:true
        }
    });

    const cancelledOrders = await prisma.order.aggregate({
        where:{
            shopId:shop.id,
            currentOrderStatus:"CANCELLED"
        },
        _count:{
            id:true
        },
        _sum:{
            refundAmount:true
        }
    });

    const lifetime = {
        successfulOrders:lifetimeOrders._count.id || 0,
        cancelledOrders:cancelledOrders._count.id || 0,
        grossRevenue:lifetimeOrders._sum.totalAmount || 0,
        discountAmount:(lifetimeOrders._sum.discountAmount || 0) + (lifetimeOrders._sum.deliveryDiscountAmount || 0),
        deliveryRevenue:Math.max((lifetimeOrders._sum.deliveryAmount || 0) - (lifetimeOrders._sum.deliveryDiscountAmount || 0),0),
        refundAmount:(lifetimeOrders._sum.refundAmount || 0) + (cancelledOrders._sum.refundAmount || 0),
        netRevenue:(lifetimeOrders._sum.paidAmount || 0) - (lifetimeOrders._sum.refundAmount || 0)
    };

    return res.status(200).json(new apiResponse(200,{
        shop,
        summaries,
        lifetime
    },"shop revenue stats fetched successfully"));
});

const fetchRepeatCustomersByShop = asyncHandler(async(req,res)=>{
    const { shopId } = req.params;
    const { minOrders, startDate, endDate } = req.query;

    if(!shopId) throw new apiError(400,"shop id is required");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role === "SELLER" && shop.ownerId !== currentUser.id) throw new apiError(403,"You can only fetch repeat customers for your own shop");

    const repeatOrderThreshold = minOrders === undefined || minOrders === null || minOrders === ""
        ? 2
        : Number(minOrders);

    if(!Number.isInteger(repeatOrderThreshold) || repeatOrderThreshold < 2){
        throw new apiError(400,"minOrders must be a whole number greater than or equal to 2");
    }

    const whereData = {
        shopId:shop.id,
        currentOrderStatus:"COMPLETED"
    };

    if(startDate || endDate){
        whereData.completedAt = {};
        if(startDate){
            const parsedStartDate = new Date(startDate);
            if(Number.isNaN(parsedStartDate.getTime())) throw new apiError(400,"invalid startDate");
            whereData.completedAt.gte = parsedStartDate;
        }
        if(endDate){
            const parsedEndDate = new Date(endDate);
            if(Number.isNaN(parsedEndDate.getTime())) throw new apiError(400,"invalid endDate");
            whereData.completedAt.lte = parsedEndDate;
        }
    }

    const orders = await prisma.order.findMany({
        where:whereData,
        select:{
            id:true,
            userId:true,
            totalAmount:true,
            paidAmount:true,
            refundAmount:true,
            completedAt:true,
            user:{
                select:{
                    id:true,
                    name:true,
                    phone:true,
                    email:true,
                    profileImg:true
                }
            }
        },
        orderBy:{
            completedAt:"asc"
        }
    });

    const customerMap = new Map();

    orders.forEach((order)=>{
        if(!customerMap.has(order.userId)){
            customerMap.set(order.userId,{
                buyer:order.user,
                completedOrders:0,
                grossRevenue:0,
                paidAmount:0,
                refundAmount:0,
                netRevenue:0,
                firstCompletedAt:order.completedAt,
                lastCompletedAt:order.completedAt,
                orderIds:[]
            });
        }

        const customer = customerMap.get(order.userId);
        const paidAmount = order.paidAmount > 0 ? order.paidAmount : order.totalAmount;

        customer.completedOrders += 1;
        customer.grossRevenue += order.totalAmount;
        customer.paidAmount += paidAmount;
        customer.refundAmount += order.refundAmount;
        customer.netRevenue += paidAmount - order.refundAmount;
        customer.lastCompletedAt = order.completedAt || customer.lastCompletedAt;
        customer.orderIds.push(order.id);
    });

    const customers = [...customerMap.values()]
        .filter((customer)=>customer.completedOrders >= repeatOrderThreshold)
        .sort((a,b)=>b.completedOrders - a.completedOrders || b.netRevenue - a.netRevenue);

    return res.status(200).json(new apiResponse(200,{
        shop,
        minOrders:repeatOrderThreshold,
        totalRepeatCustomers:customers.length,
        customers
    },"repeat customers fetched successfully"));
});

export { fetchRepeatCustomersByShop, fetchShopRevenueStats };

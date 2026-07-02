import { Prisma } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const getPositiveInteger = (value,fieldName,{defaultValue,max = 100,min = 1} = {})=>{
    const numberValue = value === undefined || value === null || value === "" ? defaultValue : Number(value);
    if(!Number.isInteger(numberValue) || numberValue < min){
        throw new apiError(400,`${fieldName} must be a whole number greater than or equal to ${min}`);
    }
    return Math.min(numberValue,max);
};

const getDateWindow = (query,{defaultDays = 14,maxDays = 90} = {})=>{
    const days = getPositiveInteger(query.days,"days",{defaultValue:defaultDays,max:maxDays});
    const end = query.endDate ? new Date(String(query.endDate)) : new Date();
    if(Number.isNaN(end.getTime())) throw new apiError(400,"endDate must be a valid date");

    const start = query.startDate ? new Date(String(query.startDate)) : new Date(end);
    if(Number.isNaN(start.getTime())) throw new apiError(400,"startDate must be a valid date");
    if(!query.startDate) start.setDate(start.getDate() - (days - 1));

    start.setHours(0,0,0,0);
    end.setHours(23,59,59,999);

    if(start > end) throw new apiError(400,"startDate cannot be after endDate");

    return {start,end,days};
};

const getPagination = (query,{defaultLimit = 20,maxLimit = 100} = {})=>{
    const page = getPositiveInteger(query.page,"page",{defaultValue:1,max:100000});
    const limit = getPositiveInteger(query.limit || query.take,"limit",{defaultValue:defaultLimit,max:maxLimit});
    return {
        page,
        limit,
        skip:(page - 1) * limit
    };
};

const getAdminAnalyticsSummary = asyncHandler(async(req,res)=>{
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(),now.getMonth(),1);

    const [
        totalSellers,
        liveSellers,
        trialSellers,
        blockedSellers,
        totalBuyers,
        ordersToday,
        ordersThisMonth,
        revenueToday,
        revenueMonth,
        newBuyerSignupsThisMonth,
        approvedBilling,
        repeatBuyers
    ] = await Promise.all([
        prisma.user.count({where:{role:"SELLER"}}),
        prisma.shop.count({where:{ShopOpenStatus:"OPEN"}}),
        prisma.shop.count({where:{billingStatus:"TRIAL"}}),
        prisma.user.count({where:{role:"SELLER",isBlocked:true}}),
        prisma.user.count({where:{role:"BUYER"}}),
        prisma.order.count({where:{createdAt:{gte:todayStart}}}),
        prisma.order.count({where:{createdAt:{gte:monthStart}}}),
        prisma.order.aggregate({
            where:{currentOrderStatus:"COMPLETED",createdAt:{gte:todayStart}},
            _sum:{totalAmount:true}
        }),
        prisma.order.aggregate({
            where:{currentOrderStatus:"COMPLETED",createdAt:{gte:monthStart}},
            _sum:{totalAmount:true}
        }),
        prisma.user.count({where:{role:"BUYER",createdAt:{gte:monthStart}}}),
        prisma.recharges.aggregate({
            where:{status:"APPROVED"},
            _sum:{orderAmount:true,requestedSlots:true}
        }),
        prisma.$queryRaw`
            SELECT COUNT(*)::int AS count
            FROM (
                SELECT o."userId"
                FROM "Order" o
                WHERE o."currentOrderStatus" = 'COMPLETED'
                GROUP BY o."userId"
                HAVING COUNT(o.id) >= 2
            ) repeat_buyers
        `
    ]);

    return res.status(200).json(new apiResponse(200,{
        generatedAt:now,
        cards:{
            totalSellers,
            liveSellers,
            trialSellers,
            blockedSellers,
            totalBuyers,
            ordersToday,
            ordersThisMonth,
            revenueToday:revenueToday._sum.totalAmount || 0,
            revenueMonth:revenueMonth._sum.totalAmount || 0,
            newBuyerSignupsThisMonth,
            approvedBillingTotal:approvedBilling._sum.orderAmount || 0,
            slotsSold:approvedBilling._sum.requestedSlots || 0,
            repeatBuyers:Number(repeatBuyers?.[0]?.count || 0)
        }
    },"admin analytics summary fetched successfully"));
});

const getAdminAnalyticsTrends = asyncHandler(async(req,res)=>{
    const {start,end,days} = getDateWindow(req.query,{defaultDays:14,maxDays:120});

    const trends = await prisma.$queryRaw`
        WITH date_series AS (
            SELECT generate_series(${start}::date, ${end}::date, '1 day'::interval)::date AS day
        ),
        order_totals AS (
            SELECT
                o."createdAt"::date AS day,
                COUNT(o.id)::int AS orders,
                COALESCE(SUM(o."totalAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS revenue
            FROM "Order" o
            WHERE o."createdAt" >= ${start}
              AND o."createdAt" <= ${end}
            GROUP BY o."createdAt"::date
        )
        SELECT
            ds.day,
            COALESCE(ot.orders,0)::int AS orders,
            COALESCE(ot.revenue,0)::int AS revenue
        FROM date_series ds
        LEFT JOIN order_totals ot ON ot.day = ds.day
        ORDER BY ds.day ASC
    `;

    return res.status(200).json(new apiResponse(200,{
        days,
        startDate:start,
        endDate:end,
        ordersTrend:trends.map((row)=>({
            date:row.day,
            value:Number(row.orders || 0)
        })),
        revenueTrend:trends.map((row)=>({
            date:row.day,
            value:Number(row.revenue || 0)
        }))
    },"admin analytics trends fetched successfully"));
});

const getAdminAnalyticsTopShops = asyncHandler(async(req,res)=>{
    const limit = getPositiveInteger(req.query.limit || req.query.take,"limit",{defaultValue:10,max:50});
    const sort = String(req.query.sort || "revenue").trim().toLowerCase();
    const orderSql = {
        revenue:Prisma.sql`"completedRevenue" DESC`,
        highestrevenue:Prisma.sql`"completedRevenue" DESC`,
        sales:Prisma.sql`"completedOrders" DESC`,
        highestsales:Prisma.sql`"completedOrders" DESC`,
        newest:Prisma.sql`s."createdAt" DESC`
    }[sort];

    if(!orderSql) throw new apiError(400,"sort must be revenue, highestRevenue, sales, highestSales, or newest");

    const shops = await prisma.$queryRaw`
        SELECT
            s.id,
            s."shopName",
            s.slug,
            s."shopImage",
            u.id AS "ownerId",
            u.name AS "ownerName",
            COALESCE(order_metrics."completedOrders",0)::int AS "completedOrders",
            COALESCE(order_metrics."completedRevenue",0)::int AS "completedRevenue",
            COALESCE(order_metrics."netRevenue",0)::int AS "netRevenue"
        FROM "Shop" s
        JOIN "User" u ON u.id = s."ownerId"
        LEFT JOIN (
            SELECT
                o."shopId",
                COUNT(o.id) FILTER (WHERE o."currentOrderStatus" = 'COMPLETED')::int AS "completedOrders",
                COALESCE(SUM(o."totalAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "completedRevenue",
                COALESCE(SUM(o."paidAmount" - o."refundAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "netRevenue"
            FROM "Order" o
            GROUP BY o."shopId"
        ) order_metrics ON order_metrics."shopId" = s.id
        ORDER BY ${orderSql}, s."createdAt" DESC
        LIMIT ${limit}
    `;

    return res.status(200).json(new apiResponse(200,{
        sort,
        shops:shops.map((shop)=>({
            id:shop.id,
            shopName:shop.shopName,
            slug:shop.slug,
            shopImage:shop.shopImage,
            owner:{
                id:shop.ownerId,
                name:shop.ownerName
            },
            completedOrders:Number(shop.completedOrders || 0),
            completedRevenue:Number(shop.completedRevenue || 0),
            netRevenue:Number(shop.netRevenue || 0)
        }))
    },"top shops fetched successfully"));
});

const getAdminAnalyticsTopBuyers = asyncHandler(async(req,res)=>{
    const limit = getPositiveInteger(req.query.limit || req.query.take,"limit",{defaultValue:10,max:50});

    const buyers = await prisma.$queryRaw`
        SELECT
            u.id,
            u.name,
            u.phone,
            u.email,
            COUNT(o.id)::int AS "completedOrders",
            COALESCE(SUM(o."totalAmount"),0)::int AS "grossSpend",
            COALESCE(SUM(o."paidAmount" - o."refundAmount"),0)::int AS "netSpend",
            MAX(o."createdAt") AS "lastOrderAt"
        FROM "User" u
        JOIN "Order" o ON o."userId" = u.id
        WHERE u.role = 'BUYER'
          AND o."currentOrderStatus" = 'COMPLETED'
        GROUP BY u.id
        ORDER BY "netSpend" DESC, "completedOrders" DESC
        LIMIT ${limit}
    `;

    return res.status(200).json(new apiResponse(200,{
        buyers:buyers.map((buyer)=>({
            id:buyer.id,
            name:buyer.name,
            phone:buyer.phone,
            email:buyer.email,
            completedOrders:Number(buyer.completedOrders || 0),
            grossSpend:Number(buyer.grossSpend || 0),
            netSpend:Number(buyer.netSpend || 0),
            lastOrderAt:buyer.lastOrderAt
        }))
    },"top buyers fetched successfully"));
});

const getAdminSellerWalletMonitor = asyncHandler(async(req,res)=>{
    const {page,limit,skip} = getPagination(req.query,{defaultLimit:20,maxLimit:100});
    const search = req.query.search ? String(req.query.search).trim() : "";
    const lowBalanceOnly = String(req.query.lowBalanceOnly || "").toLowerCase() === "true";
    const searchClause = search ? Prisma.sql`AND (
        s."shopName" ILIKE ${`%${search}%`}
        OR s.slug ILIKE ${`%${search}%`}
        OR u.name ILIKE ${`%${search}%`}
        OR u.phone ILIKE ${`%${search}%`}
        OR u.email ILIKE ${`%${search}%`}
    )` : Prisma.empty;
    const lowBalanceClause = lowBalanceOnly
        ? Prisma.sql`AND s."shopBalance" <= COALESCE(last_billing."dailyCost", COALESCE(settings."dailySlotPrice",0) * s."totalSlots", 0) * 2`
        : Prisma.empty;

    const [countRows,rows] = await Promise.all([
        prisma.$queryRaw`
            SELECT COUNT(*)::int AS total
            FROM "Shop" s
            JOIN "User" u ON u.id = s."ownerId"
            LEFT JOIN (
                SELECT DISTINCT ON (sdb."shopId")
                    sdb."shopId",
                    sdb."totalCharge" AS "dailyCost"
                FROM "ShopDailyBilling" sdb
                ORDER BY sdb."shopId", sdb."billingDate" DESC
            ) last_billing ON last_billing."shopId" = s.id
            LEFT JOIN "BillingSettings" settings ON settings.id = 'default'
            WHERE u.role = 'SELLER'
            ${searchClause}
            ${lowBalanceClause}
        `,
        prisma.$queryRaw`
            SELECT
                s.id AS "shopId",
                s."shopName",
                s.slug AS "shopCode",
                s."shopBalance",
                s."billingStatus",
                s."totalSlots",
                s."usedSlots",
                u.id AS "sellerId",
                u.name AS "sellerName",
                u.phone AS "sellerPhone",
                COALESCE(last_billing."dailyCost", COALESCE(settings."dailySlotPrice",0) * s."totalSlots", 0)::int AS "dailyCost",
                last_billing."billingDate" AS "lastBillingDate",
                last_recharge."approvedAt" AS "lastRechargeAt",
                last_recharge."orderAmount" AS "lastRechargeAmount",
                CASE
                    WHEN COALESCE(last_billing."dailyCost", COALESCE(settings."dailySlotPrice",0) * s."totalSlots", 0) > 0
                    THEN FLOOR(s."shopBalance"::numeric / COALESCE(last_billing."dailyCost", COALESCE(settings."dailySlotPrice",0) * s."totalSlots", 0))::int
                    ELSE NULL
                END AS "daysLeft"
            FROM "Shop" s
            JOIN "User" u ON u.id = s."ownerId"
            LEFT JOIN "BillingSettings" settings ON settings.id = 'default'
            LEFT JOIN (
                SELECT DISTINCT ON (sdb."shopId")
                    sdb."shopId",
                    sdb."billingDate",
                    sdb."totalCharge" AS "dailyCost"
                FROM "ShopDailyBilling" sdb
                ORDER BY sdb."shopId", sdb."billingDate" DESC
            ) last_billing ON last_billing."shopId" = s.id
            LEFT JOIN (
                SELECT DISTINCT ON (r."shopId")
                    r."shopId",
                    r."approvedAt",
                    r."orderAmount"
                FROM "Recharges" r
                WHERE r.status = 'APPROVED'
                ORDER BY r."shopId", r."approvedAt" DESC NULLS LAST, r."createdAt" DESC
            ) last_recharge ON last_recharge."shopId" = s.id
            WHERE u.role = 'SELLER'
            ${searchClause}
            ${lowBalanceClause}
            ORDER BY s."shopBalance" ASC, s."createdAt" DESC
            LIMIT ${limit}
            OFFSET ${skip}
        `
    ]);

    const total = Number(countRows?.[0]?.total || 0);

    return res.status(200).json(new apiResponse(200,{
        sellers:rows.map((row)=>({
            seller:{
                id:row.sellerId,
                name:row.sellerName,
                phone:row.sellerPhone
            },
            shop:{
                id:row.shopId,
                name:row.shopName,
                code:row.shopCode,
                balance:Number(row.shopBalance || 0),
                billingStatus:row.billingStatus,
                totalSlots:Number(row.totalSlots || 0),
                usedSlots:Number(row.usedSlots || 0)
            },
            dailyCost:Number(row.dailyCost || 0),
            daysLeft:row.daysLeft === null ? null : Number(row.daysLeft),
            lastBillingDate:row.lastBillingDate,
            lastRecharge:{
                at:row.lastRechargeAt,
                amount:Number(row.lastRechargeAmount || 0)
            }
        })),
        pagination:{
            page,
            limit,
            total,
            totalPages:Math.ceil(total / limit),
            hasNextPage:page * limit < total,
            hasPrevPage:page > 1
        },
        filters:{
            search,
            lowBalanceOnly
        }
    },"seller wallet monitor fetched successfully"));
});

export {
    getAdminAnalyticsSummary,
    getAdminAnalyticsTrends,
    getAdminAnalyticsTopBuyers,
    getAdminAnalyticsTopShops,
    getAdminSellerWalletMonitor
};

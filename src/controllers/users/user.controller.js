import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { Prisma } from "@prisma/client";

const userEditableFields = [
    "email",
    "name",
    "phone",
    "latitude",
    "longitude",
    "profileImg",
];

const adminEditableFields = [
    ...userEditableFields,
    "role",
    "isVerified",
    "isBlocked",
];

const userRoles = ["SUPER", "BUYER", "SELLER", "ADMIN"];
const selfAssignableRoles = ["BUYER", "SELLER"];

const normalizeRole = (role) => typeof role === "string" ? role.toUpperCase() : role;

const getPaginationSkip = (req) => {
    const skip = Number(req.query.skip || 0);
    if(Number.isNaN(skip) || skip < 0) throw new apiError(400,"Invalid skip value");
    return skip;
};

const getOverviewTake = (req) => {
    const take = Number(req.query.take || 10);
    if(!Number.isInteger(take) || take < 1) throw new apiError(400,"Invalid take value");
    return Math.min(take,50);
};

const getAdminShopPagination = (query) => {
    const page = Number(query.page || 1);
    const limit = Number(query.limit || query.take || 20);

    if(!Number.isInteger(page) || page < 1) throw new apiError(400,"Invalid page value");
    if(!Number.isInteger(limit) || limit < 1) throw new apiError(400,"Invalid limit value");

    const normalizedLimit = Math.min(limit,100);
    return {
        page,
        limit:normalizedLimit,
        skip:(page - 1) * normalizedLimit
    };
};

const parseAdminBooleanFilter = (value,fieldName) => {
    if(value === undefined || value === null || value === "") return undefined;
    if(typeof value === "boolean") return value;
    const normalizedValue = String(value).trim().toLowerCase();
    if(["true","1","yes"].includes(normalizedValue)) return true;
    if(["false","0","no"].includes(normalizedValue)) return false;
    throw new apiError(400,`${fieldName} must be true or false`);
};

const formatAdminShopRow = (shop)=>({
    id:shop.id,
    shopName:shop.shopName,
    slug:shop.slug,
    shopImage:shop.shopImage,
    description:shop.Description,
    verified:shop.Verified,
    configuredStatus:shop.status,
    openStatus:shop.ShopOpenStatus,
    billingStatus:shop.billingStatus,
    shopBalance:shop.shopBalance,
    totalSlots:shop.totalSlots,
    usedSlots:shop.usedSlots,
    deliveryEnabled:shop.deliveryEnabled,
    createdAt:shop.createdAt,
    updatedAt:shop.updatedAt,
    owner:{
        id:shop.ownerId,
        name:shop.ownerName,
        email:shop.ownerEmail,
        phone:shop.ownerPhone
    },
    shopType:shop.shopTypeId ? {
        id:shop.shopTypeId,
        name:shop.shopTypeName,
        slug:shop.shopTypeSlug
    } : null,
    metrics:{
        totalOrders:Number(shop.totalOrders || 0),
        completedOrders:Number(shop.completedOrders || 0),
        cancelledOrders:Number(shop.cancelledOrders || 0),
        totalRevenue:Number(shop.totalRevenue || 0),
        paidRevenue:Number(shop.paidRevenue || 0),
        refundAmount:Number(shop.refundAmount || 0),
        netRevenue:Number(shop.netRevenue || 0),
        itemCount:Number(shop.itemCount || 0),
        comboCount:Number(shop.comboCount || 0),
        menuCount:Number(shop.menuCount || 0)
    }
});

const countByField = (rows, field) => {
    return rows.reduce((result,row)=>{
        const key = row[field] || "UNKNOWN";
        result[key] = row._count?._all || 0;
        return result;
    },{});
};

// admin
const fetchAllUsers = asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
        orderBy: {
            createdAt: "desc",
        },
    });

    return res
        .status(200)
        .json(new apiResponse(200, users, "Users fetched successfully"));
});

const fetchAllUserOverviewData = asyncHandler(async(req,res)=>{
    const take = getOverviewTake(req);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0,0,0,0);

    const nextSevenDays = new Date(now);
    nextSevenDays.setDate(nextSevenDays.getDate() + 7);

    const [
        userRoleCounts,
        totalUsers,
        blockedUsers,
        verifiedUsers,
        totalShops,
        verifiedShops,
        liveShops,
        lowBalanceShops,
        shopBillingCounts,
        trialsEndingSoon,
        orderStatusCounts,
        ordersToday,
        completedOrderTotals,
        pendingBilling,
        rechargeStatusCounts,
        approvedRechargeTotals,
        activeOffers,
        activeAds,
        activeBuyerAds,
        activeBanners,
        dataCounts,
        recentUsers,
        recentShops,
        recentOrders,
        recentRecharges,
        recentOffers,
        recentAds,
        recentBuyerAds,
        recentBanners,
        recentRevenueSummaries
    ] = await Promise.all([
        prisma.user.groupBy({
            by:["role"],
            _count:{
                _all:true
            }
        }),
        prisma.user.count(),
        prisma.user.count({
            where:{
                isBlocked:true
            }
        }),
        prisma.user.count({
            where:{
                isVerified:true
            }
        }),
        prisma.shop.count(),
        prisma.shop.count({
            where:{
                Verified:true
            }
        }),
        prisma.shop.count({
            where:{
                ShopOpenStatus:"OPEN"
            }
        }),
        prisma.shop.count({
            where:{
                shopBalance:{
                    lte:0
                }
            }
        }),
        prisma.shop.groupBy({
            by:["billingStatus"],
            _count:{
                _all:true
            }
        }),
        prisma.shop.count({
            where:{
                billingStatus:"TRIAL",
                trialEndsAt:{
                    gte:now,
                    lte:nextSevenDays
                }
            }
        }),
        prisma.order.groupBy({
            by:["currentOrderStatus"],
            _count:{
                _all:true
            }
        }),
        prisma.order.count({
            where:{
                createdAt:{
                    gte:todayStart
                }
            }
        }),
        prisma.order.aggregate({
            where:{
                currentOrderStatus:"COMPLETED"
            },
            _count:{
                id:true
            },
            _sum:{
                totalAmount:true,
                paidAmount:true,
                refundAmount:true,
                discountAmount:true,
                deliveryAmount:true,
                deliveryDiscountAmount:true
            }
        }),
        prisma.recharges.count({
            where:{
                status:"PENDING"
            }
        }),
        prisma.recharges.groupBy({
            by:["status"],
            _count:{
                _all:true
            },
            _sum:{
                orderAmount:true
            }
        }),
        prisma.recharges.aggregate({
            where:{
                status:"APPROVED"
            },
            _count:{
                id:true
            },
            _sum:{
                orderAmount:true
            }
        }),
        prisma.offer.count({
            where:{
                active:true,
                startsAt:{
                    lte:now
                },
                endsAt:{
                    gte:now
                }
            }
        }),
        prisma.ad.count({
            where:{
                active:true,
                startsAt:{
                    lte:now
                },
                endsAt:{
                    gte:now
                }
            }
        }),
        prisma.buyerAds.count({
            where:{
                active:true,
                startsAt:{
                    lte:now
                },
                endsAt:{
                    gte:now
                }
            }
        }),
        prisma.banner.count({
            where:{
                active:true
            }
        }),
        Promise.all([
            prisma.cuisine.count(),
            prisma.categories.count(),
            prisma.items.count(),
            prisma.shopItem.count(),
            prisma.combo.count(),
            prisma.menu.count(),
            prisma.tag.count(),
            prisma.orderItem.count(),
            prisma.shopRevenueSummary.count()
        ]),
        prisma.user.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            select:{
                id:true,
                name:true,
                email:true,
                phone:true,
                role:true,
                profileImg:true,
                billingPlan:true,
                isVerified:true,
                isBlocked:true,
                createdAt:true,
                updatedAt:true
            }
        }),
        prisma.shop.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            include:{
                owner:{
                    select:{
                        id:true,
                        name:true,
                        phone:true,
                        email:true
                    }
                }
            }
        }),
        prisma.order.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            include:{
                user:{
                    select:{
                        id:true,
                        name:true,
                        phone:true
                    }
                },
                shop:{
                    select:{
                        id:true,
                        shopName:true,
                        ownerId:true
                    }
                },
                orderItems:true
            }
        }),
        prisma.recharges.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            include:{
                user:{
                    select:{
                        id:true,
                        name:true,
                        phone:true
                    }
                },
                shop:{
                    select:{
                        id:true,
                        shopName:true
                    }
                }
            }
        }),
        prisma.offer.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            include:{
                shop:{
                    select:{
                        id:true,
                        shopName:true
                    }
                }
            }
        }),
        prisma.ad.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            include:{
                sellerTargets:true
            }
        }),
        prisma.buyerAds.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            include:{
                buyerTargets:true
            }
        }),
        prisma.banner.findMany({
            take,
            orderBy:{
                createdAt:"desc"
            },
            include:{
                shop:{
                    select:{
                        id:true,
                        shopName:true
                    }
                },
                createdBy:{
                    select:{
                        id:true,
                        name:true,
                        role:true
                    }
                }
            }
        }),
        prisma.shopRevenueSummary.findMany({
            take,
            orderBy:{
                periodDate:"desc"
            },
            include:{
                shop:{
                    select:{
                        id:true,
                        shopName:true
                    }
                }
            }
        })
    ]);

    const [
        cuisines,
        categories,
        masterItems,
        shopItems,
        combos,
        menus,
        tags,
        orderItems,
        revenueSummaries
    ] = dataCounts;

    const totalGmv = completedOrderTotals._sum.totalAmount || 0;
    const totalPaidAmount = completedOrderTotals._sum.paidAmount || 0;
    const totalRefundAmount = completedOrderTotals._sum.refundAmount || 0;

    const overview = {
        generatedAt:now,
        take,
        metrics:{
            users:{
                total:totalUsers,
                byRole:countByField(userRoleCounts,"role"),
                blocked:blockedUsers,
                verified:verifiedUsers
            },
            shops:{
                total:totalShops,
                verified:verifiedShops,
                live:liveShops,
                lowBalance:lowBalanceShops,
                billingStatus:countByField(shopBillingCounts,"billingStatus"),
                trialsEndingInSevenDays:trialsEndingSoon
            },
            orders:{
                totalByStatus:countByField(orderStatusCounts,"currentOrderStatus"),
                today:ordersToday,
                completed:completedOrderTotals._count.id || 0,
                totalGmv,
                totalPaidAmount,
                totalRefundAmount,
                totalNetAmount:totalPaidAmount - totalRefundAmount,
                totalDiscountAmount:(completedOrderTotals._sum.discountAmount || 0) + (completedOrderTotals._sum.deliveryDiscountAmount || 0),
                totalDeliveryAmount:completedOrderTotals._sum.deliveryAmount || 0
            },
            billing:{
                pendingRecharges:pendingBilling,
                approvedPackages:approvedRechargeTotals._count.id || 0,
                approvedRechargeAmount:approvedRechargeTotals._sum.orderAmount || 0,
                rechargeStatus:rechargeStatusCounts.reduce((result,row)=>{
                    result[row.status] = {
                        count:row._count?._all || 0,
                        amount:row._sum?.orderAmount || 0
                    };
                    return result;
                },{})
            },
            marketing:{
                activeOffers,
                activeSellerAds:activeAds,
                activeBuyerAds,
                activeBanners
            },
            catalog:{
                cuisines,
                categories,
                masterItems,
                shopItems,
                combos,
                menus,
                tags,
                orderItems,
                revenueSummaries
            }
        },
        recent:{
            users:recentUsers,
            shops:recentShops,
            orders:recentOrders,
            recharges:recentRecharges,
            offers:recentOffers,
            sellerAds:recentAds,
            buyerAds:recentBuyerAds,
            banners:recentBanners,
            revenueSummaries:recentRevenueSummaries
        },
        unavailable:{
            activeChats:"No chat model found in current Prisma schema",
            notificationsSent:"No notification model found in current Prisma schema"
        }
    };

    return res.status(200).json(new apiResponse(200,overview,"User overview data fetched successfully"));
});

const fetchAdminShops = asyncHandler(async(req,res)=>{
    const {page,limit,skip} = getAdminShopPagination(req.query);
    const {
        search,
        status,
        billingStatus,
        ownerId,
        shopTypeId,
        sort,
        createdFrom,
        createdTo
    } = req.query;
    const verified = parseAdminBooleanFilter(req.query.verified,"verified");
    const live = parseAdminBooleanFilter(req.query.live,"live");

    const whereClauses = [Prisma.sql`1=1`];

    if(search){
        const searchValue = `%${String(search).trim()}%`;
        whereClauses.push(Prisma.sql`(
            s."shopName" ILIKE ${searchValue}
            OR s.slug ILIKE ${searchValue}
            OR u.name ILIKE ${searchValue}
            OR u.email ILIKE ${searchValue}
            OR u.phone ILIKE ${searchValue}
        )`);
    }

    if(status){
        const normalizedStatus = String(status).trim().toUpperCase();
        whereClauses.push(Prisma.sql`(s."ShopOpenStatus"::text = ${normalizedStatus} OR s.status::text = ${normalizedStatus})`);
    }

    if(billingStatus){
        whereClauses.push(Prisma.sql`s."billingStatus"::text = ${String(billingStatus).trim().toUpperCase()}`);
    }

    if(ownerId) whereClauses.push(Prisma.sql`s."ownerId" = ${String(ownerId)}`);
    if(shopTypeId) whereClauses.push(Prisma.sql`s."shopTypeId" = ${String(shopTypeId)}`);
    if(verified !== undefined) whereClauses.push(Prisma.sql`s."Verified" = ${verified}`);
    if(live !== undefined){
        whereClauses.push(live
            ? Prisma.sql`s."ShopOpenStatus"::text = 'OPEN'`
            : Prisma.sql`s."ShopOpenStatus"::text <> 'OPEN'`);
    }
    if(createdFrom){
        const fromDate = new Date(String(createdFrom));
        if(Number.isNaN(fromDate.getTime())) throw new apiError(400,"createdFrom must be a valid date");
        whereClauses.push(Prisma.sql`s."createdAt" >= ${fromDate}`);
    }
    if(createdTo){
        const toDate = new Date(String(createdTo));
        if(Number.isNaN(toDate.getTime())) throw new apiError(400,"createdTo must be a valid date");
        whereClauses.push(Prisma.sql`s."createdAt" <= ${toDate}`);
    }

    const whereSql = Prisma.sql`WHERE ${Prisma.join(whereClauses,Prisma.sql` AND `)}`;
    const sortKey = String(sort || "newJoinings").trim().toLowerCase();
    const orderSql = {
        highestsales:Prisma.sql`"completedOrders" DESC, s."createdAt" DESC`,
        sales:Prisma.sql`"completedOrders" DESC, s."createdAt" DESC`,
        orders:Prisma.sql`"totalOrders" DESC, s."createdAt" DESC`,
        highestrevenue:Prisma.sql`"totalRevenue" DESC, s."createdAt" DESC`,
        revenue:Prisma.sql`"totalRevenue" DESC, s."createdAt" DESC`,
        netrevenue:Prisma.sql`"netRevenue" DESC, s."createdAt" DESC`,
        newjoinings:Prisma.sql`s."createdAt" DESC`,
        newest:Prisma.sql`s."createdAt" DESC`,
        oldest:Prisma.sql`s."createdAt" ASC`,
        name:Prisma.sql`s."shopName" ASC`,
        balance:Prisma.sql`s."shopBalance" DESC, s."createdAt" DESC`
    }[sortKey];

    if(!orderSql){
        throw new apiError(400,"sort must be one of highestSales, highestRevenue, newJoinings, newest, oldest, name, balance");
    }

    const [countRows,shops] = await Promise.all([
        prisma.$queryRaw`
            SELECT COUNT(*)::int AS total
            FROM "Shop" s
            JOIN "User" u ON u.id = s."ownerId"
            LEFT JOIN "ShopType" st ON st.id = s."shopTypeId"
            ${whereSql}
        `,
        prisma.$queryRaw`
            SELECT
                s.id,
                s."shopName",
                s.slug,
                s."shopImage",
                s."Description",
                s."Verified",
                s.status,
                s."ShopOpenStatus",
                s."billingStatus",
                s."shopBalance",
                s."totalSlots",
                s."usedSlots",
                s."deliveryEnabled",
                s."createdAt",
                s."updatedAt",
                s."ownerId",
                u.name AS "ownerName",
                u.email AS "ownerEmail",
                u.phone AS "ownerPhone",
                s."shopTypeId",
                st.name AS "shopTypeName",
                st.slug AS "shopTypeSlug",
                COALESCE(order_metrics."totalOrders",0)::int AS "totalOrders",
                COALESCE(order_metrics."completedOrders",0)::int AS "completedOrders",
                COALESCE(order_metrics."cancelledOrders",0)::int AS "cancelledOrders",
                COALESCE(order_metrics."totalRevenue",0)::int AS "totalRevenue",
                COALESCE(order_metrics."paidRevenue",0)::int AS "paidRevenue",
                COALESCE(order_metrics."refundAmount",0)::int AS "refundAmount",
                COALESCE(order_metrics."netRevenue",0)::int AS "netRevenue",
                COALESCE(item_metrics."itemCount",0)::int AS "itemCount",
                COALESCE(combo_metrics."comboCount",0)::int AS "comboCount",
                COALESCE(menu_metrics."menuCount",0)::int AS "menuCount"
            FROM "Shop" s
            JOIN "User" u ON u.id = s."ownerId"
            LEFT JOIN "ShopType" st ON st.id = s."shopTypeId"
            LEFT JOIN (
                SELECT
                    o."shopId",
                    COUNT(o.id)::int AS "totalOrders",
                    COUNT(o.id) FILTER (WHERE o."currentOrderStatus" = 'COMPLETED')::int AS "completedOrders",
                    COUNT(o.id) FILTER (WHERE o."currentOrderStatus" = 'CANCELLED')::int AS "cancelledOrders",
                    COALESCE(SUM(o."totalAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "totalRevenue",
                    COALESCE(SUM(o."paidAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "paidRevenue",
                    COALESCE(SUM(o."refundAmount"),0)::int AS "refundAmount",
                    COALESCE(SUM(o."paidAmount" - o."refundAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "netRevenue"
                FROM "Order" o
                GROUP BY o."shopId"
            ) order_metrics ON order_metrics."shopId" = s.id
            LEFT JOIN (
                SELECT si."shopId", COUNT(si.id)::int AS "itemCount"
                FROM "ShopItem" si
                GROUP BY si."shopId"
            ) item_metrics ON item_metrics."shopId" = s.id
            LEFT JOIN (
                SELECT c."shopId", COUNT(c.id)::int AS "comboCount"
                FROM "Combo" c
                GROUP BY c."shopId"
            ) combo_metrics ON combo_metrics."shopId" = s.id
            LEFT JOIN (
                SELECT m."shopId", COUNT(m.id)::int AS "menuCount"
                FROM "Menu" m
                GROUP BY m."shopId"
            ) menu_metrics ON menu_metrics."shopId" = s.id
            ${whereSql}
            ORDER BY ${orderSql}
            LIMIT ${limit}
            OFFSET ${skip}
        `
    ]);

    const total = Number(countRows?.[0]?.total || 0);

    return res.status(200).json(new apiResponse(200,{
        shops:shops.map(formatAdminShopRow),
        pagination:{
            page,
            limit,
            total,
            totalPages:Math.ceil(total / limit),
            hasNextPage:page * limit < total,
            hasPrevPage:page > 1
        },
        filters:{
            search:search || null,
            status:status || null,
            billingStatus:billingStatus || null,
            ownerId:ownerId || null,
            shopTypeId:shopTypeId || null,
            verified:verified ?? null,
            live:live ?? null,
            createdFrom:createdFrom || null,
            createdTo:createdTo || null,
            sort:sort || "newJoinings"
        }
    },"admin shops fetched successfully"));
});

const fetchAdminShopById = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    if(!shopId) throw new apiError(400,"shop id is required");

    const [shop] = await prisma.$queryRaw`
        SELECT
            s.id,
            s."shopName",
            s.slug,
            s."shopImage",
            s."Address",
            s."Tags",
            s."Description",
            s."Verified",
            s.status,
            s."ShopOpenStatus",
            s."billingStatus",
            s."shopBalance",
            s."totalSlots",
            s."usedSlots",
            s."trialStartedAt",
            s."trialDays",
            s."trialEndsAt",
            s."deliveryEnabled",
            s."MinimumDeliveryRate",
            s."FreeDeliveryRate",
            s.latitude,
            s.longitude,
            s."createdAt",
            s."updatedAt",
            s."ownerId",
            u.name AS "ownerName",
            u.email AS "ownerEmail",
            u.phone AS "ownerPhone",
            u."profileImg" AS "ownerProfileImg",
            s."shopTypeId",
            st.name AS "shopTypeName",
            st.slug AS "shopTypeSlug",
            COALESCE(order_metrics."totalOrders",0)::int AS "totalOrders",
            COALESCE(order_metrics."completedOrders",0)::int AS "completedOrders",
            COALESCE(order_metrics."cancelledOrders",0)::int AS "cancelledOrders",
            COALESCE(order_metrics."totalRevenue",0)::int AS "totalRevenue",
            COALESCE(order_metrics."paidRevenue",0)::int AS "paidRevenue",
            COALESCE(order_metrics."refundAmount",0)::int AS "refundAmount",
            COALESCE(order_metrics."netRevenue",0)::int AS "netRevenue",
            COALESCE(item_metrics."itemCount",0)::int AS "itemCount",
            COALESCE(combo_metrics."comboCount",0)::int AS "comboCount",
            COALESCE(menu_metrics."menuCount",0)::int AS "menuCount"
        FROM "Shop" s
        JOIN "User" u ON u.id = s."ownerId"
        LEFT JOIN "ShopType" st ON st.id = s."shopTypeId"
        LEFT JOIN (
            SELECT
                o."shopId",
                COUNT(o.id)::int AS "totalOrders",
                COUNT(o.id) FILTER (WHERE o."currentOrderStatus" = 'COMPLETED')::int AS "completedOrders",
                COUNT(o.id) FILTER (WHERE o."currentOrderStatus" = 'CANCELLED')::int AS "cancelledOrders",
                COALESCE(SUM(o."totalAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "totalRevenue",
                COALESCE(SUM(o."paidAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "paidRevenue",
                COALESCE(SUM(o."refundAmount"),0)::int AS "refundAmount",
                COALESCE(SUM(o."paidAmount" - o."refundAmount") FILTER (WHERE o."currentOrderStatus" = 'COMPLETED'),0)::int AS "netRevenue"
            FROM "Order" o
            GROUP BY o."shopId"
        ) order_metrics ON order_metrics."shopId" = s.id
        LEFT JOIN (
            SELECT si."shopId", COUNT(si.id)::int AS "itemCount"
            FROM "ShopItem" si
            GROUP BY si."shopId"
        ) item_metrics ON item_metrics."shopId" = s.id
        LEFT JOIN (
            SELECT c."shopId", COUNT(c.id)::int AS "comboCount"
            FROM "Combo" c
            GROUP BY c."shopId"
        ) combo_metrics ON combo_metrics."shopId" = s.id
        LEFT JOIN (
            SELECT m."shopId", COUNT(m.id)::int AS "menuCount"
            FROM "Menu" m
            GROUP BY m."shopId"
        ) menu_metrics ON menu_metrics."shopId" = s.id
        WHERE s.id = ${shopId}
        LIMIT 1
    `;

    if(!shop) throw new apiError(404,"shop not found");

    const recentOrders = await prisma.order.findMany({
        where:{
            shopId
        },
        take:10,
        orderBy:{
            createdAt:"desc"
        },
        select:{
            id:true,
            currentOrderStatus:true,
            paymentMethod:true,
            paymentReceived:true,
            totalAmount:true,
            paidAmount:true,
            refundAmount:true,
            createdAt:true,
            user:{
                select:{
                    id:true,
                    name:true,
                    phone:true
                }
            }
        }
    });

    return res.status(200).json(new apiResponse(200,{
        ...formatAdminShopRow(shop),
        address:shop.Address,
        tags:shop.Tags,
        trial:{
            startedAt:shop.trialStartedAt,
            days:shop.trialDays,
            endsAt:shop.trialEndsAt
        },
        delivery:{
            enabled:shop.deliveryEnabled,
            minimumRate:shop.MinimumDeliveryRate,
            freeRate:shop.FreeDeliveryRate
        },
        location:{
            latitude:shop.latitude,
            longitude:shop.longitude
        },
        owner:{
            id:shop.ownerId,
            name:shop.ownerName,
            email:shop.ownerEmail,
            phone:shop.ownerPhone,
            profileImg:shop.ownerProfileImg
        },
        recentOrders
    },"admin shop details fetched successfully"));
});

const fetchAdminBuyerById = asyncHandler(async(req,res)=>{
    const {buyerId} = req.params;
    if(!buyerId) throw new apiError(400,"buyer id is required");

    const buyer = await prisma.user.findFirst({
        where:{id:buyerId,role:"BUYER"},
        select:{
            id:true,
            name:true,
            email:true,
            phone:true,
            profileImg:true,
            billingPlan:true,
            isVerified:true,
            isBlocked:true,
            createdAt:true,
            updatedAt:true,
            orders:{
                take:10,
                orderBy:{createdAt:"desc"},
                select:{
                    id:true,
                    shopId:true,
                    currentOrderStatus:true,
                    totalAmount:true,
                    paidAmount:true,
                    refundAmount:true,
                    createdAt:true,
                    shop:{select:{id:true,shopName:true}}
                }
            },
            _count:{select:{orders:true}}
        }
    });

    if(!buyer) throw new apiError(404,"buyer not found");

    const totals = await prisma.order.aggregate({
        where:{userId:buyerId,currentOrderStatus:"COMPLETED"},
        _count:{id:true},
        _sum:{totalAmount:true,paidAmount:true,refundAmount:true}
    });

    return res.status(200).json(new apiResponse(200,{
        ...buyer,
        summary:{
            completedOrders:totals._count.id || 0,
            grossSpend:totals._sum.totalAmount || 0,
            paidAmount:totals._sum.paidAmount || 0,
            refundAmount:totals._sum.refundAmount || 0,
            netSpend:(totals._sum.paidAmount || 0) - (totals._sum.refundAmount || 0)
        }
    },"admin buyer details fetched successfully"));
});

const fetchAdminSellerById = asyncHandler(async(req,res)=>{
    const {sellerId} = req.params;
    if(!sellerId) throw new apiError(400,"seller id is required");

    const seller = await prisma.user.findFirst({
        where:{id:sellerId,role:"SELLER"},
        select:{
            id:true,
            name:true,
            email:true,
            phone:true,
            profileImg:true,
            billingPlan:true,
            isVerified:true,
            isBlocked:true,
            createdAt:true,
            updatedAt:true,
            shops:{
                orderBy:{createdAt:"desc"},
                select:{
                    id:true,
                    shopName:true,
                    slug:true,
                    ShopOpenStatus:true,
                    status:true,
                    Verified:true,
                    billingStatus:true,
                    shopBalance:true,
                    totalSlots:true,
                    usedSlots:true,
                    createdAt:true
                }
            }
        }
    });

    if(!seller) throw new apiError(404,"seller not found");

    const shopIds = seller.shops.map((shop)=>shop.id);
    const totals = shopIds.length ? await prisma.order.aggregate({
        where:{shopId:{in:shopIds},currentOrderStatus:"COMPLETED"},
        _count:{id:true},
        _sum:{totalAmount:true,paidAmount:true,refundAmount:true}
    }) : {_count:{id:0},_sum:{}};

    return res.status(200).json(new apiResponse(200,{
        ...seller,
        summary:{
            shopCount:seller.shops.length,
            completedOrders:totals._count.id || 0,
            grossRevenue:totals._sum.totalAmount || 0,
            paidRevenue:totals._sum.paidAmount || 0,
            refundAmount:totals._sum.refundAmount || 0,
            netRevenue:(totals._sum.paidAmount || 0) - (totals._sum.refundAmount || 0)
        }
    },"admin seller details fetched successfully"));
});

const updateAdminUserStatus = asyncHandler(async(req,res)=>{
    const userId = req.params.buyerId || req.params.sellerId;
    const expectedRole = req.params.buyerId ? "BUYER" : "SELLER";
    if(!userId) throw new apiError(400,"user id is required");

    const {isBlocked, blocked, status} = req.body;
    const dataToUpdate = {};

    if(isBlocked !== undefined || blocked !== undefined){
        dataToUpdate.isBlocked = Boolean(isBlocked ?? blocked);
    }else if(status !== undefined){
        const normalizedStatus = String(status).trim().toUpperCase();
        if(!["ACTIVE","BLOCKED","SUSPENDED"].includes(normalizedStatus)){
            throw new apiError(400,"status must be ACTIVE, BLOCKED, or SUSPENDED");
        }
        dataToUpdate.isBlocked = normalizedStatus !== "ACTIVE";
    }else{
        throw new apiError(400,"isBlocked or status is required");
    }

    const user = await prisma.user.findFirst({
        where:{id:userId,role:expectedRole},
        select:{id:true}
    });
    if(!user) throw new apiError(404,`${expectedRole.toLowerCase()} not found`);

    const updatedUser = await prisma.user.update({
        where:{id:userId},
        data:dataToUpdate,
        select:{id:true,name:true,email:true,phone:true,role:true,isBlocked:true}
    });

    return res.status(200).json(new apiResponse(200,updatedUser,`${expectedRole.toLowerCase()} status updated successfully`));
});


const fetchUserProfile = asyncHandler(async (req, res) => {
    const id = req.userData?.id;

    if (!id) {
        throw new apiError(401, "Unauthorized user");
    }

    const user = await prisma.user.findUnique({
        where: {
            id,
        },
    });

    if (!user || user.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    return res
        .status(200)
        .json(new apiResponse(200, user, "User profile fetched successfully"));
});

// admin
const deleteUser = asyncHandler(async (req, res) => {
    const id = req.params.userId;

    if (!id) {
        throw new apiError(400, "Invalid user id");
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            id,
        },
        select: {
            id: true,
        },
    });

    if (!existingUser) {
        throw new apiError(404, "User not found");
    }

    const isDeleted = await prisma.user.delete({
        where: {
            id,
        },
    });
if(!isDeleted) throw new apiError(400,"user deletion error")
    return res
        .status(200)
        .json(new apiResponse(200, null, "User deleted successfully"));
});

// admin
const editUserData = asyncHandler(async (req, res) => {
    const id = req.params.userId;

    if (!id) {
        throw new apiError(400, "Invalid user id");
    }

    const isAdminUser = req.currentUser?.role === "ADMIN";
    const allowedFields = isAdminUser ? adminEditableFields : userEditableFields;

    const updateData = {};

    allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
        }
    });

    if (updateData.role !== undefined) {
        updateData.role = normalizeRole(updateData.role);
    }

    if (!isAdminUser && req.body.role !== undefined) {
        const requestedRole = normalizeRole(req.body.role);

        if (requestedRole === "ADMIN" || requestedRole === "SUPER") {
            throw new apiError(403, "Only admins can assign admin role");
        }

        if (!selfAssignableRoles.includes(requestedRole)) {
            throw new apiError(400, "Invalid user role");
        }

        updateData.role = requestedRole;
    }

    if (updateData.role !== undefined && !userRoles.includes(updateData.role)) {
        throw new apiError(400, "Invalid user role");
    }

    if (!Object.keys(updateData).length) {
        throw new apiError(400, "No valid user fields received");
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            id,
        },
        select: {
            id: true,
        },
    });

    if (!existingUser) {
        throw new apiError(404, "User not found");
    }

    const user = await prisma.user.update({
        where: {
            id,
        },
        data: updateData,
    });

    return res
        .status(200)
        .json(new apiResponse(200, user, "User updated successfully"));
});

const editOwnUserData = asyncHandler(async (req, res) => {
    const id = req.userData?.id;

    if (!id) {
        throw new apiError(401, "Unauthorized user");
    }

    const currentUser = await prisma.user.findUnique({
        where: {
            id,
        },
        select: {
            id: true,
            role: true,
            isBlocked: true,
        },
    });

    if (!currentUser || currentUser.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    if (!selfAssignableRoles.includes(currentUser.role)) {
        throw new apiError(403, "Only buyers and sellers can edit their own data here");
    }

    const updateData = {};

    userEditableFields.forEach((field) => {
        if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
        }
    });

    const avatarFilePath = req.files?.avatar?.[0]?.path;
        // if(!avatarFilePath) console.warn("No files found from user")


    if (avatarFilePath) {
        const uploadStatus = await cloudUploader(avatarFilePath);

        if (!uploadStatus?.url) {
            throw new apiError(400, "Avatar upload failed");
        }

        updateData.profileImg = uploadStatus.url;
    }

    if (!Object.keys(updateData).length) {
        throw new apiError(400, "No valid user fields or avatar received");
    }

    const user = await prisma.user.update({
        where: {
            id,
        },
        data: updateData,
    });

    return res
        .status(200)
        .json(new apiResponse(200, user, "User data updated successfully"));
});
// admin
const toggleUserSuspension = asyncHandler(async (req, res) => {
    const id = req.params.userId;

    if (!id) {
        throw new apiError(400, "Invalid user id");
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            id,
        },
        select: {
            id: true,
            isBlocked: true,
        },
    });

    if (!existingUser) {
        throw new apiError(404, "User not found");
    }

    const user = await prisma.user.update({
        where: {
            id,
        },
        data: {
            isBlocked: !existingUser.isBlocked,
        },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            isBlocked: true,
        },
    });

    const action = user.isBlocked ? "suspended" : "unsuspended";

    return res
        .status(200)
        .json(new apiResponse(200, user, `User ${action} successfully`));
});
// admin
const fetchAllSellers = asyncHandler(async(req,res)=>{
    const skip = getPaginationSkip(req);

    const allData = await prisma.user.findMany({
        where:{
            role:"SELLER"
        },
        skip,
        take:10,
        orderBy:{
            createdAt:"asc"
        }
    })
    if(!allData) throw new apiError(400,"sellers fetching failed")
    return res.json(new apiResponse(200,allData,"All sellers fetched"))
})
// admin
const fetchAllBuyers= asyncHandler(async(req,res)=>{
    const skip = getPaginationSkip(req);

    const allData = await prisma.user.findMany({
        where:{
            role:"BUYER"
        },
        skip,
        take:10,
        orderBy:{
            createdAt:"asc"
        }
    })

    if(!allData) throw new apiError(400,"buyers fetching failed")
    return res.json(new apiResponse(200,allData,"All buyers fetched"))
})


export {
    fetchAllUsers,
    fetchAllUserOverviewData,
    fetchAdminShops,
    fetchAdminShopById,
    fetchAdminBuyerById,
    fetchAdminSellerById,
    updateAdminUserStatus,
    fetchUserProfile,
    deleteUser,
    editUserData,
    editOwnUserData,
    toggleUserSuspension,
    fetchAllSellers,
    fetchAllBuyers
};

import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { threadCpuUsage } from "process";

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
                currentOrderStatus:"DONE"
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
            notificationsSent:"No notification model found in current Prisma schema",
            activeSlotsPeak:"No slot package model found in current Prisma schema",
            orderCommission:"No commission field or model found in current Prisma schema"
        }
    };

    return res.status(200).json(new apiResponse(200,overview,"User overview data fetched successfully"));
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
const SuspendUser = asyncHandler(async (req, res) => {
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

    const user = await prisma.user.update({
        where: {
            id,
        },
        data: {
            isBlocked: true,
        },
    });

    return res
        .status(200)
        .json(new apiResponse(200, user, "User suspended successfully"));
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


export { fetchAllUsers, fetchAllUserOverviewData, fetchUserProfile, deleteUser, editUserData, editOwnUserData, SuspendUser ,fetchAllSellers,fetchAllBuyers};

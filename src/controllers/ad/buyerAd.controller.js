import { prisma } from "../../db/index.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const adTargets = ["GLOBAL", "INDIVIDUAL"];

const parseJsonArray = (value, fieldName) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
    } catch (error) {
    }

    throw new apiError(400, `${fieldName} must be a valid JSON array`);
};

const parseBoolean = (value) => {
    if (typeof value === "boolean") return value;
    if (["true", "1", "yes", "on"].includes(String(value).toLowerCase())) return true;
    if (["false", "0", "no", "off"].includes(String(value).toLowerCase())) return false;
    return null;
};

const normalizeBuyerIds = async (target, buyerIds = []) => {
    const uniqueBuyerIds = [...new Set(buyerIds.filter(Boolean).map(String))];

    if (target === "GLOBAL") return [];
    if (!uniqueBuyerIds.length) throw new apiError(400, "buyerIds are required for individual buyer ads");

    const buyerCount = await prisma.user.count({
        where: {
            id: {
                in: uniqueBuyerIds,
            },
            role: "BUYER",
            isBlocked: false,
        },
    });

    if (buyerCount !== uniqueBuyerIds.length) {
        throw new apiError(400, "one or more buyerIds are invalid");
    }

    return uniqueBuyerIds;
};

const getBuyerAdImageUrl = async (req, existingImageUrl = null) => {
    const filePath = req.files?.buyerAdImg?.[0]?.path;
    if (!filePath) return req.body.imageUrl || existingImageUrl;

    const uploadStatus = await cloudUploader(filePath);
    if (!uploadStatus?.url) throw new apiError(500, "buyer ad image upload failed");

    return uploadStatus.url;
};

const formatBuyerAd = (ad) => ({
    ...ad,
    buyerTargets: ad.buyerTargets?.map((target) => target.buyer) || [],
});

const createBuyerAd = asyncHandler(async (req, res) => {
    const {
        name,
        description,
        linkUrl,
        target = "GLOBAL",
        startsAt,
        endsAt,
    } = req.body;

    const normalizedTarget = String(target).trim().toUpperCase();
    if (!name) throw new apiError(400, "buyer ad name is required");
    if (!adTargets.includes(normalizedTarget)) throw new apiError(400, "invalid buyer ad target");

    const imageUrl = await getBuyerAdImageUrl(req);
    if (!imageUrl) throw new apiError(400, "buyer ad image is required");

    const startDate = startsAt ? new Date(startsAt) : new Date();
    const endDate = new Date(endsAt);
    if (!endsAt || Number.isNaN(endDate.getTime())) throw new apiError(400, "valid endsAt is required");
    if (Number.isNaN(startDate.getTime()) || endDate <= startDate) {
        throw new apiError(400, "endsAt must be after startsAt");
    }

    const buyerIds = await normalizeBuyerIds(normalizedTarget, parseJsonArray(req.body.buyerIds, "buyerIds"));

    const buyerAd = await prisma.buyerAds.create({
        data: {
            name,
            description,
            imageUrl,
            linkUrl,
            target: normalizedTarget,
            startsAt: startDate,
            endsAt: endDate,
            buyerTargets: buyerIds.length
                ? {
                    create: buyerIds.map((buyerId) => ({ buyerId })),
                }
                : undefined,
        },
        include: {
            buyerTargets: {
                include: {
                    buyer: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });

    return res.status(201).json(new apiResponse(201, formatBuyerAd(buyerAd), "buyer ad created successfully"));
});

const fetchAllBuyerAdsForAdmin = asyncHandler(async (req, res) => {
    const ads = await prisma.buyerAds.findMany({
        orderBy: {
            createdAt: "desc",
        },
        include: {
            buyerTargets: {
                include: {
                    buyer: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });

    return res.status(200).json(new apiResponse(200, ads.map(formatBuyerAd), "buyer ads fetched successfully"));
});

const fetchBuyerAdByIdForAdmin = asyncHandler(async (req, res) => {
    const { buyerAdId } = req.params;

    const buyerAd = await prisma.buyerAds.findUnique({
        where: {
            id: buyerAdId,
        },
        include: {
            buyerTargets: {
                include: {
                    buyer: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });

    if (!buyerAd) throw new apiError(404, "buyer ad not found");

    return res.status(200).json(new apiResponse(200, formatBuyerAd(buyerAd), "buyer ad fetched successfully"));
});

const updateBuyerAd = asyncHandler(async (req, res) => {
    const { buyerAdId } = req.params;

    const existingAd = await prisma.buyerAds.findUnique({
        where: {
            id: buyerAdId,
        },
        select: {
            id: true,
            imageUrl: true,
            target: true,
        },
    });

    if (!existingAd) throw new apiError(404, "buyer ad not found");

    const normalizedTarget = req.body.target
        ? String(req.body.target).trim().toUpperCase()
        : existingAd.target;
    if (!adTargets.includes(normalizedTarget)) throw new apiError(400, "invalid buyer ad target");

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.linkUrl !== undefined) data.linkUrl = req.body.linkUrl;
    if (req.body.target !== undefined) data.target = normalizedTarget;

    const active = req.body.active !== undefined ? parseBoolean(req.body.active) : null;
    if (req.body.active !== undefined && active === null) throw new apiError(400, "active must be true or false");
    if (active !== null) data.active = active;

    if (req.body.startsAt !== undefined) {
        const startDate = new Date(req.body.startsAt);
        if (Number.isNaN(startDate.getTime())) throw new apiError(400, "valid startsAt is required");
        data.startsAt = startDate;
    }

    if (req.body.endsAt !== undefined) {
        const endDate = new Date(req.body.endsAt);
        if (Number.isNaN(endDate.getTime())) throw new apiError(400, "valid endsAt is required");
        data.endsAt = endDate;
    }

    const imageUrl = await getBuyerAdImageUrl(req, existingAd.imageUrl);
    if (imageUrl) data.imageUrl = imageUrl;

    let buyerIds = null;
    if (req.body.buyerIds !== undefined || normalizedTarget === "GLOBAL") {
        buyerIds = await normalizeBuyerIds(normalizedTarget, parseJsonArray(req.body.buyerIds, "buyerIds"));
    }

    const buyerAd = await prisma.$transaction(async (tx) => {
        if (buyerIds !== null) {
            await tx.buyerAdTarget.deleteMany({
                where: {
                    buyerAdId,
                },
            });
        }

        return tx.buyerAds.update({
            where: {
                id: buyerAdId,
            },
            data: {
                ...data,
                buyerTargets: buyerIds?.length
                    ? {
                        create: buyerIds.map((buyerId) => ({ buyerId })),
                    }
                    : undefined,
            },
            include: {
                buyerTargets: {
                    include: {
                        buyer: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                phone: true,
                                role: true,
                            },
                        },
                    },
                },
            },
        });
    });

    return res.status(200).json(new apiResponse(200, formatBuyerAd(buyerAd), "buyer ad updated successfully"));
});

const updateBuyerAdActiveStatus = asyncHandler(async (req, res) => {
    const { buyerAdId } = req.params;
    const active = parseBoolean(req.body.active);

    if (active === null) throw new apiError(400, "active must be true or false");

    const buyerAd = await prisma.buyerAds.update({
        where: {
            id: buyerAdId,
        },
        data: {
            active,
        },
    }).catch(() => null);

    if (!buyerAd) throw new apiError(404, "buyer ad not found");

    return res.status(200).json(new apiResponse(200, buyerAd, `buyer ad ${active ? "activated" : "deactivated"} successfully`));
});

const deleteBuyerAd = asyncHandler(async (req, res) => {
    const { buyerAdId } = req.params;

    const existingAd = await prisma.buyerAds.findUnique({
        where: {
            id: buyerAdId,
        },
        select: {
            id: true,
        },
    });

    if (!existingAd) throw new apiError(404, "buyer ad not found");

    await prisma.buyerAds.delete({
        where: {
            id: buyerAdId,
        },
    });

    return res.status(200).json(new apiResponse(200, null, "buyer ad deleted successfully"));
});

const fetchBuyerSideAds = asyncHandler(async (req, res) => {
    const buyerId = req.userData?.id;
    const now = new Date();

    const ads = await prisma.buyerAds.findMany({
        where: {
            active: true,
            startsAt: {
                lte: now,
            },
            endsAt: {
                gt: now,
            },
            OR: [
                {
                    target: "GLOBAL",
                },
                {
                    target: "INDIVIDUAL",
                    buyerTargets: {
                        some: {
                            buyerId,
                        },
                    },
                },
            ],
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    return res.status(200).json(new apiResponse(200, ads, "buyer side ads fetched successfully"));
});

export {
    createBuyerAd,
    deleteBuyerAd,
    fetchAllBuyerAdsForAdmin,
    fetchBuyerAdByIdForAdmin,
    fetchBuyerSideAds,
    updateBuyerAd,
    updateBuyerAdActiveStatus,
};

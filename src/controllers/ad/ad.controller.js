import { prisma } from "../../db/index.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const placements = ["SELLER_DASHBOARD", "SELLER_HOME", "BUYER_EXPLORE", "BUYER_SHOP_PAGE"];
const targetModes = ["ALL_SELLERS", "TARGETED_SELLERS"];
const placementImageMap = {
    SELLER_DASHBOARD: "sellerDashboardImageUrl",
    SELLER_HOME: "sellerHomeImageUrl",
    BUYER_EXPLORE: "buyerExploreImageUrl",
    BUYER_SHOP_PAGE: "buyerShopPageImageUrl",
};
const sellerAdPlacements = ["SELLER_DASHBOARD", "SELLER_HOME"];
const buyerAdPlacements = ["BUYER_EXPLORE", "BUYER_SHOP_PAGE"];
const placementCheckboxMap = {
    SELLER_DASHBOARD: ["SELLER_DASHBOARD", "sellerDashboard"],
    SELLER_HOME: ["SELLER_HOME", "sellerHome"],
    BUYER_EXPLORE: ["BUYER_EXPLORE", "buyerExplore"],
    BUYER_SHOP_PAGE: ["BUYER_SHOP_PAGE", "buyerShopPage"],
};
const allPlacementRequests = ["ALL", "EVERYTHING"];

const isChecked = (value) => ["true", "1", "on", "yes"].includes(String(value).toLowerCase());

const parseSelectedPlacements = (selectedPlacements, placement, body) => {
    const checkboxPlacements = placements.filter((adPlacement) => (
        placementCheckboxMap[adPlacement].some((field) => isChecked(body[field]))
    ));
    if (checkboxPlacements.length) return checkboxPlacements;

    if (selectedPlacements) {
        if (Array.isArray(selectedPlacements)) return selectedPlacements;

        try {
            const parsedPlacements = JSON.parse(selectedPlacements);
            if (Array.isArray(parsedPlacements)) return parsedPlacements;
        } catch (error) {
        }

        return String(selectedPlacements)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return placement ? [placement] : [];
};

const uploadAdImage = async (req, fileField, adPlacement) => {
    const filePath = req.files?.[fileField]?.[0]?.path;
    console.log(filePath);
    
    if (!filePath) throw new apiError(400, `image not passed for ${adPlacement}`);

    const uploadStatus = await cloudUploader(filePath);
    if (!uploadStatus?.url) throw new apiError(500, `failed to upload image for ${adPlacement}`);

    return uploadStatus.url;
};

const createAd = asyncHandler(async (req, res) => {
    const {
        name,
        description,
        linkUrl,
        placement,
        placements: selectedPlacements,
        targetMode = "ALL_SELLERS",
        shopIds,
        startsAt,
        endsAt,
    } = req.body;

    if (!name) throw new apiError(400, "ad name is required");
    if (placement && !placements.includes(placement)) throw new apiError(400, "invalid ad placement");
    const adPlacements = [...new Set(parseSelectedPlacements(selectedPlacements, placement, req.body))];
    if (!adPlacements.length) throw new apiError(400, "at least one ad placement is required");
    const invalidPlacement = adPlacements.find((adPlacement) => !placements.includes(adPlacement));
    if (invalidPlacement) throw new apiError(400, "invalid ad placement");
    if (!targetModes.includes(targetMode)) throw new apiError(400, "invalid ad target mode");

    const startDate = startsAt ? new Date(startsAt) : new Date();
    const endDate = new Date(endsAt);
    if (!endsAt || Number.isNaN(endDate.getTime())) throw new apiError(400, "valid ad endsAt is required");
    if (Number.isNaN(startDate.getTime()) || endDate <= startDate) {
        throw new apiError(400, "ad endsAt must be after startsAt");
    }

    const finalImages = {
        imageUrl: null,
        sellerDashboardImageUrl: null,
        sellerHomeImageUrl: null,
        buyerExploreImageUrl: null,
        buyerShopPageImageUrl: null,
    };

    if (adPlacements.includes("SELLER_DASHBOARD")) {
        finalImages.sellerDashboardImageUrl = await uploadAdImage(req, "sellerDashboardImg", "SELLER_DASHBOARD");
    }

    if (adPlacements.includes("SELLER_HOME")) {
        finalImages.sellerHomeImageUrl = await uploadAdImage(req, "sellerHomeImg", "SELLER_HOME");
    }

    if (adPlacements.includes("BUYER_EXPLORE")) {
        finalImages.buyerExploreImageUrl = await uploadAdImage(req, "buyerExploreImg", "BUYER_EXPLORE");
    }

    if (adPlacements.includes("BUYER_SHOP_PAGE")) {
        finalImages.buyerShopPageImageUrl = await uploadAdImage(req, "buyerShopPageImg", "BUYER_SHOP_PAGE");
    }

    if (adPlacements.length === 1) {
        finalImages.imageUrl = finalImages[placementImageMap[adPlacements[0]]];
    }

    let parsedShopIds = [];
    if (targetMode === "TARGETED_SELLERS") {
        try {
            parsedShopIds = Array.isArray(shopIds) ? shopIds : JSON.parse(shopIds || "[]");
        } catch (error) {
            throw new apiError(400, "shopIds must be a valid JSON array");
        }

        parsedShopIds = [...new Set(parsedShopIds.filter(Boolean))];
        if (!parsedShopIds.length) throw new apiError(400, "shopIds are required for targeted seller ads");

        const shopCount = await prisma.shop.count({ where: { id: { in: parsedShopIds } } });
        if (shopCount !== parsedShopIds.length) throw new apiError(400, "one or more target shops are invalid");
    }

    const ad = await prisma.ad.create({
        data: {
            name,
            description,
            ...finalImages,
            linkUrl,
            placement: adPlacements.length === 1 ? adPlacements[0] : null,
            targetMode,
            startsAt: startDate,
            endsAt: endDate,
            sellerTargets: parsedShopIds.length
                ? { create: parsedShopIds.map((shopId) => ({ shopId })) }
                : undefined,
        },
        include: {
            sellerTargets: true,
        },
    });
    if(!ad) throw new apiError(401, "ad creation failure")
    return res.status(201).json(new apiResponse(201, ad, "ad created successfully"));
});

const fetchActiveAds = asyncHandler(async (req, res) => {
    const { shopId } = req.query;
    const requestedPlacement = String(req.query.placement || "").trim().toUpperCase();
    const fetchEverything = isChecked(req.query.everything)
        || isChecked(req.query.all)
        || allPlacementRequests.includes(requestedPlacement);
    const hasSpecificPlacement = placements.includes(requestedPlacement);
    const now = new Date();

    if (!fetchEverything && requestedPlacement && !hasSpecificPlacement) {
        throw new apiError(400, "valid ad placement is required");
    }
    if (!fetchEverything && !shopId && !hasSpecificPlacement) {
        throw new apiError(400, "valid ad placement is required");
    }

    const ads = await prisma.ad.findMany({
        where: {
            active: true,
            startsAt: { lte: now },
            endsAt: { gt: now },
            AND: [
                (!fetchEverything && hasSpecificPlacement)
                    ? {
                        OR: [
                            { [placementImageMap[requestedPlacement]]: { not: null } },
                            { placement: requestedPlacement, imageUrl: { not: null } },
                        ],
                        AND: [{
                            OR: [
                                { placement: requestedPlacement },
                                { placement: null },
                            ],
                        }],
                    }
                    : {
                        OR: placements.flatMap((adPlacement) => ([
                            { [placementImageMap[adPlacement]]: { not: null } },
                            { placement: adPlacement, imageUrl: { not: null } },
                        ])),
                    },
                {
                    OR: [
                        { targetMode: "ALL_SELLERS" },
                        shopId ? { sellerTargets: { some: { shopId: String(shopId) } } } : { id: "" },
                    ],
                },
            ],
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    const data = (!fetchEverything && hasSpecificPlacement)
        ? ads.map((ad) => {
            const {
                sellerDashboardImageUrl,
                sellerHomeImageUrl,
                buyerExploreImageUrl,
                buyerShopPageImageUrl,
                ...adData
            } = ad;

            return {
                ...adData,
                imageUrl: ad[placementImageMap[requestedPlacement]] || ad.imageUrl,
            };
        })
        : ads;

    return res.status(200).json(new apiResponse(200, data, "ads fetched successfully"));
});

const fetchSellerAds = asyncHandler(async (req, res) => {
    const sellerId = req.userData?.id;
    const requestedPlacement = String(req.query.placement || "").trim().toUpperCase();
    const hasSpecificPlacement = sellerAdPlacements.includes(requestedPlacement);
    const now = new Date();

    if (requestedPlacement && !hasSpecificPlacement) {
        throw new apiError(400, "valid seller ad placement is required");
    }

    const shops = await prisma.shop.findMany({
        where: {
            ownerId: sellerId,
        },
        select: {
            id: true,
        },
    });

    const sellerShopIds = shops.map((shop) => shop.id);

    const ads = await prisma.ad.findMany({
        where: {
            active: true,
            startsAt: { lte: now },
            endsAt: { gt: now },
            AND: [
                hasSpecificPlacement
                    ? {
                        OR: [
                            { [placementImageMap[requestedPlacement]]: { not: null } },
                            { placement: requestedPlacement, imageUrl: { not: null } },
                        ],
                        AND: [{
                            OR: [
                                { placement: requestedPlacement },
                                { placement: null },
                            ],
                        }],
                    }
                    : {
                        OR: sellerAdPlacements.flatMap((adPlacement) => ([
                            { [placementImageMap[adPlacement]]: { not: null } },
                            { placement: adPlacement, imageUrl: { not: null } },
                        ])),
                    },
                {
                    OR: [
                        { targetMode: "ALL_SELLERS" },
                        sellerShopIds.length
                            ? { sellerTargets: { some: { shopId: { in: sellerShopIds } } } }
                            : { id: "" },
                    ],
                },
            ],
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    const data = hasSpecificPlacement
        ? ads.map((ad) => {
            const {
                sellerDashboardImageUrl,
                sellerHomeImageUrl,
                buyerExploreImageUrl,
                buyerShopPageImageUrl,
                ...adData
            } = ad;

            return {
                ...adData,
                imageUrl: ad[placementImageMap[requestedPlacement]] || ad.imageUrl,
            };
        })
        : ads;

    return res.status(200).json(new apiResponse(
        200,
        data,
        "seller ads fetched successfully"
    ));
});

const fetchBuyerAds = asyncHandler(async (req, res) => {
    const { shopId } = req.query;
    const requestedPlacement = String(req.query.placement || "").trim().toUpperCase();
    const hasSpecificPlacement = buyerAdPlacements.includes(requestedPlacement);
    const now = new Date();

    if (requestedPlacement && !hasSpecificPlacement) {
        throw new apiError(400, "valid buyer ad placement is required");
    }

    const ads = await prisma.ad.findMany({
        where: {
            active: true,
            startsAt: { lte: now },
            endsAt: { gt: now },
            AND: [
                hasSpecificPlacement
                    ? {
                        OR: [
                            { [placementImageMap[requestedPlacement]]: { not: null } },
                            { placement: requestedPlacement, imageUrl: { not: null } },
                        ],
                        AND: [{
                            OR: [
                                { placement: requestedPlacement },
                                { placement: null },
                            ],
                        }],
                    }
                    : {
                        OR: buyerAdPlacements.flatMap((adPlacement) => ([
                            { [placementImageMap[adPlacement]]: { not: null } },
                            { placement: adPlacement, imageUrl: { not: null } },
                        ])),
                    },
                {
                    OR: [
                        { targetMode: "ALL_SELLERS" },
                        shopId ? { sellerTargets: { some: { shopId: String(shopId) } } } : { id: "" },
                    ],
                },
            ],
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    const data = hasSpecificPlacement
        ? ads.map((ad) => {
            const {
                sellerDashboardImageUrl,
                sellerHomeImageUrl,
                buyerExploreImageUrl,
                buyerShopPageImageUrl,
                ...adData
            } = ad;

            return {
                ...adData,
                imageUrl: ad[placementImageMap[requestedPlacement]] || ad.imageUrl,
            };
        })
        : ads;

    return res.status(200).json(new apiResponse(
        200,
        data,
        "buyer ads fetched successfully"
    ));
});


const updateAdActiveStatus = asyncHandler(async (req, res) => {
    const { adId } = req.params;
    let active = null;

    if (typeof req.body.active === "boolean") active = req.body.active;

    if (["true"].includes(String(req.body.active).toLowerCase())) active = true;

    if (["false"].includes(String(req.body.active).toLowerCase())) active = false;

    if (!adId) throw new apiError(400, "adId is required");
    if (active === null) throw new apiError(400, "active must be true or false");

    const existingAd = await prisma.ad.findUnique({
        where: { id: adId },
        select: { id: true },
    });

    if (!existingAd) throw new apiError(404, "ad not found");

    const ad = await prisma.ad.update({
        where: { id: adId },
        data: { active },
        include: {
            sellerTargets: true,
        },
    });

    if(!ad) throw new apiError(401, "Ad status updation failed!")

    return res.status(200).json(new apiResponse(200, ad, `ad ${active ? "activated" : "deactivated"} successfully`));
});

const deleteAd = asyncHandler(async (req, res) => {
    const { adId } = req.params;

    if (!adId) throw new apiError(400, "adId is required");

    const existingAd = await prisma.ad.findUnique({
        where: {
            id: adId,
        },
        select: {
            id: true,
        },
    });

    if (!existingAd) throw new apiError(404, "ad not found");

    await prisma.ad.delete({
        where: {
            id: adId,
        },
    });

    return res.status(200).json(new apiResponse(200, null, "ad deleted successfully"));
});

export { createAd, deleteAd, fetchActiveAds, fetchBuyerAds, fetchSellerAds, updateAdActiveStatus };

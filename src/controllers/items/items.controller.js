import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { deleteCacheByPattern, getOrSetCachedData } from "../../utils/cache.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import { formatShopFeatureMap, shopHasFeature } from "../../utils/shopFeatures.js";
import { releaseShopSlot, reserveShopSlot } from "../../utils/billing.js";
import {
    formatShopItemPricing,
    normalizeShopItemPricingInput
} from "../../utils/shopItemVariants.js";

const MASTER_ITEMS_CACHE_TTL = 120;
const SHOP_ITEMS_CACHE_TTL = 45;
const VALID_SHOP_ITEM_UNITS = ["KG","GRAM","LITRE","ML","PIECE","DOZEN","PACK","BUNCH","BOX","CUSTOM"];
const VALID_VARIANT_PACKAGING_TYPES = ["LOOSE","PACKAGED","CUSTOM"];

const invalidateMasterItemCaches = async({includeShopItems = true} = {})=>{
    const invalidations = [deleteCacheByPattern("catalog:master:items:*")];
    if(includeShopItems){
        invalidations.push(deleteCacheByPattern("catalog:shop:*:items:*"));
    }
    await Promise.all(invalidations);
};

const invalidateShopItemCaches = async(shopId)=>{
    if(!shopId) return;
    await Promise.all([
        deleteCacheByPattern(`catalog:shop:${shopId}:items:*`),
        deleteCacheByPattern(`catalog:shop:${shopId}:combos:*`),
        deleteCacheByPattern(`catalog:shop:${shopId}:running-menus:*`),
        deleteCacheByPattern(`buyer:shop:full:*:${shopId}`),
        deleteCacheByPattern(`buyer:shop:${shopId}:*`),
        deleteCacheByPattern("buyer:shop:slug:*")
    ]);
};

const masterItemInclude = {
    category:{
        select:{
            id:true,
            name:true,
            slug:true,
            cuisineId:true
        }
    },
    tags:{
        select:{
            tag:{
                select:{
                    id:true,
                    name:true,
                    slug:true
                }
            }
        }
    }
};

const masterItemListSelect = {
    id:true,
    name:true,
    description:true,
    imageUrl:true,
    sortOrderId:true,
    categoryId:true,
    active:true,
    category:{
        select:{
            id:true,
            name:true,
            slug:true,
            cuisineId:true
        }
    }
};

const formatMasterItemListItem = (item)=>({
    id:item.id,
    name:item.name,
    description:item.description,
    imageUrl:item.imageUrl,
    sortOrderId:item.sortOrderId,
    active:item.active,
    categoryId:item.categoryId,
    categoryName:item.category?.name || null,
    categorySlug:item.category?.slug || null,
    cuisineId:item.category?.cuisineId || null,
    cuisineName:item.category?.cuisine?.name || null,
    cuisineSlug:item.category?.cuisine?.slug || null,
    alreadyAdded:item.shopItems ? item.shopItems.length > 0 : undefined
});

const shopItemInclude = {
    item:{
        include:masterItemInclude
    },
    brand:{
        select:{
            id:true,
            name:true,
            slug:true,
            imageUrl:true
        }
    },
    variantGroups:{
        orderBy:{sortOrder:"asc"},
        include:{
            options:{
                orderBy:{sortOrder:"asc"}
            }
        }
    }
};

const shopItemVariantSelect = {
    id:true,
    name:true,
    required:true,
    minSelect:true,
    maxSelect:true,
    sortOrder:true,
    active:true,
    options:{
        orderBy:{sortOrder:"asc"},
        select:{
            id:true,
            label:true,
            subLabel:true,
            amount:true,
            price:true,
            packagingType:true,
            unit:true,
            displayUnit:true,
            quantityValue:true,
            minOrderQuantity:true,
            maxOrderQuantity:true,
            quantityStep:true,
            allowCustomQuantity:true,
            availableQuantity:true,
            availableQuantityValue:true,
            sortOrder:true,
            active:true
        }
    }
};

const shopItemListSelect = {
    id:true,
    itemId:true,
    brandId:true,
    brand:{
        select:{
            id:true,
            name:true,
            slug:true,
            imageUrl:true
        }
    },
    pricing:true,
    availableQuantity:true,
    imageUrl:true,
    description:true,
    prescriptionRequired:true,
    prescriptionNote:true,
    sortOrderId:true,
    active:true,
    item:{
        select:{
            id:true,
            name:true,
            imageUrl:true,
            categoryId:true,
            category:{
                select:{
                    id:true,
                    name:true,
                    slug:true,
                    cuisineId:true
                }
            }
        }
    },
    variantGroups:{
        orderBy:{sortOrder:"asc"},
        select:shopItemVariantSelect
    }
};

const formatShopItemVariantGroups = (variantGroups = [])=>variantGroups.map((group)=>({
    id:group.id,
    name:group.name,
    required:group.required,
    minSelect:group.minSelect,
    maxSelect:group.maxSelect,
    sortOrder:group.sortOrder,
    active:group.active,
    options:group.options?.map((option)=>({
        id:option.id,
        label:option.label,
        subLabel:option.subLabel,
        amount:option.amount,
        price:option.price ?? null,
        packagingType:option.packagingType || null,
        unit:option.unit || null,
        displayUnit:option.displayUnit || null,
        quantityValue:option.quantityValue ?? null,
        minOrderQuantity:option.minOrderQuantity ?? null,
        maxOrderQuantity:option.maxOrderQuantity ?? null,
        quantityStep:option.quantityStep ?? null,
        allowCustomQuantity:option.allowCustomQuantity ?? false,
        availableQuantity:option.availableQuantity ?? null,
        availableQuantityValue:option.availableQuantityValue ?? null,
        sortOrder:option.sortOrder,
        active:option.active
    })) || []
}));

const calculateShopItemLowestPrice = (shopItem)=>{
    const basePrice = Number(shopItem.pricing);
    if(!Number.isFinite(basePrice) || basePrice < 0) return 0;

    const variantAmount = (shopItem.variantGroups || []).reduce((total,group)=>{
        if(!group.active) return total;

        const activeOptions = (group.options || [])
            .filter((option)=>option.active)
            .map((option)=>option.price !== null && option.price !== undefined ? Number(option.price) : Number(option.amount))
            .filter((amount)=>Number.isFinite(amount) && amount >= 0)
            .sort((first,second)=>first - second);
        const minSelect = Math.max(Number(group.minSelect || 0),group.required ? 1 : 0);

        if(minSelect <= 0 || activeOptions.length === 0) return total;
        return total + activeOptions.slice(0,minSelect).reduce((sum,amount)=>sum + amount,0);
    },0);

    return Math.max(0,Math.round(basePrice + variantAmount));
};

const formatShopItemListItem = (shopItem)=>({
    id:shopItem.id,
    itemId:shopItem.itemId,
    name:shopItem.item?.name,
    pricing:shopItem.pricing,
    ...formatShopItemPricing(shopItem),
    lowestPrice:calculateShopItemLowestPrice(shopItem),
    hasVariants:shopItem.variantGroups?.some((group)=>group.active && group.options?.some((option)=>option.active)) || false,
    variantGroups:formatShopItemVariantGroups(shopItem.variantGroups),
    availableQuantity:shopItem.availableQuantity,
    imageUrl:shopItem.imageUrl || shopItem.item?.imageUrl || null,
    brandId:shopItem.brandId || null,
    brand:shopItem.brand ? {
        id:shopItem.brand.id,
        name:shopItem.brand.name,
        slug:shopItem.brand.slug,
        imageUrl:shopItem.brand.imageUrl
    } : null,
    description:shopItem.description,
    prescriptionRequired:shopItem.prescriptionRequired || false,
    prescriptionNote:shopItem.prescriptionNote || null,
    sortOrderId:shopItem.sortOrderId,
    active:shopItem.active,
    categoryId:shopItem.item?.categoryId || null,
    categoryName:shopItem.item?.category?.name || null,
    cuisineId:shopItem.item?.category?.cuisineId || null
});

const formatSelectedFilter = (record)=>record ? {
    id:record.id,
    name:record.name
} : null;

const parseBooleanField = (value,fieldName)=>{
    if(value === undefined) return undefined;
    if(typeof value === "boolean") return value;
    if(typeof value === "string"){
        const normalizedValue = value.trim().toLowerCase();
        if(normalizedValue === "true") return true;
        if(normalizedValue === "false") return false;
    }
    throw new apiError(400,`${fieldName} must be a boolean`);
};

const parseTagIdsField = (value,fieldName = "tagIds")=>{
    if(value === undefined || value === null || value === "") return [];
    if(Array.isArray(value)) return value.map((tagId)=>String(tagId).trim()).filter(Boolean);

    const stringValue = String(value).trim();
    if(!stringValue) return [];

    if(stringValue.startsWith("[")){
        try{
            const parsed = JSON.parse(stringValue);
            if(Array.isArray(parsed)){
                return parsed.map((tagId)=>String(tagId).trim()).filter(Boolean);
            }
        }catch(error){
        }
        throw new apiError(400,`${fieldName} must be a tag id or a valid JSON array of tag ids`);
    }

    return [stringValue];
};

const parseShopTypeIdsField = (value)=>{
    if(value === undefined || value === null || value === "") return [];
    if(Array.isArray(value)) return value.map((shopTypeId)=>String(shopTypeId).trim()).filter(Boolean);

    const stringValue = String(value).trim();
    if(!stringValue) return [];

    if(stringValue.startsWith("[")){
        try{
            const parsed = JSON.parse(stringValue);
            if(Array.isArray(parsed)){
                return parsed.map((shopTypeId)=>String(shopTypeId).trim()).filter(Boolean);
            }
        }catch(error){
        }
        throw new apiError(400,"shopTypeIds must be a shop type id or a valid JSON array of shop type ids");
    }

    return [stringValue];
};

const parseOptionalNumberField = (value,fieldName,{integer = false,allowZero = true} = {})=>{
    if(value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    const validNumber = Number.isFinite(parsed) && parsed >= (allowZero ? 0 : Number.MIN_VALUE);
    if(!validNumber || (integer && !Number.isInteger(parsed)) || (!allowZero && parsed <= 0)){
        throw new apiError(400,`${fieldName} must be a ${integer ? "whole " : ""}${allowZero ? "non-negative" : "positive"} number`);
    }
    return parsed;
};

const parseOptionalEnumField = (value,fieldName,allowedValues)=>{
    if(value === undefined || value === null || value === "") return null;
    const normalized = String(value).trim().toUpperCase();
    if(!allowedValues.includes(normalized)){
        throw new apiError(400,`${fieldName} must be one of ${allowedValues.join(", ")}`);
    }
    return normalized;
};

const parseShopItemVariantGroups = (rawValue)=>{
    if(rawValue === undefined) return undefined;
    if(rawValue === null || rawValue === "") return [];

    let variantGroups = rawValue;
    if(typeof rawValue === "string"){
        try{
            variantGroups = JSON.parse(rawValue);
        }catch{
            throw new apiError(400,"variantGroups must be a valid JSON array");
        }
    }

    if(!Array.isArray(variantGroups)){
        throw new apiError(400,"variantGroups must be an array");
    }

    return variantGroups.map((group,index)=>{
        if(!group || typeof group !== "object"){
            throw new apiError(400,"each variant group must be an object");
        }

        const name = String(group.name || group.label || "").trim();
        if(!name) throw new apiError(400,"variant group name is required");

        if(!Array.isArray(group.options) || group.options.length === 0){
            throw new apiError(400,`${name} needs at least one variant option`);
        }

        const required = parseBooleanField(group.required ?? false,"variant group required");
        let minSelect = Number(group.minSelect ?? (required ? 1 : 0));
        let maxSelect = Number(group.maxSelect ?? 1);

        if(!Number.isInteger(minSelect) || minSelect < 0){
            throw new apiError(400,`${name} minSelect must be a non-negative integer`);
        }
        if(!Number.isInteger(maxSelect) || maxSelect < 1){
            throw new apiError(400,`${name} maxSelect must be a positive integer`);
        }
        if(required && minSelect < 1) minSelect = 1;
        if(minSelect > maxSelect){
            throw new apiError(400,`${name} minSelect cannot be greater than maxSelect`);
        }
        if(maxSelect > group.options.length){
            throw new apiError(400,`${name} maxSelect cannot be greater than option count`);
        }

        const normalizedOptions = group.options.map((option,optionIndex)=>{
            if(!option || typeof option !== "object"){
                throw new apiError(400,`${name} option must be an object`);
            }

            const label = String(option.label || option.name || "").trim();
            if(!label) throw new apiError(400,`${name} option label is required`);

            const amount = Number(option.amount ?? option.priceDiff ?? option.priceDifference ?? 0);
            if(!Number.isInteger(amount) || amount < 0){
                throw new apiError(400,`${name} option amount must be a non-negative integer`);
            }

            const packagingType = parseOptionalEnumField(option.packagingType ?? option.type,"packagingType",VALID_VARIANT_PACKAGING_TYPES);
            const unit = parseOptionalEnumField(option.unit,"unit",VALID_SHOP_ITEM_UNITS);
            const price = parseOptionalNumberField(option.price ?? option.sellingPrice,"price",{integer:true,allowZero:true});
            const quantityValue = parseOptionalNumberField(option.quantityValue ?? option.weight ?? option.measurementQuantity,"quantityValue",{allowZero:false});
            const minOrderQuantity = parseOptionalNumberField(option.minOrderQuantity ?? option.minQuantity ?? option.minWeight,"minOrderQuantity",{allowZero:false});
            const maxOrderQuantity = parseOptionalNumberField(option.maxOrderQuantity ?? option.maxQuantity ?? option.maxWeight,"maxOrderQuantity",{allowZero:false});
            const quantityStep = parseOptionalNumberField(option.quantityStep ?? option.step ?? option.weightStep,"quantityStep",{allowZero:false});
            const allowCustomQuantity = parseBooleanField(option.allowCustomQuantity ?? option.allowCustomWeight ?? option.customWeight ?? false,"allowCustomQuantity");
            const availableQuantity = parseOptionalNumberField(option.availableQuantity ?? option.stock,"availableQuantity",{integer:true,allowZero:true});
            const availableQuantityValue = parseOptionalNumberField(option.availableQuantityValue ?? option.stockValue,"availableQuantityValue",{allowZero:true});

            if(minOrderQuantity !== null && maxOrderQuantity !== null && minOrderQuantity > maxOrderQuantity){
                throw new apiError(400,`${label} minOrderQuantity cannot be greater than maxOrderQuantity`);
            }

            if(packagingType === "LOOSE"){
                if(!unit) throw new apiError(400,`${label} unit is required for loose variant options`);
                if(price === null) throw new apiError(400,`${label} price is required for loose variant options`);
                if(availableQuantity !== null) throw new apiError(400,`${label} loose inventory must use availableQuantityValue`);
            }
            if(packagingType === "PACKAGED"){
                if(price === null) throw new apiError(400,`${label} price is required for packaged variant options`);
                if(availableQuantityValue !== null) throw new apiError(400,`${label} packaged inventory must use availableQuantity`);
            }

            return {
                label,
                subLabel:option.subLabel === undefined || option.subLabel === null ? null : String(option.subLabel).trim(),
                amount,
                price,
                packagingType,
                unit,
                displayUnit:option.displayUnit === undefined || option.displayUnit === null || option.displayUnit === "" ? unit?.toLowerCase() || null : String(option.displayUnit).trim(),
                quantityValue,
                minOrderQuantity,
                maxOrderQuantity,
                quantityStep,
                allowCustomQuantity,
                availableQuantity,
                availableQuantityValue,
                sortOrder:Number(option.sortOrder ?? optionIndex + 1),
                active:parseBooleanField(option.active ?? true,`${name} option active`)
            };
        });

        return {
            name,
            required,
            minSelect,
            maxSelect,
            sortOrder:Number(group.sortOrder ?? index + 1),
            active:parseBooleanField(group.active ?? true,"variant group active"),
            options:normalizedOptions
        };
    });
};

const replaceShopItemVariantGroups = async(tx,shopItemId,variantGroups)=>{
    if(variantGroups === undefined) return;

    await tx.shopItemVariantGroup.deleteMany({where:{shopItemId}});
    if(variantGroups.length === 0) return;

    for(const group of variantGroups){
        await tx.shopItemVariantGroup.create({
            data:{
                shopItemId,
                name:group.name,
                required:group.required,
                minSelect:group.minSelect,
                maxSelect:group.maxSelect,
                sortOrder:group.sortOrder,
                active:group.active,
                options:{
                    create:group.options.map((option)=>({
                        label:option.label,
                        subLabel:option.subLabel,
                        amount:option.amount,
                        price:option.price,
                        packagingType:option.packagingType,
                        unit:option.unit,
                        displayUnit:option.displayUnit,
                        quantityValue:option.quantityValue,
                        minOrderQuantity:option.minOrderQuantity,
                        maxOrderQuantity:option.maxOrderQuantity,
                        quantityStep:option.quantityStep,
                        allowCustomQuantity:option.allowCustomQuantity,
                        availableQuantity:option.availableQuantity,
                        availableQuantityValue:option.availableQuantityValue,
                        sortOrder:option.sortOrder,
                        active:option.active
                    }))
                }
            }
        });
    }
};

const normalizeActiveTagIds = async(tagIds)=>{
    const uniqueTagIds = [...new Set(tagIds)];
    if(!uniqueTagIds.length) return [];

    const tagCount = await prisma.tag.count({
        where:{
            id:{
                in:uniqueTagIds
            },
            active:true
        }
    });

    if(tagCount !== uniqueTagIds.length){
        throw new apiError(400,"one or more tag ids are invalid or inactive");
    }

    return uniqueTagIds;
};

const resolveCuisine = async({cuisineId,cuisineName})=>{
    if(!cuisineId && !cuisineName) return null;

    const cuisine = await prisma.cuisine.findFirst({
        where:cuisineId ? {
            id:cuisineId
        } : {
            OR:[
                {name:{equals:cuisineName,mode:"insensitive"}},
                {slug:String(cuisineName).toUpperCase()}
            ]
        }
    });

    if(!cuisine) throw new apiError(404,"cuisine not found");
    return cuisine;
};

const resolveCategory = async({categoryId,categoryName,cuisineName,cuisineId,required = false})=>{
    if(!categoryId && !categoryName){
        if(required) throw new apiError(400,"category is required");
        return null;
    }

    const where = categoryId ? {
        id:categoryId
    } : {
        OR:[
            {name:{equals:categoryName,mode:"insensitive"}},
            {slug:String(categoryName).toUpperCase()}
        ]
    };

    if(cuisineId){
        where.cuisineId = cuisineId;
    }

    if(cuisineName){
        where.cuisine = {
            is:{
                OR:[
                    {name:{equals:cuisineName,mode:"insensitive"}},
                    {slug:String(cuisineName).toUpperCase()}
                ]
            }
        };
    }

    const category = await prisma.categories.findFirst({
        where,
        include:{
            cuisine:{
                select:{
                    id:true,
                    name:true,
                    slug:true
                }
            }
        }
    });

    if(!category) throw new apiError(404,cuisineName || cuisineId ? "category not found for selected cuisine" : "category not found");
    return category;
};

const resolveBrand = async({brandId,brandName,required = false})=>{
    if(!brandId && !brandName){
        if(required) throw new apiError(400,"brand is required");
        return null;
    }

    const brand = await prisma.brand.findFirst({
        where:{
            active:true,
            ...(brandId ? {id:String(brandId)} : {
                OR:[
                    {name:{equals:String(brandName).trim(),mode:"insensitive"}},
                    {slug:String(brandName).trim().toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"")}
                ]
            })
        },
        select:{
            id:true
        }
    });

    if(!brand) throw new apiError(404,"brand not found");
    return brand;
};

// admin: create a master catalog item
const createItems = asyncHandler(async(req,res)=>{
    const {
        name,
        itemName,
        description,
        sortOrderId,
        sortOrder,
        categoryId,
        categoryName,
        cuisineName,
        cuisineId,
        tagIds,
        tags,
        addTag,
        shopTypeId,
        shopTypeIds
    } = req.body;
    const itemTitle = String(itemName || name || "").trim();

    if(!itemTitle) throw new apiError(400,"item name is required");


    const itemImg = req.files?.itemImg?.[0]?.path;
    if(!itemImg) throw new apiError(400,"image not passed for item creation")

    const imgUrl = await cloudUploader(itemImg);
    if(!imgUrl?.url) throw new apiError(400,"image upload failure")

    const category = await resolveCategory({categoryId,categoryName,cuisineName,cuisineId});
    const normalizedTagIds = await normalizeActiveTagIds(parseTagIdsField(tagIds ?? tags ?? addTag,"tagIds"));
    const normalizedShopTypeIds = [...new Set(parseShopTypeIdsField(shopTypeIds ?? shopTypeId))];

    if(normalizedShopTypeIds.length){
        const shopTypeCount = await prisma.shopType.count({
            where:{
                id:{
                    in:normalizedShopTypeIds
                }
            }
        });
        if(shopTypeCount !== normalizedShopTypeIds.length){
            throw new apiError(400,"one or more shop type ids are invalid");
        }
    }

    const existingItem = await prisma.items.findFirst({
        where:{
            name:{
                equals:itemTitle,
                mode:"insensitive"
            },
            categoryId:category?.id || null
        }
    });

    if(existingItem) throw new apiError(409,"item already exists in master list");

    const itemData = await prisma.$transaction(async(tx)=>{
        const createdItem = await tx.items.create({
            data:{
                name:itemTitle,
                description,
                imageUrl:imgUrl.url,
                sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
                categoryId:category?.id,
                tags:normalizedTagIds.length ? {
                    create:normalizedTagIds.map((tagId)=>({
                        tag:{
                            connect:{
                                id:tagId
                            }
                        }
                    }))
                } : undefined
            },
            include:masterItemInclude
        });

        if(normalizedShopTypeIds.length){
            await tx.shopTypeItem.createMany({
                data:normalizedShopTypeIds.map((mappedShopTypeId,index)=>({
                    shopTypeId:mappedShopTypeId,
                    itemId:createdItem.id,
                    sortOrder:index
                })),
                skipDuplicates:true
            });
        }

        return createdItem;
    });

    await invalidateMasterItemCaches({includeShopItems:false});
    if(normalizedShopTypeIds.length){
        await deleteCacheByPattern("shop-types:*");
    }
    return res.status(201).json(new apiResponse(201,itemData,"master item created successfully"));
});

// admin: map master items to a category
const mapItems = asyncHandler(async(req,res)=>{
    const {categoryName,cuisineName,menuItems} = req.body;

    if(!categoryName) throw new apiError(400,"category name is required");
    if(!Array.isArray(menuItems) || menuItems.length === 0) throw new apiError(400,"Not a array passed with menu items");

    const requestedItems = menuItems.map((item)=>{
        if(typeof item === "string") return {name:item.trim()};
        const requestedName = item.name || item.itemName;
        return {
            id:item.id || item.itemId,
            name:requestedName ? String(requestedName).trim() : undefined,
            sortOrderId:item.sortOrderId
        };
    });

    const itemWhere = requestedItems
        .map((item)=>{
            const conditions = [];
            if(item.id !== undefined && item.id !== null) conditions.push({id:String(item.id)});
            if(item.name) conditions.push({name:{equals:item.name,mode:"insensitive"}});
            return conditions.length ? {OR:conditions} : null;
        })
        .filter(Boolean);

    if(itemWhere.length !== requestedItems.length) throw new apiError(400,"item id or name is required");

    const [categoryData,itemsData] = await Promise.all([
        resolveCategory({categoryName,cuisineName,required:true}),
        prisma.items.findMany({
            where:{
                OR:itemWhere
            },
            select:{
                id:true,
                name:true,
                categoryId:true,
                category:{
                    select:{
                        name:true
                    }
                }
            }
        })
    ]);

    const missingItems = requestedItems.filter((requestedItem)=>{
        return !itemsData.some((item)=>{
            return item.id === String(requestedItem.id) ||
                item.name.toLowerCase() === requestedItem.name?.toLowerCase();
        });
    });

    if(missingItems.length > 0){
        const missingNames = missingItems.map((item)=>item.name || item.id);
        throw new apiError(404,`items not found: ${missingNames.join(", ")}`);
    }

    const alreadyAssignedItems = itemsData.filter((item)=>item.categoryId && item.categoryId !== categoryData.id);
    if(alreadyAssignedItems.length > 0){
        const assignedNames = alreadyAssignedItems.map((item)=>`${item.name} is already assigned to ${item.category?.name || "another category"}`);
        throw new apiError(409,assignedNames.join(", "));
    }

    const itemIds = itemsData.map((item)=>item.id);
    await prisma.items.updateMany({
        where:{
            id:{
                in:itemIds
            }
        },
        data:{
            categoryId:categoryData.id
        }
    });

    const allItems = await prisma.items.findMany({
        where:{
            categoryId:categoryData.id
        },
        orderBy:{
            sortOrderId:"asc"
        },
        select:masterItemListSelect
    });

    const updatedCategoryData = {
        ...categoryData,
        allItems
    };

    await invalidateMasterItemCaches();
    return res.status(200).json(new apiResponse(200,updatedCategoryData,"mapping of category and item updated successfully"));
});

const fetchItemsToCategory = asyncHandler(async(req,res)=>{
    const categoryName = req.params.categoryName || req.query.categoryName || req.body?.categoryName;

    if(!categoryName) throw new apiError(400,"category name is required");

    const cacheKey = `catalog:master:items:category:v2:${String(categoryName).trim().toLowerCase()}`;
    const items = await getOrSetCachedData(cacheKey,async()=>{
        const categoryData = await prisma.categories.findFirst({
            where:{
                OR:[
                    {name:{equals:categoryName,mode:"insensitive"}},
                    {slug:categoryName.toUpperCase()}
                ]
            },
            include:{
                allItems:{
                    orderBy:{
                        sortOrderId:"asc"
                    },
                    select:masterItemListSelect
                }
            }
        });

        if(!categoryData) throw new apiError(404,"category not found");
        return categoryData.allItems;
    },MASTER_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,items,"items fetched successfully"));
});

const fetchAllItems = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query,{defaultLimit:50,maxLimit:100});
    const cacheKey = `catalog:master:items:all:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [items,total] = await Promise.all([
        prisma.items.findMany({
            skip:pagination.skip,
            take:pagination.take,
            orderBy:{
                sortOrderId:"asc"
            },
            select:{
                id:true,
                name:true,
                description:true,
                imageUrl:true,
                sortOrderId:true,
                categoryId:true,
                active:true,
                category:{
                    select:{
                        id:true,
                        name:true,
                        slug:true,
                        cuisineId:true
                    }
                }
            }
        }),
        prisma.items.count()
        ]);

        return {
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        items:items.map((item)=>({
            id:item.id,
            name:item.name,
            description:item.description,
            imageUrl:item.imageUrl,
            sortOrderId:item.sortOrderId,
            active:item.active,
            categoryId:item.categoryId,
            categoryName:item.category?.name || null,
            cuisineId:item.category?.cuisineId || null
        }))
        };
    },MASTER_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,responseData,"master items fetched successfully"));
});

const fetchOnlyItems = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query,{defaultLimit:50,maxLimit:100});
    const cacheKey = `catalog:master:items:only:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [items,total] = await Promise.all([
        prisma.items.findMany({
            skip:pagination.skip,
            take:pagination.take,
            orderBy:{
                sortOrderId:"asc"
            },
            select:{
                id:true,
                name:true,
                imageUrl:true,
                sortOrderId:true,
                active:true
            }
        }),
        prisma.items.count()
        ]);

        return {
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        items
        };
    },MASTER_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,responseData,"master items fetched successfully"));
});

const fetchMasterItemsForShop = asyncHandler(async(req,res)=>{
    const shopId = req.params.shopId || req.query.shopId;
    const { search } = req.query;
    const pagination = getPagination(req.query,{defaultLimit:50,maxLimit:100});
    const includeAlreadyAdded = String(req.query.includeAlreadyAdded || "false").toLowerCase() === "true";

    if(!shopId) throw new apiError(400,"shop id is required");

    const currentUser = req.currentUser || await prisma.user.findUnique({
        where:{id:req.userData?.id},
        select:{id:true,role:true,isBlocked:true}
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const shop = await prisma.shop.findUnique({
        where:{id:shopId},
        select:{
            id:true,
            shopName:true,
            ownerId:true,
            shopType:{
                select:{
                    id:true,
                    name:true,
                    slug:true,
                    features:{
                        where:{enabled:true},
                        select:{feature:true}
                    },
                    catalogItems:{
                        select:{
                            itemId:true
                        }
                    }
                }
            },
            featureOverrides:{
                select:{
                    feature:true,
                    enabled:true
                }
            }
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only fetch master items for your own shop");
    }
    if(!shopHasFeature(shop,"ITEMS")){
        throw new apiError(403,"items are not enabled for this shop type");
    }

    const mappedItemIds = shop.shopType?.catalogItems?.map((mapping)=>mapping.itemId) || [];

    const hasAutomaticScope = mappedItemIds.length > 0;
    if(!hasAutomaticScope){
        return res.status(200).json(new apiResponse(200,{
            shop:{
                id:shop.id,
                shopName:shop.shopName,
                shopType:shop.shopType ? {
                    id:shop.shopType.id,
                    name:shop.shopType.name,
                    slug:shop.shopType.slug
                } : null
            },
            features:formatShopFeatureMap(shop),
            pagination:buildPaginationMeta({page:pagination.page,limit:pagination.limit,total:0}),
            items:[],
            scope:{
                source:"SHOP_TYPE",
                matched:false,
                message:"No master items are mapped to this shop type. Map items with PATCH /shop-types/:shopTypeId/items."
            }
        },"shop master items fetched successfully"));
    }

    const where = {
        active:true,
        AND:[
            {id:{in:mappedItemIds}},
            ...(search ? [{
                OR:[
                    {name:{contains:String(search).trim(),mode:"insensitive"}},
                    {description:{contains:String(search).trim(),mode:"insensitive"}}
                ]
            }] : [])
        ],
        ...(includeAlreadyAdded ? {} : {
            shopItems:{
                none:{
                    shopId
                }
            }
        })
    };

    const cacheKey = `catalog:master:items:shop:v2:${shopId}:${includeAlreadyAdded}:${String(search || "").trim().toLowerCase()}:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [items,total] = await Promise.all([
            prisma.items.findMany({
                where,
                orderBy:{
                    sortOrderId:"asc"
                },
                skip:pagination.skip,
                take:pagination.take,
                select:{
                    ...masterItemListSelect,
                    category:{
                        select:{
                            id:true,
                            name:true,
                            slug:true,
                            cuisineId:true,
                            cuisine:{
                                select:{
                                    id:true,
                                    name:true,
                                    slug:true
                                }
                            }
                        }
                    },
                    shopItems:{
                        where:{shopId},
                        select:{id:true}
                    }
                }
            }),
            prisma.items.count({where})
        ]);

        return {
            shop:{
                id:shop.id,
                shopName:shop.shopName,
                shopType:shop.shopType ? {
                    id:shop.shopType.id,
                    name:shop.shopType.name,
                    slug:shop.shopType.slug
                } : null
            },
            features:formatShopFeatureMap(shop),
            pagination:buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total
            }),
            items:items.map(formatMasterItemListItem),
            scope:{
                source:"SHOP_TYPE",
                matched:true,
                includeAlreadyAdded,
                mappedItemIds
            }
        };
    },MASTER_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,responseData,"shop master items fetched successfully"));
});

const fetchItemsByShop = asyncHandler(async(req,res)=>{
    const shopId = req.params.shopId || req.query.shopId;
    const {categoryId,categoryName,cuisineId,cuisineName} = req.query;
    const pagination = getPagination(req.query);

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

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true,
            shopType:{
                select:{
                    id:true,
                    name:true,
                    slug:true,
                    features:{
                        where:{enabled:true},
                        select:{feature:true}
                    }
                }
            },
            featureOverrides:{
                select:{
                    feature:true,
                    enabled:true
                }
            }
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(!shopHasFeature(shop,"ITEMS")){
        throw new apiError(403,"items are not enabled for this shop type");
    }
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only fetch items for your own shop");
    }

    const cuisine = await resolveCuisine({cuisineId,cuisineName});
    const category = await resolveCategory({categoryId,categoryName,cuisineId,cuisineName});

    const where = {
        shopId,
        active:true,
        ...(category?.id ? {
            item:{
                categoryId:category.id
            }
        } : {}),
        ...(cuisine?.id && !category?.id ? {
            item:{
                category:{
                    is:{
                        cuisineId:cuisine.id
                    }
                }
            }
        } : {})
    };

    const cacheKey = `catalog:shop:${shopId}:items:${category?.id || "all-categories"}:${cuisine?.id || "all-cuisines"}:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [items,total] = await Promise.all([
            prisma.shopItem.findMany({
                where,
                orderBy:{
                    sortOrderId:"asc"
                },
                skip:pagination.skip,
                take:pagination.take,
                select:shopItemListSelect
            }),
            prisma.shopItem.count({ where })
        ]);

        return {
            shop:{
                id:shop.id,
                shopName:shop.shopName,
                ownerId:shop.ownerId,
                shopType:shop.shopType ? {
                    id:shop.shopType.id,
                    name:shop.shopType.name,
                    slug:shop.shopType.slug
                } : null
            },
            features:formatShopFeatureMap(shop),
            selected:{
                cuisine:formatSelectedFilter(cuisine),
                category:formatSelectedFilter(category)
            },
            pagination:buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total
            }),
            items:items.map(formatShopItemListItem)
        };
    },SHOP_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,responseData,"shop items fetched successfully"));
});

// admin: reorder master catalog items
const reorderItems = asyncHandler(async(req,res)=>{
    const {itemIds,categoryId,categoryName,cuisineId,cuisineName} = req.body;

    if(!Array.isArray(itemIds) || itemIds.length === 0){
        throw new apiError(400,"itemIds must be a non-empty array");
    }

    const uniqueItemIds = [...new Set(itemIds.map((itemId)=>String(itemId)).filter(Boolean))];
    if(uniqueItemIds.length !== itemIds.length){
        throw new apiError(400,"duplicate item ids are not allowed");
    }

    const category = await resolveCategory({categoryId,categoryName,cuisineId,cuisineName});

    const items = await prisma.items.findMany({
        where:{
            id:{
                in:uniqueItemIds
            },
            ...(category?.id ? {
                categoryId:category.id
            } : {})
        },
        select:{
            id:true
        }
    });

    if(items.length !== uniqueItemIds.length){
        throw new apiError(400,"one or more item ids are invalid");
    }

    const updatedItems = await prisma.$transaction(
        uniqueItemIds.map((itemId,index)=>{
            return prisma.items.update({
                where:{
                    id:itemId
                },
                data:{
                    sortOrderId:index + 1
                },
                include:masterItemInclude
            });
        })
    );

    await invalidateMasterItemCaches({includeShopItems:false});
    return res.status(200).json(new apiResponse(200,updatedItems,"items reordered successfully"));
});

// admin or seller: reorder items inside a seller shop
const reorderShopItems = asyncHandler(async(req,res)=>{
    const {shopId,shopItemIds,categoryId,categoryName,cuisineId,cuisineName} = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");
    if(!Array.isArray(shopItemIds) || shopItemIds.length === 0){
        throw new apiError(400,"shopItemIds must be a non-empty array");
    }

    const uniqueShopItemIds = [...new Set(shopItemIds.map((shopItemId)=>String(shopItemId)).filter(Boolean))];
    if(uniqueShopItemIds.length !== shopItemIds.length){
        throw new apiError(400,"duplicate shop item ids are not allowed");
    }

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

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only reorder items for your own shop");
    }

    const cuisine = await resolveCuisine({cuisineId,cuisineName});
    const category = await resolveCategory({categoryId,categoryName,cuisineId,cuisineName});

    const shopItems = await prisma.shopItem.findMany({
        where:{
            id:{
                in:uniqueShopItemIds
            },
            shopId,
            ...(category?.id ? {
                item:{
                    categoryId:category.id
                }
            } : {}),
            ...(cuisine?.id && !category?.id ? {
                item:{
                    category:{
                        is:{
                            cuisineId:cuisine.id
                        }
                    }
                }
            } : {})
        },
        select:{
            id:true
        }
    });

    if(shopItems.length !== uniqueShopItemIds.length){
        throw new apiError(400,"one or more shop item ids are invalid");
    }

    const updatedShopItems = await prisma.$transaction(
        uniqueShopItemIds.map((shopItemId,index)=>{
            return prisma.shopItem.update({
                where:{
                    id:shopItemId
                },
                data:{
                    sortOrderId:index + 1
                },
                include:shopItemInclude
            });
        })
    );

    await invalidateShopItemCaches(shopId);
    return res.status(200).json(new apiResponse(200,updatedShopItems,"shop items reordered successfully"));
});

const editShopItem = asyncHandler(async(req,res)=>{
    const {shopItemId} = req.params;
    const {
        pricing,
        pricingMode,
        availableQuantity,
        description,
        prescriptionRequired,
        requiresPrescription,
        prescriptionNote,
        prescriptionInstructions,
        imageUrl,
        photoUrl,
        sortOrderId,
        sortOrder,
        active,
        brandId,
        brandName,
        variantGroups
    } = req.body;

    if(!shopItemId) throw new apiError(400,"shop item id is required");

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

    const existingShopItem = await prisma.shopItem.findUnique({
        where:{
            id:shopItemId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    ownerId:true,
                    shopType:{
                        select:{
                            features:{
                                where:{enabled:true},
                                select:{feature:true}
                            }
                        }
                    },
                    featureOverrides:{
                        select:{
                            feature:true,
                            enabled:true
                        }
                    }
                }
            }
        }
    });

    if(!existingShopItem) throw new apiError(404,"shop item not found");
    if(currentUser.role !== "ADMIN" && existingShopItem.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only edit items for your own shop");
    }

    const pricingInput = {
        pricingMode,
        pricing,
        availableQuantity
    };
    const pricingDataToUpdate = normalizeShopItemPricingInput(pricingInput,{creating:false});

    if(pricing !== undefined && pricing !== null && pricing !== ""){
        const updatedPrice = Number(pricing);
        if(!Number.isFinite(updatedPrice) || updatedPrice < 0){
            throw new apiError(400,"pricing must be a valid non-negative number");
        }
    }
    const parsedVariantGroups = parseShopItemVariantGroups(variantGroups);
    const variantGroupsToReplace = parsedVariantGroups;
    if(parsedVariantGroups && parsedVariantGroups.length > 0 && !shopHasFeature(existingShopItem.shop,"VARIANTS")){
        throw new apiError(403,"variants are not enabled for this shop type");
    }

    const itemImg = req.files?.itemImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(itemImg){
        const imgUrl = await cloudUploader(itemImg);
        if(!imgUrl?.url) throw new apiError(400,"image upload failure")
        uploadedImageUrl = imgUrl.url;
    }
    const dataToUpdate = {};

    Object.assign(dataToUpdate,pricingDataToUpdate);
    if(pricing !== undefined) dataToUpdate.pricing = String(pricing);
    if(availableQuantity !== undefined){
        dataToUpdate.availableQuantity = availableQuantity === null ? null : Number(availableQuantity);
    }
    if(description !== undefined) dataToUpdate.description = description;
    if(prescriptionRequired !== undefined || requiresPrescription !== undefined){
        dataToUpdate.prescriptionRequired = parseBooleanField(prescriptionRequired ?? requiresPrescription,"prescriptionRequired") ?? false;
    }
    if(prescriptionNote !== undefined || prescriptionInstructions !== undefined){
        const note = prescriptionNote ?? prescriptionInstructions;
        dataToUpdate.prescriptionNote = note === null || note === "" ? null : String(note).trim();
    }
    if(uploadedImageUrl || imageUrl !== undefined || photoUrl !== undefined) dataToUpdate.imageUrl = uploadedImageUrl || imageUrl || photoUrl;
    if(sortOrderId !== undefined || sortOrder !== undefined) dataToUpdate.sortOrderId = sortOrderId === null || sortOrder === null ? null : Number(sortOrderId ?? sortOrder);
    if(active !== undefined) dataToUpdate.active = parseBooleanField(active,"active");
    if(brandId !== undefined || brandName !== undefined){
        const brand = await resolveBrand({brandId,brandName,required:true});
        dataToUpdate.brandId = brand.id;
    }

    if(Object.keys(dataToUpdate).length === 0 && variantGroupsToReplace === undefined){
        throw new apiError(400,"no shop item data passed");
    }

    const updatedShopItem = await prisma.$transaction(async(tx)=>{
        if(Object.keys(dataToUpdate).length > 0){
            await tx.shopItem.update({
                where:{
                    id:shopItemId
                },
                data:dataToUpdate
            });
        }
        await replaceShopItemVariantGroups(tx,shopItemId,variantGroupsToReplace);
        return tx.shopItem.findUnique({
            where:{
                id:shopItemId
            },
            include:shopItemInclude
        });
    });

    if(pricing !== undefined || variantGroupsToReplace !== undefined || Object.keys(pricingDataToUpdate).length > 0){
        const affectedCombos = await prisma.combo.findMany({
            where:{
                shopId:updatedShopItem.shopId,
                items:{
                    some:{
                        itemId:updatedShopItem.id
                    }
                }
            },
            select:{
                id:true,
                items:{
                    select:{
                        quantity:true,
                        item:{
                            select:{
                                id:true,
                                pricing:true,
                                variantGroups:{
                                    where:{active:true},
                                    orderBy:{sortOrder:"asc"},
                                    select:shopItemVariantSelect
                                }
                            }
                        }
                    }
                }
            }
        });

        const comboUpdates = affectedCombos.map((combo)=>{
            const recalculatedTotalPrice = combo.items.reduce((sum,comboItem)=>{
                const itemPrice = calculateShopItemLowestPrice(comboItem.item);
                return sum + itemPrice * comboItem.quantity;
            },0);

            return prisma.combo.update({
                where:{
                    id:combo.id
                },
                data:{
                    totalPrice:recalculatedTotalPrice
                }
            });
        });
        if(comboUpdates.length > 0) await prisma.$transaction(comboUpdates);
    }

    await Promise.all([
        invalidateShopItemCaches(updatedShopItem.shopId),
        pricing !== undefined || variantGroupsToReplace !== undefined || Object.keys(pricingDataToUpdate).length > 0
            ? deleteCacheByPattern(`catalog:shop:${updatedShopItem.shopId}:combos:*`)
            : Promise.resolve()
    ]);
    return res.status(200).json(new apiResponse(200,updatedShopItem,"shop item updated successfully"));
});

const deleteShopItem = asyncHandler(async(req,res)=>{
    const {shopItemId} = req.params;

    if(!shopItemId) throw new apiError(400,"shop item id is required");

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

    const existingShopItem = await prisma.shopItem.findUnique({
        where:{
            id:shopItemId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    ownerId:true
                }
            }
        }
    });

    if(!existingShopItem) throw new apiError(404,"shop item not found");
    if(currentUser.role !== "ADMIN" && existingShopItem.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only delete items from your own shop");
    }

    const deletedShopItem = await prisma.$transaction(async(tx)=>{
        const deleted = await tx.shopItem.delete({
            where:{id:shopItemId}
        });
        await releaseShopSlot(tx,existingShopItem.shop.id);
        return deleted;
    });

    await invalidateShopItemCaches(existingShopItem.shop.id);
    return res.status(200).json(new apiResponse(200,deletedShopItem,"shop item deleted successfully"));
});

// admin: edit a master catalog item
const editItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;
    const {
        itemName,
        name,
        description,
        imageUrl,
        photoUrl,
        sortOrderId,
        sortOrder,
        categoryId,
        categoryName,
        cuisineName,
        cuisineId,
        active
    } = req.body;

    if(!itemId) throw new apiError(400,"item id is required");

    const itemImg = req.files?.itemImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(itemImg){
        const imgUrl = await cloudUploader(itemImg);
        if(!imgUrl?.url) throw new apiError(400,"image upload failure")
        uploadedImageUrl = imgUrl.url;
    }
    const dataToUpdate = {};
    const updatedName = itemName || name;

    if(updatedName) dataToUpdate.name = updatedName;
    if(description !== undefined) dataToUpdate.description = description;
    if(uploadedImageUrl || imageUrl !== undefined || photoUrl !== undefined) dataToUpdate.imageUrl = uploadedImageUrl || imageUrl || photoUrl;
    if(sortOrderId !== undefined || sortOrder !== undefined) dataToUpdate.sortOrderId = Number(sortOrderId ?? sortOrder);
    if(active !== undefined) dataToUpdate.active = parseBooleanField(active,"active");

    if(categoryId !== undefined || categoryName !== undefined){
        const category = await resolveCategory({categoryId,categoryName,cuisineName,cuisineId,required:true});
        dataToUpdate.categoryId = category.id;
    }
    if(Object.keys(dataToUpdate).length === 0) throw new apiError(400,"no item data passed");

    const updatedItem = await prisma.items.update({
        where:{
            id:itemId
        },
        data:dataToUpdate,
        include:masterItemInclude
    });

    await invalidateMasterItemCaches();
    return res.status(200).json(new apiResponse(200,updatedItem,"master item updated successfully"));
});

// admin: delete a master catalog item
const deleteItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;

    if(!itemId) throw new apiError(400,"item id is required");

    const affectedShopItems = await prisma.shopItem.groupBy({
        by:["shopId"],
        where:{itemId},
        _count:{_all:true}
    });

    const deletedItem = await prisma.$transaction(async(tx)=>{
        const deleted = await tx.items.delete({where:{id:itemId}});
        for(const affectedShop of affectedShopItems){
            await releaseShopSlot(tx,affectedShop.shopId,affectedShop._count._all);
        }
        return deleted;
    });

    await invalidateMasterItemCaches();
    return res.status(200).json(new apiResponse(200,deletedItem,"master item deleted successfully"));
});

// seller: create/reuse a master item and add it to the seller's shop
const addPersonalProduct = asyncHandler(async(req,res)=>{
    const sellerId = req.userData?.id;
    const {
        shopId,
        itemId,
        globalItemId,
        cuisineName,
        cuisineId,
        categoryName,
        categoryId,
        brandId,
        brandName,
        tagIds,
        tags,
        addTag,
        itemName,
        name,
        pricing,
        pricingMode,
        availableQuantity,
        prescriptionRequired,
        requiresPrescription,
        prescriptionNote,
        prescriptionInstructions,
        description,
        imageUrl,
        photoUrl,
        sortOrderId,
        sortOrder,
        active,
        variantGroups
    } = req.body;
    const customItemName = itemName || name;
    const masterItemId = globalItemId || itemId;

    if(!sellerId) throw new apiError(401,"Unauthorized user");
    if(!shopId) throw new apiError(400,"shop id is required");
    if(!masterItemId && !customItemName) throw new apiError(400,"item id or item name is required");
    const normalizedTagIds = await normalizeActiveTagIds(parseTagIdsField(tagIds ?? tags ?? addTag,"tagIds"));
    const pricingData = normalizeShopItemPricingInput({
        pricingMode,
        pricing,
        availableQuantity
    },{creating:true});

    if(pricingData.pricingMode === "FIXED"){
        if(pricing === undefined || pricing === null || pricing === "") throw new apiError(400,"pricing is required");

        const shopItemPrice = Number(pricing);
        const shopItemAvailableQuantity = Number(availableQuantity ?? 0);

        if(!Number.isFinite(shopItemPrice) || shopItemPrice < 0){
            throw new apiError(400,"pricing must be a valid non-negative number");
        }

        if(!Number.isFinite(shopItemAvailableQuantity) || shopItemAvailableQuantity < 0){
            throw new apiError(400,"availableQuantity must be a valid non-negative number");
        }

        pricingData.pricing = String(shopItemPrice);
        pricingData.availableQuantity = shopItemAvailableQuantity;
    }
    const parsedVariantGroups = parseShopItemVariantGroups(variantGroups);

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true,
            shopName:true,
            shopType:{
                select:{
                    features:{
                        where:{enabled:true},
                        select:{feature:true}
                    }
                }
            },
            featureOverrides:{
                select:{
                    feature:true,
                    enabled:true
                }
            }
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(!shopHasFeature(shop,"ITEMS")){
        throw new apiError(403,"items are not enabled for this shop type");
    }
    if(!shopHasFeature(shop,"CATEGORIES") && (categoryId || categoryName)){
        throw new apiError(403,"categories are not enabled for this shop type");
    }
    if(!shopHasFeature(shop,"CUISINE") && (cuisineId || cuisineName)){
        throw new apiError(403,"cuisine is not enabled for this shop type");
    }
    if(parsedVariantGroups && parsedVariantGroups.length > 0 && !shopHasFeature(shop,"VARIANTS")){
        throw new apiError(403,"variants are not enabled for this shop type");
    }
    if(shop.ownerId !== sellerId) throw new apiError(403,"You can only create products for your own shop");

    const itemImg = req.files?.itemImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(itemImg){
        const imgUrl = await cloudUploader(itemImg);
        if(!imgUrl?.url) throw new apiError(400,"image upload failure")
        uploadedImageUrl = imgUrl.url;
    }
    const requestedImageUrl = uploadedImageUrl || imageUrl || photoUrl;
    const category = await resolveCategory({categoryId,categoryName,cuisineName,cuisineId,required:!masterItemId && shopHasFeature(shop,"CATEGORIES")});
    const brand = await resolveBrand({brandId,brandName});

    let masterItem = null;
    if(masterItemId){
        masterItem = await prisma.items.findUnique({
            where:{
                id:masterItemId
            },
            include:masterItemInclude
        });

        if(!masterItem) throw new apiError(404,"master item not found");
    }else{
        masterItem = await prisma.items.findFirst({
            where:{
                name:{
                    equals:customItemName,
                    mode:"insensitive"
                },
                categoryId:category?.id || null
            },
            include:masterItemInclude
        });

        if(!masterItem){
            masterItem = await prisma.items.create({
                data:{
                    name:customItemName,
                    description,
                    imageUrl:requestedImageUrl,
                    sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
                    categoryId:category?.id,
                    tags:normalizedTagIds.length ? {
                        create:normalizedTagIds.map((tagId)=>({
                            tag:{
                                connect:{
                                    id:tagId
                                }
                            }
                        }))
                    } : undefined
                },
                include:masterItemInclude
            });
        }else if(normalizedTagIds.length){
            const existingTagLinks = await prisma.itemTag.findMany({
                where:{
                    itemId:masterItem.id,
                    tagId:{
                        in:normalizedTagIds
                    }
                },
                select:{
                    tagId:true
                }
            });
            const existingTagIds = new Set(existingTagLinks.map((tag)=>tag.tagId));
            const tagIdsToCreate = normalizedTagIds.filter((tagId)=>!existingTagIds.has(tagId));
            if(tagIdsToCreate.length){
                await prisma.itemTag.createMany({
                    data:tagIdsToCreate.map((tagId)=>({
                        itemId:masterItem.id,
                        tagId
                    })),
                    skipDuplicates:true
                });
                masterItem = await prisma.items.findUnique({
                    where:{
                        id:masterItem.id
                    },
                    include:masterItemInclude
                });
            }
        }
    }

    if(masterItemId && normalizedTagIds.length){
        const existingTagLinks = await prisma.itemTag.findMany({
            where:{
                itemId:masterItem.id,
                tagId:{
                    in:normalizedTagIds
                }
            },
            select:{
                tagId:true
            }
        });
        const existingTagIds = new Set(existingTagLinks.map((tag)=>tag.tagId));
        const tagIdsToCreate = normalizedTagIds.filter((tagId)=>!existingTagIds.has(tagId));
        if(tagIdsToCreate.length){
            await prisma.itemTag.createMany({
                data:tagIdsToCreate.map((tagId)=>({
                    itemId:masterItem.id,
                    tagId
                })),
                skipDuplicates:true
            });
            masterItem = await prisma.items.findUnique({
                where:{
                    id:masterItem.id
                },
                include:masterItemInclude
            });
        }
    }

    const existingShopItem = await prisma.shopItem.findUnique({
        where:{
            shopId_itemId:{
                shopId,
                itemId:masterItem.id
            }
        }
    });

    if(existingShopItem) throw new apiError(409,`${masterItem.name} is already added to this shop`);

    const shopItem = await prisma.$transaction(async(tx)=>{
        await reserveShopSlot(tx,shopId);
        const createdShopItem = await tx.shopItem.create({
            data:{
                shopId,
                itemId:masterItem.id,
                brandId:brand?.id,
                ...pricingData,
                description,
                prescriptionRequired:parseBooleanField(prescriptionRequired ?? requiresPrescription ?? false,"prescriptionRequired") ?? false,
                prescriptionNote:prescriptionNote === undefined && prescriptionInstructions === undefined
                    ? null
                    : String((prescriptionNote ?? prescriptionInstructions) || "").trim() || null,
                imageUrl:requestedImageUrl,
                sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
                active:parseBooleanField(active,"active") ?? true
            }
        });
        await replaceShopItemVariantGroups(tx,createdShopItem.id,parsedVariantGroups);
        return tx.shopItem.findUnique({
            where:{id:createdShopItem.id},
            include:shopItemInclude
        });
    });

    await Promise.all([
        invalidateMasterItemCaches({includeShopItems:false}),
        invalidateShopItemCaches(shopId)
    ]);
    return res.status(201).json(new apiResponse(201,shopItem,"item added to shop successfully"));
});

export { createItems, mapItems, fetchItemsToCategory, fetchAllItems, fetchOnlyItems, fetchMasterItemsForShop, fetchItemsByShop, reorderItems, reorderShopItems, editShopItem, deleteShopItem, editItem, deleteItem, addPersonalProduct };

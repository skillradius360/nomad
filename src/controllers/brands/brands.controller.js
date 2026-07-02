import { prisma } from "../../db/index.js";
import { deleteCacheByPattern } from "../../utils/cache.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const normalizeBrandSlug = (value)=>String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g,"_")
    .replace(/^_+|_+$/g,"");

const invalidateBrandCaches = async()=>Promise.all([
    deleteCacheByPattern("catalog:brands:*"),
    deleteCacheByPattern("catalog:master:items:*"),
    deleteCacheByPattern("catalog:shop:*:items:*")
]);

const brandSelect = {
    id:true,
    name:true,
    slug:true,
    description:true,
    imageUrl:true,
    active:true,
    createdAt:true,
    updatedAt:true
};

const createBrand = asyncHandler(async(req,res)=>{
    const {name,slug,description,imageUrl,active = true} = req.body;
    const brandName = String(name || "").trim();
    if(!brandName) throw new apiError(400,"brand name is required");

    const brandSlug = normalizeBrandSlug(slug || brandName);
    if(!brandSlug) throw new apiError(400,"brand slug is required");

    const brand = await prisma.brand.create({
        data:{
            name:brandName,
            slug:brandSlug,
            description:description === undefined ? undefined : String(description).trim(),
            imageUrl:imageUrl || undefined,
            active:Boolean(active)
        },
        select:brandSelect
    });

    await invalidateBrandCaches();
    return res.status(201).json(new apiResponse(201,brand,"brand created successfully"));
});

const fetchBrands = asyncHandler(async(req,res)=>{
    const includeInactive = String(req.query.includeInactive || "false").toLowerCase() === "true";
    const search = String(req.query.search || "").trim();

    const brands = await prisma.brand.findMany({
        where:{
            ...(includeInactive ? {} : {active:true}),
            ...(search ? {
                OR:[
                    {name:{contains:search,mode:"insensitive"}},
                    {slug:{contains:normalizeBrandSlug(search)}}
                ]
            } : {})
        },
        orderBy:{name:"asc"},
        select:brandSelect
    });

    return res.status(200).json(new apiResponse(200,brands,"brands fetched successfully"));
});

const fetchBrandById = asyncHandler(async(req,res)=>{
    const {brandId} = req.params;
    if(!brandId) throw new apiError(400,"brand id is required");

    const brand = await prisma.brand.findUnique({
        where:{id:brandId},
        select:brandSelect
    });
    if(!brand) throw new apiError(404,"brand not found");

    return res.status(200).json(new apiResponse(200,brand,"brand fetched successfully"));
});

const updateBrand = asyncHandler(async(req,res)=>{
    const {brandId} = req.params;
    const {name,slug,description,imageUrl,active} = req.body;
    if(!brandId) throw new apiError(400,"brand id is required");

    const dataToUpdate = {};
    if(name !== undefined){
        const brandName = String(name).trim();
        if(!brandName) throw new apiError(400,"brand name cannot be empty");
        dataToUpdate.name = brandName;
    }
    if(slug !== undefined){
        const brandSlug = normalizeBrandSlug(slug);
        if(!brandSlug) throw new apiError(400,"brand slug cannot be empty");
        dataToUpdate.slug = brandSlug;
    }
    if(description !== undefined) dataToUpdate.description = String(description).trim();
    if(imageUrl !== undefined) dataToUpdate.imageUrl = imageUrl || null;
    if(active !== undefined) dataToUpdate.active = Boolean(active);

    if(Object.keys(dataToUpdate).length === 0) throw new apiError(400,"no brand data passed");

    const brand = await prisma.brand.update({
        where:{id:brandId},
        data:dataToUpdate,
        select:brandSelect
    });

    await invalidateBrandCaches();
    return res.status(200).json(new apiResponse(200,brand,"brand updated successfully"));
});

const deleteBrand = asyncHandler(async(req,res)=>{
    const {brandId} = req.params;
    if(!brandId) throw new apiError(400,"brand id is required");

    const linkedItems = await prisma.shopItem.count({
        where:{brandId}
    });
    if(linkedItems > 0){
        throw new apiError(409,"brand is assigned to shop items; remove it from shop items before deleting");
    }

    const brand = await prisma.brand.delete({
        where:{id:brandId},
        select:brandSelect
    });

    await invalidateBrandCaches();
    return res.status(200).json(new apiResponse(200,brand,"brand deleted successfully"));
});

export {
    createBrand,
    deleteBrand,
    fetchBrandById,
    fetchBrands,
    updateBrand
};

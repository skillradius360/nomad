import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { deleteCacheByPattern, getOrSetCachedData } from "../../utils/cache.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import { shopHasFeature } from "../../utils/shopFeatures.js";

const CATEGORY_CACHE_TTL = 60;
const CATEGORY_CACHE_PATTERNS = [
    "catalog:categories:*",
    "catalog:shop:*:categories",
    "catalog:master:items:*",
    "catalog:shop:*:items:*"
];

const invalidateCategoryCaches = async()=>{
    for(const pattern of CATEGORY_CACHE_PATTERNS){
        await deleteCacheByPattern(pattern);
    }
}

// admin
const createCategory = asyncHandler(async(req,res)=>{

    const {categoryName,sortOrder} = req.body
    if(!categoryName && !sortOrder) throw new apiError(400,"no category name passed")

    const categorySlug = typeof categoryName==="string"?categoryName.toUpperCase():categoryName

    const ifCategory = await prisma.categories.findUnique({
        where:{
            slug:categorySlug
        }
    })
    if(ifCategory) throw new apiError(409,"category named the same already exists")
    
    const categoryCreate = await prisma.categories.create({
        data:{
            name:categoryName,
            slug:categorySlug,
            sortOrderId:sortOrder,
        }
    })
    if(!categoryCreate){
        throw new apiError(400,"category creation failure")
    }
    await invalidateCategoryCaches()
    return res.status(200).json(new apiResponse(200,categoryCreate,"created  category"))
})
    

// admin
    const mapCategories= asyncHandler(async(req,res)=>{
        const {menuCategories ,cuisineName}= req.body
        if(!cuisineName) throw new apiError(400,"cuisine name is required")
        if(!Array.isArray(menuCategories) || menuCategories.length === 0) throw new apiError(400,"Not a array passed with menu categories")

        const requestedCategories = menuCategories.map((category)=>{
            if(typeof category === "string"){
                return {
                    name:category,
                    slug:category.toUpperCase()
                }
            }

            const categoryName = category.name || category.categoryName

            return {
                id:category.id || category.categoryId,
                name:categoryName,
                slug:(category.slug || categoryName)?.toUpperCase(),
                sortOrderId:category.sortOrderId
            }
        })

        const categoryWhere = requestedCategories
            .map((category)=>{
                const conditions = []

                if(category.id !== undefined && category.id !== null){
                    conditions.push({id:String(category.id)})
                }

                if(category.slug){
                    conditions.push({slug:category.slug})
                }

                if(category.name){
                    conditions.push({name:{equals:category.name,mode:"insensitive"}})
                }

                return conditions.length ? {OR:conditions} : null
            })
            .filter(Boolean)

        if(categoryWhere.length !== requestedCategories.length) throw new apiError(400,"category id or name is required")

        const cuisineData = await prisma.cuisine.findFirst({
            where:{
                OR:[
                    {name:{equals:cuisineName,mode:"insensitive"}},
                    {slug:cuisineName.toUpperCase()}
                ]
            }
        })

        if(!cuisineData) throw new apiError(404,"cuisine not found")

        const categoriesData = await prisma.categories.findMany({
            where:{
                OR:categoryWhere
            }
        })

        const missingCategories = requestedCategories.filter((requestedCategory)=>{
            return !categoriesData.some((category)=>{
                return category.id === String(requestedCategory.id) ||
                    category.slug === requestedCategory.slug ||
                    category.name.toLowerCase() === requestedCategory.name?.toLowerCase()
            })
        })

        if(missingCategories.length > 0){
            const missingNames = missingCategories.map((category)=>category.name || category.slug || category.id)
            throw new apiError(404,`categories not found: ${missingNames.join(", ")}`)
        }

        const updatedCuisineData = await prisma.cuisine.update({

            where:{
                id:cuisineData.id
            },
            data:{
                categories:{
                    connect:categoriesData.map((category)=>({
                        id:category.id
                    }))
                }
            },
            include:{
                categories:{
                    orderBy:{
                        sortOrderId:"asc"
                    }
                }
            }
        })

        if(!updatedCuisineData) throw new apiError(400, " cuisine updated failed ")

        await invalidateCategoryCaches()
        return res.status(200).json(new apiResponse(200,updatedCuisineData,"mapping of cuisine and category updated successfully"))
    })


    // user and admin
    const fetchCategoryToCuisine = asyncHandler(async(req,res)=>{
            const cuisineName = req.params.cuisineName || req.query.cuisineName || req.body.cuisineName

            if(!cuisineName) throw new apiError(400,"cuisine name is required")

            const cacheKey = `catalog:categories:cuisine:${String(cuisineName).toUpperCase()}`
            const responseData = await getOrSetCachedData(cacheKey,async()=>{
                const cuisineData = await prisma.cuisine.findFirst({
                    where:{
                        OR:[
                            {name:{equals:cuisineName,mode:"insensitive"}},
                            {slug:cuisineName.toUpperCase()}
                        ]
                    },
                    include:{
                        categories:{
                            orderBy:{
                                sortOrderId:"asc"
                            }
                        }
                    }
                })

                if(!cuisineData?.categories && cuisineData) throw new apiError(404,"cuisine categories not found")
                return cuisineData.categories
            },CATEGORY_CACHE_TTL)

            return res.status(200).json(new apiResponse(200,responseData,"categories fetched successfully"))
        })

    const fetchAllCategories = asyncHandler(async(req,res)=>{
            const pagination = getPagination(req.query,{defaultLimit:50,maxLimit:100})
            const cacheKey = `catalog:categories:all:page:${pagination.page}:limit:${pagination.limit}`
            const responseData = await getOrSetCachedData(cacheKey,async()=>{
                const categories = await prisma.categories.findMany({
                    skip:pagination.skip,
                    take:pagination.take,
                    orderBy:{
                        sortOrderId:"asc"
                    },
                    select:{
                        id:true,
                        name:true,
                        slug:true,
                        sortOrderId:true,
                        active:true,
                        cuisineId:true,
                        cuisine:{
                            select:{
                                id:true,
                                name:true,
                                slug:true
                            }
                        }
                    }
                })
                const total = await prisma.categories.count()
                if(!categories) throw new apiError(404,"categories not found")

                return {
                    pagination:buildPaginationMeta({
                        page:pagination.page,
                        limit:pagination.limit,
                        total
                    }),
                    categories:categories.map((category)=>({
                        id:category.id,
                        name:category.name,
                        slug:category.slug,
                        sortOrderId:category.sortOrderId,
                        active:category.active,
                        cuisineId:category.cuisineId,
                        cuisineName:category.cuisine?.name || null
                    }))
                }
            },CATEGORY_CACHE_TTL)

            return res.status(200).json(new apiResponse(200,responseData,"categories fetched successfully"))
    })

    const fetchOnlyCategories = asyncHandler(async(req,res)=>{
            const pagination = getPagination(req.query,{defaultLimit:50,maxLimit:100})
            const cacheKey = `catalog:categories:only:page:${pagination.page}:limit:${pagination.limit}`
            const responseData = await getOrSetCachedData(cacheKey,async()=>{
                const categories = await prisma.categories.findMany({
                    skip:pagination.skip,
                    take:pagination.take,
                    orderBy:{
                        sortOrderId:"asc"
                    },
                    select:{
                        id:true,
                        name:true,
                        slug:true,
                        sortOrderId:true,
                        active:true
                    }
                })
                const total = await prisma.categories.count()

                if(!categories) throw new apiError(404,"categories not found")
                return {
                    pagination:buildPaginationMeta({
                        page:pagination.page,
                        limit:pagination.limit,
                        total
                    }),
                    categories
                }
            },CATEGORY_CACHE_TTL)

            return res.status(200).json(new apiResponse(200,responseData,"categories fetched successfully"))
    })

    const fetchShopCategories = asyncHandler(async(req,res)=>{
            const shopId = req.params.shopId || req.query.shopId

            if(!shopId) throw new apiError(400,"shop id is required")

            const currentUser = await prisma.user.findUnique({
                where:{
                    id:req.userData?.id
                },
                select:{
                    id:true,
                    role:true,
                    isBlocked:true
                }
            })

            if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized")

            const shop = await prisma.shop.findUnique({
                where:{
                    id:shopId
                },
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
            })

            if(!shop) throw new apiError(404,"shop not found")
            if(!shopHasFeature(shop,"CATEGORIES")){
                throw new apiError(403,"categories are not enabled for this shop type")
            }
            if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
                throw new apiError(403,"You can only fetch categories for your own shop")
            }

            const cacheKey = `catalog:shop:${shopId}:categories`
            const responseData = await getOrSetCachedData(cacheKey,async()=>{
                const categories = await prisma.categories.findMany({
                    where:{
                        active:true,
                        allItems:{
                            some:{
                                active:true,
                                shopItems:{
                                    some:{
                                        shopId,
                                        active:true
                                    }
                                }
                            }
                        }
                    },
                    orderBy:{
                        sortOrderId:"asc"
                    },
                    select:{
                        id:true,
                        name:true,
                        slug:true,
                        sortOrderId:true,
                        active:true,
                        cuisine:{
                            select:{
                                id:true,
                                name:true,
                                slug:true
                            }
                        }
                    }
                })

                return categories.map((category)=>({
                    id:category.id,
                    name:category.name,
                    slug:category.slug,
                    sortOrderId:category.sortOrderId,
                    active:category.active,
                    cuisineId:category.cuisine?.id || null,
                    cuisineName:category.cuisine?.name || null
                }))
            },CATEGORY_CACHE_TTL)

            return res.status(200).json(new apiResponse(200,responseData,"shop categories fetched successfully"))
    })

// admin
    const reorderCategories = asyncHandler(async(req,res)=>{
            const {categoryIds,cuisineId,cuisineName} = req.body

            if(!Array.isArray(categoryIds) || categoryIds.length === 0){
                throw new apiError(400,"categoryIds must be a non-empty array")
            }

            const uniqueCategoryIds = [...new Set(categoryIds.map((categoryId)=>String(categoryId)).filter(Boolean))]

            if(uniqueCategoryIds.length !== categoryIds.length){
                throw new apiError(400,"duplicate category ids are not allowed")
            }

            let cuisineData = null
            if(cuisineId || cuisineName){
                cuisineData = await prisma.cuisine.findFirst({
                    where:cuisineId ? {
                        id:String(cuisineId)
                    } : {
                        OR:[
                            {name:{equals:cuisineName,mode:"insensitive"}},
                            {slug:String(cuisineName).toUpperCase()}
                        ]
                    },
                    select:{
                        id:true
                    }
                })

                if(!cuisineData) throw new apiError(404,"cuisine not found")
            }

            const categories = await prisma.categories.findMany({
                where:{
                    id:{
                        in:uniqueCategoryIds
                    },
                    ...(cuisineData?.id ? {
                        cuisineId:cuisineData.id
                    } : {})
                },
                select:{
                    id:true
                }
            })

            if(categories.length !== uniqueCategoryIds.length){
                throw new apiError(400,"one or more category ids are invalid")
            }

            const updatedCategories = await prisma.$transaction(
                uniqueCategoryIds.map((categoryId,index)=>{
                    return prisma.categories.update({
                        where:{
                            id:categoryId
                        },
                        data:{
                            sortOrderId:index + 1
                        }
                    })
                })
            )

            await invalidateCategoryCaches()
            return res.status(200).json(new apiResponse(200,updatedCategories,"categories reordered successfully"))
    })
    
    
// admin
    const editCategory = asyncHandler(async(req,res)=>{
            const {categoryId} = req.params
            const {categoryName,sortOrderId,sortOrder} = req.body

            if(!categoryId) throw new apiError(400,"category id is required")
            if(!categoryName && sortOrderId === undefined && sortOrder === undefined) throw new apiError(400,"no category data passed")

            const dataToUpdate = {}

            if(categoryName){
                const categorySlug = categoryName.toUpperCase()
                const ifCategory = await prisma.categories.findUnique({
                    where:{
                        slug:categorySlug
                    }
                })
                if(ifCategory && ifCategory.id !== categoryId) throw new apiError(409,"category named the same already exists")

                dataToUpdate.name = categoryName
                dataToUpdate.slug = categorySlug
            }

            if(sortOrderId !== undefined || sortOrder !== undefined){
                dataToUpdate.sortOrderId = Number(sortOrderId ?? sortOrder)
            }

            const updatedCategory = await prisma.categories.update({
                where:{
                    id:categoryId
                },
                data:dataToUpdate
            })

            await invalidateCategoryCaches()
            return res.status(200).json(new apiResponse(200,updatedCategory,"category updated successfully"))
    })
// admin
    const deleteCategory = asyncHandler(async(req,res)=>{
            const {categoryId} = req.params

            if(!categoryId) throw new apiError(400,"category id is required")

            const deletedCategory = await prisma.categories.delete({
                where:{
                    id:categoryId
                }
            })
                
            await invalidateCategoryCaches()
            return res.status(200).json(new apiResponse(200,deletedCategory,"category deleted successfully"))
    })
    
export { createCategory, mapCategories, fetchCategoryToCuisine, fetchAllCategories, fetchOnlyCategories, fetchShopCategories, reorderCategories, editCategory, deleteCategory }

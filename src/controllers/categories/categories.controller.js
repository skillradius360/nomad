import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

// admin
const createCategory = asyncHandler(async(req,res)=>{

    const {categoryName,sortOrder} = req.body
    if(!categoryName && !sortOrder) throw new apiError(400,"no category name passed")
    
    const categoryCreate = await prisma.categories.create({
        data:{
            name:categoryName,
            slug: typeof categoryName==="string"?categoryName.toUpperCase():categoryName,
            sortOrderId:sortOrder,
        }
    })
    if(!categoryCreate){
        throw new apiError(400,"category creation failure")
    }
    return res.status(200).json(new apiResponse(200,createCategory,"created  category"))
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

        return res.status(200).json(new apiResponse(200,updatedCuisineData,"mapping of cuisine and category updated successfully"))
    })


    // user and admin
    const fetchCategoryToCuisine = asyncHandler(async(req,res)=>{
            const cuisineName = req.params.cuisineName || req.query.cuisineName || req.body.cuisineName

            if(!cuisineName) throw new apiError(400,"cuisine name is required")

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

            return res.status(200).json(new apiResponse(200,cuisineData.categories,"categories fetched successfully"))
        })

    const fetchAllCategories = asyncHandler(async(req,res)=>{
            const categories = await prisma.categories.findMany({
                orderBy:{
                    sortOrderId:"asc"
                },
                include:{
                    cuisine:{
                        select:{
                            id:true,
                            name:true,
                            slug:true
                        }
                    }
                }
            })
                if(!fetchAllCategories) throw new apiError(404,"categories not found")

            return res.status(200).json(new apiResponse(200,categories,"categories fetched successfully"))
    })

    const fetchOnlyCategories = asyncHandler(async(req,res)=>{
            const categories = await prisma.categories.findMany({
                orderBy:{
                    sortOrderId:"asc"
                }
            })

            if(!categories) throw new apiError(404,"categories not found")
            return res.status(200).json(new apiResponse(200,categories,"categories fetched successfully"))
    })
    
    
// admin
    const editCategory = asyncHandler(async(req,res)=>{
            const {categoryId} = req.params
            const {categoryName,sortOrderId,sortOrder} = req.body

            if(!categoryId) throw new apiError(400,"category id is required")
            if(!categoryName && sortOrderId === undefined && sortOrder === undefined) throw new apiError(400,"no category data passed")

            const dataToUpdate = {}

            if(categoryName){
                dataToUpdate.name = categoryName
                dataToUpdate.slug = categoryName.toUpperCase()
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
                
            return res.status(200).json(new apiResponse(200,deletedCategory,"category deleted successfully"))
    })
    
export { createCategory, mapCategories, fetchCategoryToCuisine, fetchAllCategories, fetchOnlyCategories, editCategory, deleteCategory }

import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

// admin
const createCuisine = asyncHandler(async(req,res)=>{

    const {categoryName,sortOrder} = req.body
    if(!categoryName && !sortOrder) throw new apiError(400,"no category name passed")
    
    const cuisineCreate = await prisma.cuisine.create({
        data:{
            name:categoryName,
            slug: typeof categoryName==="string"?categoryName.toUpperCase():categoryName,
            sortOrderId:sortOrder,
        }
    })
    if(!cuisineCreate){
        throw new apiError(400,"cuisine creation failure")
    }

    return res.status(201).json(new apiResponse(201,cuisineCreate,"cuisine created successfully"))
    

}) 

// user and admin
const fetchAllCuisines = asyncHandler(async(req,res)=>{
    const cuisines = await prisma.cuisine.findMany({
        orderBy:{
            sortOrderId:"asc"
        },
        include:{
            categories:{
                orderBy:{
                    sortOrderId:"asc"
                },
                include:{
                    allItems:{
                        orderBy:{
                            sortOrderId:"asc"
                        }
                    }
                }
            }
        }
    })

    if(!cuisines) throw new apiError(404,"cuisines not found")
    return res.status(200).json(new apiResponse(200,cuisines,"cuisines fetched successfully"))
})

// user and admin
const fetchOnlyCuisines = asyncHandler(async(req,res)=>{
    const cuisines = await prisma.cuisine.findMany({
        orderBy:{
            sortOrderId:"asc"
        }
    })

    if(!cuisines) throw new apiError(404,"cuisines not found")
    return res.status(200).json(new apiResponse(200,cuisines,"cuisines fetched successfully"))
})

// admin
const reorderCuisines = asyncHandler(async(req,res)=>{
    const {cuisineIds} = req.body

    if(!Array.isArray(cuisineIds) || cuisineIds.length === 0){
        throw new apiError(400,"cuisineIds must be a non-empty array")
    }

    const uniqueCuisineIds = [...new Set(cuisineIds.map((cuisineId)=>String(cuisineId)).filter(Boolean))]

    if(uniqueCuisineIds.length !== cuisineIds.length){
        throw new apiError(400,"duplicate cuisine ids are not allowed")
    }

    const cuisines = await prisma.cuisine.findMany({
        where:{
            id:{
                in:uniqueCuisineIds
            }
        },
        select:{
            id:true
        }
    })

    if(cuisines.length !== uniqueCuisineIds.length){
        throw new apiError(400,"one or more cuisine ids are invalid")
    }

    const updatedCuisines = await prisma.$transaction(
        uniqueCuisineIds.map((cuisineId,index)=>{
            return prisma.cuisine.update({
                where:{
                    id:cuisineId
                },
                data:{
                    sortOrderId:index + 1
                }
            })
        })
    )

    return res.status(200).json(new apiResponse(200,updatedCuisines,"cuisines reordered successfully"))
})

// admin
const editCuisine = asyncHandler(async(req,res)=>{
    const {cuisineId} = req.params
    const {cuisineName,sortOrderId,sortOrder} = req.body

    if(!cuisineId) throw new apiError(400,"cuisine id is required")
    if(!cuisineName && sortOrderId === undefined && sortOrder === undefined) throw new apiError(400,"no cuisine data passed")

    const dataToUpdate = {}

    if(cuisineName){
        dataToUpdate.name = cuisineName
        dataToUpdate.slug = cuisineName.toUpperCase()
    }

    if(sortOrderId !== undefined || sortOrder !== undefined){
        dataToUpdate.sortOrderId = Number(sortOrderId ?? sortOrder)
    }

    const updatedCuisine = await prisma.cuisine.update({
        where:{
            id:cuisineId
        },
        data:dataToUpdate
    })

    return res.status(200).json(new apiResponse(200,updatedCuisine,"cuisine updated successfully"))
})

// admin
const deleteCuisine = asyncHandler(async(req,res)=>{
    const {cuisineId} = req.params

    if(!cuisineId) throw new apiError(400,"cuisine id is required")

    const deletedCuisine = await prisma.cuisine.delete({
        where:{
            id:cuisineId
        }
    })

    return res.status(200).json(new apiResponse(200,deletedCuisine,"cuisine deleted successfully"))
})

export { createCuisine, fetchAllCuisines, fetchOnlyCuisines, reorderCuisines, editCuisine, deleteCuisine }

import { apiError } from "./handler.js";

const getPositiveInteger = (value,fieldName)=>{
    const parsedValue = Number(value);
    if(!Number.isInteger(parsedValue) || parsedValue < 1){
        throw new apiError(400,`${fieldName} must be a positive integer`);
    }
    return parsedValue;
};

const getPagination = (query = {},{defaultLimit = 20,maxLimit = 50} = {})=>{
    const page = query.page === undefined ? 1 : getPositiveInteger(query.page,"page");
    const requestedLimit = query.limit ?? query.take;
    const limit = requestedLimit === undefined
        ? defaultLimit
        : Math.min(getPositiveInteger(requestedLimit,"limit"),maxLimit);

    return {
        page,
        limit,
        skip:(page - 1) * limit,
        take:limit
    };
};

const buildPaginationMeta = ({page,limit,total})=>({
    page,
    limit,
    total,
    totalPages:Math.ceil(total / limit)
});

export { getPagination, buildPaginationMeta };

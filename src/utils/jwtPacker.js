import jwt from "jsonwebtoken"
import { v4 as uuidv4 } from "uuid";

function encodeAccessToken(id,name,email,picture,password=uuidv4()){
    return jwt.sign({
        id,
        name,
        email,
        password,
        picture
    },process.env.ACCESS_TOKEN_SECRET,{
        expiresIn:process.env.ACCESS_TOKEN_EXPIRY
    })
}
function encodeRefreshToken(){
    return jwt.sign({
        
        name,
        password,
        picture
    },process.env.REFRESH_TOKEN_SECRET,{
        expiresIn:process.env.REFRESH_TOKEN_EXPIRY
    })
}

function decodeJWT(token,tokenSecret){
        return jwt.verify(token,tokenSecret,{algorithms:["HS256"]})
}



export {encodeAccessToken,encodeRefreshToken,decodeJWT}

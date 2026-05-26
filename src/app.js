import express from "express"
import cors from "cors"
import "dotenv/config";
import { authRouter } from "./routes/auth.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { shopRouter } from "./routes/shop.routes.js";
import { buyerRouter } from "./routes/buyer.routes.js";
import { sellerRouter } from "./routes/seller.routes.js";
import { cuisineRouter } from "./routes/cuisine.routes.js";
import { categoryRouter } from "./routes/categories.routes.js";
import { itemRouter } from "./routes/items.routes.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { verifyJWT } from "./middleware/auth.middleware.js";

export const app = express()

app.use(express.json({
    limit:"16kb"
}))
app.use(express.urlencoded({
    extended:1
}))
// express.cookieParser

const healthCheck = asyncHandler(async (req, res) => {
    const data = req.userData
    return res.status(200).json({
        "Msg":"data",
        data
    })
})

app.use(express.json());
app.get("/",verifyJWT,healthCheck)

const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));
app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/shops", shopRouter);
app.use("/buyers", buyerRouter);
app.use("/sellers", sellerRouter);
app.use("/cuisines", cuisineRouter);
app.use("/categories", categoryRouter);
app.use("/items", itemRouter);

app.listen(8000,()=>{
    console.log("this is the express server listening")
} 
)

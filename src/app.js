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
import { comboRouter } from "./routes/combos.routes.js";
import { menuRouter } from "./routes/menu.routes.js";
import { orderRouter } from "./routes/orders.routes.js";
import { adRouter } from "./routes/ads.routes.js";
import { tagRouter } from "./routes/tags.routes.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { verifyJWT } from "./middleware/auth.middleware.js";
import apiError from "./utils/apiError.js";
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
app.get("/health",healthCheck)
app.use((req,res,next,err)=>{
  throw new apiError(500,err)
})
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
app.use("/combos", comboRouter);
app.use("/menus", menuRouter);
app.use("/orders", orderRouter);
app.use("/ads", adRouter);
app.use("/tags", tagRouter);

app.get("/", (req, res) => {
  const logo = `
    _   ______  __  ___    ___    ____ 
   / | / / __ \\/  |/  /   /   |  / __ \\
  /  |/ / / / / /|_/ /   / /| | / / / /
 / /|  / /_/ / /  / /   / ___ |/ /_/ / 
/_/ |_/\\____/_/  /_/   /_/  |_/_____/  
`;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          background: black;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
        }

        pre {
          color: white;
          font-size: 40px;
          font-family: monospace;
          font-weight: bold;
          line-height: 1.1;
          text-shadow: 0 0 15px white;
        }
      </style>
    </head>
    <body>
      <pre>${logo}</pre>
    </body>
    </html>
  `);
});
app.listen(8000,()=>{
    console.log("this is the express server listening")
})
// http://13.206.206.50:8000/health

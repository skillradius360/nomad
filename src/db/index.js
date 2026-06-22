import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;
const isAivenPostgres = connectionString.includes("aivencloud.com");
const sslMode = connectionString.match(/[?&]sslmode=([^&]+)/)?.[1];
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === undefined
    ? !(isAivenPostgres || sslMode === "no-verify")
    : process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false";
const poolConnectionString = rejectUnauthorized
    ? connectionString
    : connectionString.replace(/sslmode=[^&]+/,"sslmode=no-verify");
const pool = new pg.Pool({
    connectionString:poolConnectionString,
    max:Number(process.env.DB_POOL_MAX || 5),
    connectionTimeoutMillis:15000,
    idleTimeoutMillis:30000,
    ssl:sslMode === "disable" ? false : { rejectUnauthorized }
});
const adapter = new PrismaPg(pool,{ disposeExternalPool:true });
const prisma = new PrismaClient({ adapter });

export { prisma };

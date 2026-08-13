import { join } from "node:path";

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || join(process.cwd(), "data"),
  maxBody: Number(process.env.MAX_BODY || 20 * 1024 * 1024),
};

import { serve } from "inngest/next";
import { inngest, readInngestEnv } from "../../../inngest/client";
import { functions } from "../../../inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  signingKey: readInngestEnv("INNGEST_SIGNING_KEY"),
});

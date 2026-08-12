import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "nyayagrid",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

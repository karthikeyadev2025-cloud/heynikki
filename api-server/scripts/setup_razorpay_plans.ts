/**
 * One-shot script to create Nikki's 3 Razorpay subscription plans.
 *
 * Run AFTER you've created the Razorpay account and added keys to .env:
 *   cd api-server
 *   npm install -D ts-node
 *   RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx \
 *     npx ts-node scripts/setup_razorpay_plans.ts
 *
 * Output: 3 plan IDs to copy into api-server/.env as:
 *   RAZORPAY_PLAN_STARTER=plan_xxx
 *   RAZORPAY_PLAN_GROWTH=plan_xxx
 *   RAZORPAY_PLAN_SCALE=plan_xxx
 *
 * Idempotent: re-running lists existing plans first and only creates missing ones.
 */
import * as https from "https";

const KEY_ID     = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error("ERROR: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET env vars");
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");

// Plan definitions — all amounts in PAISE (₹1 = 100 paise). Includes 18% GST.
const PLANS = [
  {
    code: "starter",
    period: "monthly", interval: 1,
    item: { name: "Nikki Starter",
            description: "200 mins/mo · 1 voice profile · Telugu AI receptionist",
            amount: 199900, currency: "INR" },
  },
  {
    code: "growth",
    period: "monthly", interval: 1,
    item: { name: "Nikki Growth",
            description: "600 mins/mo · 3 voice profiles · custom greetings · appointment booking",
            amount: 499900, currency: "INR" },
  },
  {
    code: "scale",
    period: "monthly", interval: 1,
    item: { name: "Nikki Scale",
            description: "1,500 mins/mo · 10 voice profiles · multi-branch · dedicated manager",
            amount: 999900, currency: "INR" },
  },
];

function rzpRequest(method: string, path: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const req = https.request(
      {
        hostname: "api.razorpay.com",
        path,
        method,
        headers: {
          Authorization: AUTH,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(chunks);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`${res.statusCode}: ${JSON.stringify(parsed)}`));
            } else {
              resolve(parsed);
            }
          } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("Fetching existing Razorpay plans…");
  const existing = await rzpRequest("GET", "/v1/plans?count=100");
  const existingByName = new Map<string, any>(
    (existing.items || []).map((p: any) => [p.item.name, p])
  );

  const results: Record<string, string> = {};
  for (const def of PLANS) {
    const found = existingByName.get(def.item.name);
    if (found) {
      console.log(`  ↻ exists: ${def.item.name} → ${found.id}`);
      results[def.code] = found.id;
      continue;
    }
    const created = await rzpRequest("POST", "/v1/plans", def);
    console.log(`  ✓ created: ${def.item.name} → ${created.id}`);
    results[def.code] = created.id;
  }

  console.log("\nAdd these to api-server/.env:\n");
  console.log(`RAZORPAY_PLAN_STARTER=${results.starter}`);
  console.log(`RAZORPAY_PLAN_GROWTH=${results.growth}`);
  console.log(`RAZORPAY_PLAN_SCALE=${results.scale}`);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function authHeader(env) {
  return "Basic " + btoa(
    env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET
  );
}

async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    a.length !== b.length
  ) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

async function razorpayGet(env, path) {
  const response = await fetch(
    "https://api.razorpay.com/v1" + path,
    { headers: { Authorization: authHeader(env) } }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Razorpay API request failed");
  }

  return data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API request checks
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST") {
        return json({ error: "POST required" }, 405);
      }

      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
        return json({ error: "Payment configuration missing" }, 500);
      }
    }

    // CREATE RAZORPAY ORDER
    if (url.pathname === "/api/create-order") {
      try {
        const body = await request.json();

        const PRODUCT_PRICES = [
          16900, 16900, 18900, 18900,
          31800, 35800, 52700, 61300
        ];

        if (
          !Array.isArray(body.items) ||
          body.items.length < 1 ||
          body.items.length > 8
        ) {
          return json({ error: "Invalid cart items" }, 400);
        }

        let amount = 0;
        const seen = new Set();

        for (const item of body.items) {
          const id = item?.id;
          const quantity = item?.quantity;

          if (
            !Number.isInteger(id) ||
            id < 0 ||
            id >= PRODUCT_PRICES.length ||
            !Number.isInteger(quantity) ||
            quantity < 1 ||
            quantity > 10 ||
            seen.has(id)
          ) {
            return json({ error: "Invalid product or quantity" }, 400);
          }

          seen.add(id);
          amount += PRODUCT_PRICES[id] * quantity;
        }

        if (
          !Number.isSafeInteger(amount) ||
          amount < 100 ||
          amount > 1000000
        ) {
          return json({ error: "Invalid order total" }, 400);
        }

        const response = await fetch(
          "https://api.razorpay.com/v1/orders",
          {
            method: "POST",
            headers: {
              Authorization: authHeader(env),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              amount,
              currency: "INR",
              receipt: "mav_" +
                crypto.randomUUID().replace(/-/g, "").slice(0, 20)
            })
          }
        );

        const result = await response.json();

        if (!response.ok) {
          return json({
            error: "Razorpay could not create the order"
          }, 502);
        }

        const tokenData = {
          order_id: result.id,
          amount,
          currency: "INR",
          items: body.items.map(item => ({
            id: item.id,
            quantity: item.quantity
          })),
          expires_at: Date.now() + 15 * 60 * 1000
        };

        const encodedToken = btoa(
          JSON.stringify(tokenData)
        )
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");

        const tokenSignature = await hmacSha256(
          env.RAZORPAY_KEY_SECRET,
          encodedToken
        );

        return json({
          order_id: result.id,
          amount: result.amount,
          currency: result.currency,
          key_id: env.RAZORPAY_KEY_ID,
          verification_token: encodedToken + "." + tokenSignature
        });

      } catch {
        return json({ error: "Unable to create order" }, 400);
      }
    }

    // VERIFY RAZORPAY PAYMENT
    if (url.pathname === "/api/verify-payment") {
      try {
        const body = await request.json();

        const {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          verification_token
        } = body;

        if (
          typeof razorpay_order_id !== "string" ||
          typeof razorpay_payment_id !== "string" ||
          typeof razorpay_signature !== "string" ||
          typeof verification_token !== "string" ||
          !/^order_[A-Za-z0-9]+$/.test(razorpay_order_id) ||
          !/^pay_[A-Za-z0-9]+$/.test(razorpay_payment_id)
        ) {
          return json({ error: "Invalid payment details" }, 400);
        }

        const tokenParts = verification_token.split(".");

        if (tokenParts.length !== 2) {
          return json({
            verified: false,
            error: "Invalid order token"
          }, 400);
        }

        const [encodedToken, tokenSignature] = tokenParts;

        const expectedTokenSignature = await hmacSha256(
          env.RAZORPAY_KEY_SECRET,
          encodedToken
        );

        if (!safeEqual(expectedTokenSignature, tokenSignature)) {
          return json({
            verified: false,
            error: "Invalid order token signature"
          }, 400);
        }

        let tokenData;

        try {
          const base64 = encodedToken
            .replace(/-/g, "+")
            .replace(/_/g, "/");

          tokenData = JSON.parse(
            atob(base64 + "=".repeat((4 - base64.length % 4) % 4))
          );
        } catch {
          return json({
            verified: false,
            error: "Invalid order token data"
          }, 400);
        }

        const PRODUCT_PRICES = [
          16900, 16900, 18900, 18900,
          31800, 35800, 52700, 61300
        ];

        if (
          tokenData.order_id !== razorpay_order_id ||
          tokenData.currency !== "INR" ||
          !Number.isSafeInteger(tokenData.amount) ||
          !Number.isSafeInteger(tokenData.expires_at) ||
          tokenData.expires_at < Date.now() ||
          !Array.isArray(tokenData.items) ||
          tokenData.items.length < 1 ||
          tokenData.items.length > 8
        ) {
          return json({
            verified: false,
            error: "Order token expired or invalid"
          }, 400);
        }

        let expectedAmount = 0;
        const seen = new Set();

        for (const item of tokenData.items) {
          if (
            !Number.isInteger(item.id) ||
            item.id < 0 ||
            item.id >= PRODUCT_PRICES.length ||
            !Number.isInteger(item.quantity) ||
            item.quantity < 1 ||
            item.quantity > 10 ||
            seen.has(item.id)
          ) {
            return json({
              verified: false,
              error: "Invalid cart in token"
            }, 400);
          }

          seen.add(item.id);
          expectedAmount += PRODUCT_PRICES[item.id] * item.quantity;
        }

        if (expectedAmount !== tokenData.amount) {
          return json({
            verified: false,
            error: "Cart amount mismatch"
          }, 400);
        }

        const expectedSignature = await hmacSha256(
          env.RAZORPAY_KEY_SECRET,
          razorpay_order_id + "|" + razorpay_payment_id
        );

        if (!safeEqual(expectedSignature, razorpay_signature)) {
          return json({
            verified: false,
            error: "Payment signature invalid"
          }, 400);
        }

        const [order, payment] = await Promise.all([
          razorpayGet(
            env,
            "/orders/" + encodeURIComponent(razorpay_order_id)
          ),
          razorpayGet(
            env,
            "/payments/" + encodeURIComponent(razorpay_payment_id)
          )
        ]);

        if (
          payment.order_id !== order.id ||
          order.id !== razorpay_order_id
        ) {
          return json({
            verified: false,
            error: "Payment/order mismatch"
          }, 400);
        }

        if (
          order.amount !== tokenData.amount ||
          order.currency !== "INR" ||
          payment.status !== "captured" ||
          payment.amount !== tokenData.amount ||
          payment.currency !== "INR"
        ) {
          return json({
            verified: false,
            error: "Payment amount or status mismatch"
          }, 400);
        }

        return json({
          verified: true,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          razorpay_order_id: order.id,
          razorpay_payment_id: payment.id
        });

      } catch {
        return json({
          verified: false,
          error: "Unable to verify payment with Razorpay"
        }, 502);
      }
    }

    // Unknown API routes only
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "API route not found" }, 404);
    }

    // Serve MAVIQ website files
    if (!env.ASSETS) {
      return json({ error: "Site assets are not configured" }, 500);
    }

    return env.ASSETS.fetch(request);
  }
};

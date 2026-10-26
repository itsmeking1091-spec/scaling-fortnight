
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
  if (typeof a !== "string" || typeof b !== "string" ||
      a.length !== b.length) return false;

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

    if (url.pathname.startsWith("/api/") && !env.ASSETS) {
      return json({ error: "Site assets are not configured" }, 500);
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST") {
        return json({ error: "POST required" }, 405);
      }

      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
        return json({ error: "Payment configuration missing" }, 500);
      }
    }

    if (url.pathname === "/api/create-order") {
      try {
        const body = await request.json();
        const amount = Number(body.amount);

        if (!Number.isSafeInteger(amount) ||
            amount < 100 || amount > 1000000) {
          return json({ error: "Invalid amount" }, 400);
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
              receipt: "ab_" +
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

        return json({
          order_id: result.id,
          amount: result.amount,
          currency: result.currency,
          key_id: env.RAZORPAY_KEY_ID
        });
      } catch {
        return json({ error: "Unable to create order" }, 400);
      }
    }

    if (url.pathname === "/api/verify-payment") {
      try {
        const body = await request.json();
        const {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature
        } = body;

        if (
          typeof razorpay_order_id !== "string" ||
          typeof razorpay_payment_id !== "string" ||
          typeof razorpay_signature !== "string" ||
          !/^order_[A-Za-z0-9]+$/.test(razorpay_order_id) ||
          !/^pay_[A-Za-z0-9]+$/.test(razorpay_payment_id)
        ) {
          return json({ error: "Invalid payment details" }, 400);
        }

        const expected = await hmacSha256(
          env.RAZORPAY_KEY_SECRET,
          razorpay_order_id + "|" + razorpay_payment_id
        );

        if (!safeEqual(expected, razorpay_signature)) {
          return json({
            verified: false,
            error: "Signature verification failed"
          }, 400);
        }

        // Fetch the actual order and payment from Razorpay.
        const [order, payment] = await Promise.all([
          razorpayGet(env, "/orders/" +
            encodeURIComponent(razorpay_order_id)),
          razorpayGet(env, "/payments/" +
            encodeURIComponent(razorpay_payment_id))
        ]);

        // Confirm this payment belongs to this order.
        if (
          payment.order_id !== order.id ||
          order.id !== razorpay_order_id
        ) {
          return json({
            verified: false,
            error: "Payment/order mismatch"
          }, 400);
        }

        // Only confirm fully captured payments.
        if (
          payment.status !== "captured" ||
          payment.amount !== order.amount ||
          payment.currency !== order.currency ||
          order.currency !== "INR"
        ) {
          return json({
            verified: false,
            error: "Payment is not captured or amount does not match"
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

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "API route not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

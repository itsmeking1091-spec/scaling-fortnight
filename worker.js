function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
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
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-order") {
      if (request.method !== "POST") {
        return json({ error: "POST required" }, 405);
      }

      try {
        const body = await request.json();
        const amount = Number(body.amount);

        if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1000000) {
          return json({ error: "Invalid amount" }, 400);
        }

        if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
          return json({ error: "Payment configuration missing" }, 500);
        }

        const response = await fetch(
          "https://api.razorpay.com/v1/orders",
          {
            method: "POST",
            headers: {
              "Authorization": "Basic " + btoa(
                env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET
              ),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              amount,
              currency: "INR",
              receipt: "ab_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20)
            })
          }
        );

        const result = await response.json();

        if (!response.ok) {
          return json({ error: "Razorpay could not create the order" }, 502);
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
      if (request.method !== "POST") {
        return json({ error: "POST required" }, 405);
      }

      try {
        const body = await request.json();
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

        if (
          typeof razorpay_order_id !== "string" ||
          typeof razorpay_payment_id !== "string" ||
          typeof razorpay_signature !== "string" ||
          !env.RAZORPAY_KEY_SECRET
        ) {
          return json({ error: "Invalid payment details" }, 400);
        }

        const expected = await hmacSha256(
          env.RAZORPAY_KEY_SECRET,
          razorpay_order_id + "|" + razorpay_payment_id
        );

        if (!safeEqual(expected, razorpay_signature)) {
          return json({ verified: false, error: "Signature verification failed" }, 400);
        }

        return json({
          verified: true,
          razorpay_order_id,
          razorpay_payment_id
        });
      } catch {
        return json({ error: "Unable to verify payment" }, 400);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "API route not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

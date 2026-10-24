const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ verified: false, error: "Invalid payment details" })
      };
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(razorpay_signature, "hex");

    const verified =
      /^[a-f0-9]{64}$/i.test(razorpay_signature) &&
      a.length === b.length &&
      crypto.timingSafeEqual(a, b);

    return {
      statusCode: verified ? 200 : 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verified })
    };
  } catch (error) {
    console.error("Payment verification failed:", error.message);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verified: false, error: "Verification failed" })
    };
  }
};

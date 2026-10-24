

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const Razorpay = require("razorpay");

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const body = JSON.parse(event.body || "{}");

    // Accept only an amount calculated by a trusted server-side menu.
    // Do not enable checkout until server-side price validation is added.
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid order items" })
      };
    }

    return {
      statusCode: 501,
      body: JSON.stringify({
        error: "Checkout is not enabled yet. Server-side menu price validation is required."
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server configuration error" })
    };
  }
};


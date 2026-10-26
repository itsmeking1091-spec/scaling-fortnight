
const Razorpay = require("razorpay");

const prices = [
  100, 110, 120, 120, 130, 139, 139, 149, 149, 150,
  171, 161, 161, 150, 130,
  90, 130, 130, 139, 149, 160,
  149, 149, 149, 139,
  235, 329, 249, 339, 235, 329, 279,
  229, 239, 259, 230, 240, 249, 269, 279, 289
];

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: "Method not allowed"
      })
    };
  }

  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error("Razorpay configuration is missing", {
        keyIdPresent: Boolean(keyId),
        keySecretPresent: Boolean(keySecret)
      });

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Payment configuration missing"
        })
      };
    }

    let body;

    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid request body"
        })
      };
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Please add items to your order"
        })
      };
    }

    let total = 0;

    for (const item of body.items) {
      const id = Number(item.id);
      const quantity = Number(item.quantity);

      if (
        !Number.isInteger(id) ||
        id < 0 ||
        id >= prices.length ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 20
      ) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: "Invalid menu item or quantity"
          })
        };
      }

      total += prices[id] * quantity;
    }

    if (!Number.isSafeInteger(total) || total <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid order total"
        })
      };
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });

    const order = await razorpay.orders.create({
      amount: total * 100,
      currency: "INR",
      receipt: "ab_" + Date.now()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId
      })
    };
  } catch (error) {
    console.error("Order creation failed:", {
      message: error?.message || String(error),
      statusCode: error?.statusCode,
      description: error?.error?.description,
      code: error?.error?.code,
      stack: error?.stack
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Unable to create payment order"
      })
    };
  }
};
